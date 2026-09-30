import { useEffect, useRef, useState } from "react";

// Encapsula o ciclo de vida da câmera (getUserMedia, lanterna, mensagens de
// erro) para que os componentes de tela só precisem chamar startCameraStream
// e ler o vídeo através de videoRef.
export function useTestCameraStream() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraOpening, setCameraOpening] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpening(false);
    setTorchOn(false);
    setTorchSupported(false);
  };

  useEffect(() => () => stopCamera(), []);

  const waitForVideoElement = async (frames = 20) => {
    for (let i = 0; i < frames; i++) {
      if (videoRef.current) return videoRef.current;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return videoRef.current;
  };

  const getUserMediaWithTimeout = async (
    constraints: MediaStreamConstraints,
    timeoutMs = 7000,
  ) => {
    let timedOut = false;
    const mediaPromise = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (timedOut) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Camera startup timed out", "AbortError");
      }
      return stream;
    });

    const timeoutPromise = new Promise<MediaStream>((_, reject) => {
      window.setTimeout(() => {
        timedOut = true;
        reject(new DOMException("Camera startup timed out", "AbortError"));
      }, timeoutMs);
    });

    return Promise.race([mediaPromise, timeoutPromise]);
  };

  const waitForVideoReady = async (video: HTMLVideoElement, timeoutMs = 4000) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException("Video metadata timeout", "AbortError"));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", finish);
        video.removeEventListener("canplay", finish);
        window.clearTimeout(timer);
      };
      const timer = window.setTimeout(fail, timeoutMs);
      video.addEventListener("loadedmetadata", finish, { once: true });
      video.addEventListener("canplay", finish, { once: true });
    });
  };

  const startCameraStream = async () => {
    stopCamera();
    setError("");
    setCameraOpening(true);

    const video = await waitForVideoElement();
    if (!video) {
      setCameraOpening(false);
      setError("A tela da câmera não terminou de abrir. Toque em Tentar novamente.");
      return;
    }

    if (!window.isSecureContext) {
      setCameraOpening(false);
      setError("A câmera exige HTTPS. Abra o endereço oficial do aplicativo.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOpening(false);
      setError("Este navegador não permite acesso à câmera. Abra o site no Chrome ou Safari atualizado.");
      return;
    }

    const attempts: MediaStreamConstraints[] = [
      // Android costuma ser mais estável começando com 'ideal' em vez de 'exact'.
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: true, audio: false },
      { video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    ];

    let lastFailure: unknown;

    for (const constraints of attempts) {
      try {
        const stream = await getUserMediaWithTimeout(constraints);
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        const settings = track?.getSettings?.() as MediaTrackSettings & { facingMode?: string };

        setTorchSupported(Boolean(capabilities?.torch));
        if (settings?.facingMode && settings.facingMode !== "environment") {
          setTorchSupported(false);
        }

        video.srcObject = stream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");

        await waitForVideoReady(video);

        try {
          await Promise.race([
            video.play(),
            new Promise<void>((_, reject) =>
              window.setTimeout(
                () => reject(new DOMException("Video play timeout", "AbortError")),
                4000,
              ),
            ),
          ]);
        } catch (playError) {
          // Alguns Androids já exibem o stream mesmo que play() não resolva.
          if (!(video.readyState >= 2 && video.videoWidth > 0)) throw playError;
        }

        try {
          const refreshedCapabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
          const refreshedSettings = track?.getSettings?.() as MediaTrackSettings & { facingMode?: string };
          const rearCamera = !refreshedSettings?.facingMode || refreshedSettings.facingMode === "environment";
          setTorchSupported(Boolean(refreshedCapabilities?.torch) && rearCamera);
        } catch {
          // Mantém o estado já detectado.
        }

        setCameraOpening(false);
        setError("");
        return;
      } catch (reason) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        video.srcObject = null;
        lastFailure = reason;
      }
    }

    setCameraOpening(false);
    const failureName = lastFailure instanceof DOMException ? lastFailure.name : "";
    if (failureName === "NotAllowedError" || failureName === "SecurityError") {
      setError("A câmera está bloqueada. Libere a permissão do site para usar a câmera e tente novamente.");
    } else if (failureName === "NotReadableError" || failureName === "TrackStartError") {
      setError("A câmera está ocupada por outro aplicativo. Feche o outro app e tente novamente.");
    } else if (failureName === "AbortError") {
      setError("A câmera demorou demais para responder. Toque em Tentar novamente.");
    } else {
      setError("Não foi possível iniciar a câmera. Toque em Tentar novamente.");
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      setError("A câmera ainda não está pronta. Aguarde um instante e tente novamente.");
      return;
    }

    const next = !torchOn;

    // Faz uma checagem fresca antes de tentar ligar a lanterna.
    let capabilities: (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    try {
      capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    } catch {
      capabilities = undefined;
    }

    if (!capabilities?.torch) {
      setTorchSupported(false);
      setTorchOn(false);
      setError("A lanterna não está disponível neste celular ou navegador. Use uma boa iluminação externa e mantenha a câmera de cima.");
      return;
    }

    const attempts: MediaTrackConstraints[] = [
      { advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }] },
      { torch: next } as MediaTrackConstraints & { torch: boolean },
    ];

    let lastError: unknown;

    for (const constraints of attempts) {
      try {
        await track.applyConstraints(constraints);
        setTorchOn(next);
        setTorchSupported(true);
        setError("");
        return;
      } catch (reason) {
        lastError = reason;
      }
    }

    // Em alguns aparelhos a câmera precisa de uma pequena revalidação de estado.
    try {
      const refreshed = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(Boolean(refreshed?.torch));
    } catch {
      setTorchSupported(false);
    }

    setTorchOn(false);
    setError(
      lastError
        ? "Não foi possível acionar a lanterna neste aparelho. Use iluminação externa ou tente o Chrome atualizado."
        : "A lanterna não está disponível neste aparelho."
    );
  };

  return {
    videoRef,
    streamRef,
    torchSupported,
    torchOn,
    cameraOpening,
    error,
    setError,
    stopCamera,
    startCameraStream,
    toggleTorch,
  };
}

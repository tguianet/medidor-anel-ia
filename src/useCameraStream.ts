import { useEffect, useRef, useState } from "react";

// Encapsula o ciclo de vida da câmera (getUserMedia, lanterna, mensagens de
// erro) para que os componentes de tela só precisem chamar startCameraStream
// e ler o vídeo através de videoRef.
export function useCameraStream() {
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

  const startCameraStream = async () => {
    stopCamera();
    setError("");
    setCameraOpening(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOpening(false);
      setError("Este navegador não permite acesso à câmera. Abra o site no Chrome ou Safari atualizado.");
      return;
    }

    const attempts: MediaStreamConstraints[] = [
      // Primeiro tenta a câmera traseira principal com resolução moderada.
      // Em alguns Androids o torch só aparece em determinados modos de captura.
      { video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: true, audio: false },
    ];
    let lastFailure: unknown;

    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        const settings = track?.getSettings?.() as MediaTrackSettings & { facingMode?: string };

        // Alguns navegadores reportam torch apenas depois que a câmera já iniciou.
        // Mantemos a detecção inicial e fazemos nova checagem após o play().
        setTorchSupported(Boolean(capabilities?.torch));

        // Se o fallback acabou abrindo a câmera frontal, não oferecemos lanterna.
        if (settings?.facingMode && settings.facingMode !== "environment") {
          setTorchSupported(false);
        }
        const video = videoRef.current;
        if (!video) throw new Error("A tela da câmera não ficou pronta.");
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "true");
        await video.play();

        // Segunda leitura de capabilities após a câmera estar efetivamente ativa.
        // Em alguns aparelhos Android o suporte ao torch só aparece neste ponto.
        try {
          const refreshedCapabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
          const refreshedSettings = track?.getSettings?.() as MediaTrackSettings & { facingMode?: string };
          const rearCamera = !refreshedSettings?.facingMode || refreshedSettings.facingMode === "environment";
          setTorchSupported(Boolean(refreshedCapabilities?.torch) && rearCamera);
        } catch {
          // Mantém o valor detectado anteriormente.
        }

        setCameraOpening(false);
        setError("");
        return;
      } catch (reason) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        lastFailure = reason;
      }
    }

    setCameraOpening(false);
    const failureName = lastFailure instanceof DOMException ? lastFailure.name : "";
    if (failureName === "NotAllowedError" || failureName === "SecurityError") {
      setError("A câmera está bloqueada. Libere a permissão nas configurações do navegador e tente novamente.");
    } else if (failureName === "NotReadableError" || failureName === "TrackStartError") {
      setError("A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.");
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

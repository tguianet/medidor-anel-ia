import { useEffect, useRef, useState } from "react";

export function useTestCameraStream() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraOpening, setCameraOpening] = useState(false);
  const [error, setError] = useState("");

  const stopTracks = (stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const stopCamera = () => {
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
    }
    stopTracks(streamRef.current);
    streamRef.current = null;
    setCameraOpening(false);
    setTorchOn(false);
    setTorchSupported(false);
  };

  useEffect(() => () => stopCamera(), []);

  const waitForVideoElement = async (frames = 30) => {
    for (let i = 0; i < frames; i++) {
      if (videoRef.current) return videoRef.current;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
  };

  const getUserMediaWithTimeout = async (
    constraints: MediaStreamConstraints,
    timeoutMs = 6000,
  ) => {
    let expired = false;

    const mediaPromise = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (expired) {
        stopTracks(stream);
        throw new DOMException("Camera request timed out", "AbortError");
      }
      return stream;
    });

    const timeoutPromise = new Promise<MediaStream>((_, reject) => {
      window.setTimeout(() => {
        expired = true;
        reject(new DOMException("Camera request timed out", "AbortError"));
      }, timeoutMs);
    });

    return Promise.race([mediaPromise, timeoutPromise]);
  };

  const waitForFirstFrame = async (video: HTMLVideoElement, timeoutMs = 3500) => {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException("No camera frame received", "AbortError"));
      };

      const cleanup = () => {
        video.removeEventListener("loadeddata", finish);
        video.removeEventListener("canplay", finish);
        video.removeEventListener("playing", finish);
        window.clearTimeout(timer);
      };

      const timer = window.setTimeout(fail, timeoutMs);

      video.addEventListener("loadeddata", finish);
      video.addEventListener("canplay", finish);
      video.addEventListener("playing", finish);

      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        finish();
      }
    });
  };

  const attachAndVerifyStream = async (
    video: HTMLVideoElement,
    stream: MediaStream,
  ) => {
    video.srcObject = stream;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("autoplay", "true");

    try {
      await video.play();
    } catch {
      // Em Android o play pode rejeitar antes dos metadados.
    }

    await waitForFirstFrame(video);

    // Segunda tentativa depois do primeiro frame/metadados.
    if (video.paused) {
      try { await video.play(); } catch {}
    }

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new DOMException("Camera video has no dimensions", "AbortError");
    }
  };

  const startCameraStream = async () => {
    stopCamera();
    setError("");
    setCameraOpening(true);

    try {
      if (!window.isSecureContext) {
        throw new DOMException("HTTPS required", "SecurityError");
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("getUserMedia unavailable", "NotSupportedError");
      }

      const video = await waitForVideoElement();
      if (!video) {
        throw new Error("video-element-not-mounted");
      }

      const attempts: MediaStreamConstraints[] = [
        // Preferencia pela traseira. Se o aparelho entregar um stream sem frames,
        // descartamos e tentamos a proxima configuracao.
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      let lastFailure: unknown = null;

      for (const constraints of attempts) {
        let candidate: MediaStream | null = null;

        try {
          candidate = await getUserMediaWithTimeout(constraints);
          await attachAndVerifyStream(video, candidate);

          streamRef.current = candidate;

          const track = candidate.getVideoTracks()[0];
          const settings = track?.getSettings?.();
          const capabilities = track?.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined;

          const rearCamera =
            !settings?.facingMode || settings.facingMode === "environment";

          setTorchSupported(Boolean(capabilities?.torch) && rearCamera);
          setTorchOn(false);
          setCameraOpening(false);
          setError("");
          return;
        } catch (reason) {
          lastFailure = reason;
          stopTracks(candidate);
          if (video.srcObject === candidate) video.srcObject = null;
        }
      }

      throw lastFailure ?? new Error("camera-start-failed");
    } catch (reason) {
      stopTracks(streamRef.current);
      streamRef.current = null;

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setCameraOpening(false);

      const name = reason instanceof DOMException ? reason.name : "";

      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("A câmera está bloqueada. Libere a permissão de câmera deste site e toque em Tentar novamente.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("A câmera está ocupada por outro aplicativo. Feche-o e tente novamente.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("Não encontrei uma câmera traseira disponível. Toque em Tentar novamente.");
      } else if (name === "AbortError") {
        setError("A câmera abriu sem entregar imagem. Toque em Tentar novamente.");
      } else if (name === "NotSupportedError") {
        setError("Este navegador não permite abrir a câmera neste site.");
      } else {
        setError("Não foi possível exibir a imagem da câmera. Toque em Tentar novamente.");
      }
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];

    if (!track) {
      setError("A câmera ainda não está ativa.");
      return;
    }

    let capabilities: (MediaTrackCapabilities & { torch?: boolean }) | undefined;

    try {
      capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    } catch {
      capabilities = undefined;
    }

    if (!capabilities?.torch) {
      setTorchSupported(false);
      setTorchOn(false);
      setError("A lanterna não está disponível neste aparelho.");
      return;
    }

    const next = !torchOn;

    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setTorchOn(next);
      setTorchSupported(true);
      setError("");
    } catch {
      setTorchOn(false);
      setError("Não foi possível acionar a lanterna neste aparelho.");
    }
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

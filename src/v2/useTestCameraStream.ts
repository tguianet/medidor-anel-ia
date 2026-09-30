import { useEffect, useRef, useState } from "react";

export function useTestCameraStream() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraOpening, setCameraOpening] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpening(false);
    setTorchOn(false);
    setTorchSupported(false);
  };

  useEffect(() => () => stopCamera(), []);

  const waitForVideo = async () => {
    for (let i = 0; i < 30; i++) {
      if (videoRef.current) return videoRef.current;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
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

      const video = await waitForVideo();
      if (!video) {
        throw new Error("video-element-not-mounted");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.();
      const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };

      const rearCamera = !settings?.facingMode || settings.facingMode === "environment";
      setTorchSupported(Boolean(capabilities?.torch) && rearCamera);

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("autoplay", "true");

      // Android/Chrome pode entregar o MediaStream antes de o elemento <video>
      // estar realmente pronto para renderizar. Nao bloqueamos a interface,
      // mas insistimos no play assim que os metadados chegam e em alguns
      // frames seguintes, ate a imagem ficar visivel.
      const tryPlay = () => {
        if (!video.srcObject) return;
        void video.play().catch(() => {});
      };

      video.onloadedmetadata = tryPlay;
      video.oncanplay = tryPlay;

      tryPlay();
      window.setTimeout(tryPlay, 120);
      window.setTimeout(tryPlay, 350);
      window.setTimeout(tryPlay, 800);

      // Se chegou aqui, o navegador entregou um MediaStream valido.
      setCameraOpening(false);
      setError("");
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setCameraOpening(false);

      const name = reason instanceof DOMException ? reason.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("A câmera está bloqueada. Libere a permissão de câmera deste site e toque em Tentar novamente.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("Não encontrei uma câmera disponível neste aparelho.");
      } else if (name === "NotSupportedError") {
        setError("Este navegador não permite abrir a câmera neste site.");
      } else {
        setError("Falha ao abrir a câmera. Toque em Tentar novamente.");
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

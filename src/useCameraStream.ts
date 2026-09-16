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
        setTorchSupported(Boolean(capabilities?.torch));
        const video = videoRef.current;
        if (!video) throw new Error("A tela da câmera não ficou pronta.");
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "true");
        await video.play();
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
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }] });
      setTorchOn(next);
      setTorchSupported(true);
      setError("");
    } catch {
      setError("Este celular ou navegador não permite controlar a lanterna pela câmera. Use uma boa iluminação externa.");
      setTorchSupported(false);
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

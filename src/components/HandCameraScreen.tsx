import type { RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cameraOpening: boolean;
  error: string;
  onClose: () => void;
  onCapture: () => void;
  onRetry: () => void;
};

export default function HandCameraScreen({
  videoRef, torchOn, torchSupported, onToggleTorch, cameraOpening, error, onClose, onCapture, onRetry,
}: Props) {
  return (
    <section className="camera-screen">
      <div className="camera-top">
        <button className="icon-button" onClick={onClose}>×</button>
        <span>Fotografe a mão inteira</span>
      </div>
      <div className="viewport hand-camera-viewport">
        <video ref={videoRef} playsInline muted autoPlay />
        <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} onClick={onToggleTorch}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
        <div className="full-hand-guide" aria-hidden="true"><span>MÃO INTEIRA</span><i>ANELAR AQUI</i></div>
        {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
      </div>
      <p>Abra a mão, mostre todos os dedos e deixe o anelar sobre a marca.</p>
      <button className="shutter" onClick={onCapture} aria-label="Fotografar a mão inteira"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

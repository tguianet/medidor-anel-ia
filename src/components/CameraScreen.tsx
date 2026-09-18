import type { RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cardReady: boolean;
  cameraOpening: boolean;
  error: string;
  onClose: () => void;
  onCapture: () => void;
  onRetry: () => void;
};

export default function CameraScreen({
  videoRef, torchOn, torchSupported, onToggleTorch, cameraOpening, error, onClose, onCapture, onRetry,
}: Props) {
  return (
    <section className="camera-screen">
      <div className="camera-top">
        <button className="icon-button" onClick={onClose}>×</button>
        <span>Fotografe de cima</span>
      </div>
      <div className="viewport">
        <video ref={videoRef} playsInline muted autoPlay />
        <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} onClick={onToggleTorch}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
        <div className="photo-guide" aria-hidden="true"><span>CARTÃO + DEDO VISÍVEIS</span></div>
        {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
      </div>
      <p>{torchOn ? "Luz ligada • fotografe de cima deixando o cartão e o dedo totalmente visíveis" : "Fotografe de cima. O alinhamento fino será feito depois com 4 linhas independentes."}</p>
      <button className="shutter ready" onClick={onCapture} aria-label="Tirar fotografia"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

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
  videoRef, torchOn, torchSupported, onToggleTorch, cardReady, cameraOpening, error, onClose, onCapture, onRetry,
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
        <div className={`card-alignment${cardReady ? " ready" : ""}`} aria-hidden="true">
          <span>{cardReady ? "✓ BASE ALINHADA" : "ALINHE O CARTÃO"}</span>
          <i className="live-base-left" />
          <i className="live-base-right" />
          <i className="finger-target-left" />
          <i className="finger-target-right" />
        </div>
        <div className="finger-vertical-line" aria-hidden="true"><span>DEDO ESCOLHIDO</span></div>
        {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
      </div>
      <p>{cardReady ? "Base verde: cartão horizontal e dedo escolhido entre as duas marcas" : torchOn ? "Luz ligada • alinhe o cartão na horizontal e centralize o dedo" : "Alinhe a base do cartão e deixe o dedo escolhido entre as duas marcas"}</p>
      <button className={`shutter${cardReady ? " ready" : ""}`} onClick={onCapture} aria-label="Tirar fotografia"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

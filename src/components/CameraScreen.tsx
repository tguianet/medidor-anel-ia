import type { RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cardReady: boolean;
  cameraAngleGuide: "forward" | "backward" | "aligned" | "unknown";
  cameraOpening: boolean;
  error: string;
  onClose: () => void;
  onCapture: () => void;
  onRetry: () => void;
};

export default function CameraScreen({
  videoRef, torchOn, torchSupported, onToggleTorch, cardReady, cameraAngleGuide, cameraOpening, error, onClose, onCapture, onRetry,
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
        <div className={`capture-standard-guide${cardReady ? " ready" : ""}`} aria-hidden="true">
          <div className="live-card-frame">
            <span>{cardReady ? "✓ CARTÃO E ÂNGULO OK" : "ENCAIXE O CARTÃO"}</span>
            <i className="card-guide-corner tl" />
            <i className="card-guide-corner tr" />
            <i className="card-guide-corner br" />
            <i className="card-guide-corner bl" />
          </div>

          <div className={`camera-angle-guide ${cameraAngleGuide}`}>
            <span className="angle-arrow forward">↑</span>
            <strong>
              {cameraAngleGuide === "forward" ? "INCLINE A CÂMERA PARA FRENTE" :
               cameraAngleGuide === "backward" ? "INCLINE A CÂMERA PARA TRÁS" :
               cameraAngleGuide === "aligned" ? "✓ ÂNGULO CORRETO" :
               "AJUSTE O ÂNGULO"}
            </strong>
            <span className="angle-arrow backward">↓</span>
          </div>

          <div className="live-finger-axis">
            <span>ALINHE O DEDO</span>
          </div>
        </div>
        {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
      </div>
      <p>{cardReady
        ? "Cartão e ângulo corretos. Mantenha o dedo sobre a linha central e tire a foto."
        : cameraAngleGuide === "forward"
          ? "Incline levemente a câmera para frente até o indicador ficar verde."
          : cameraAngleGuide === "backward"
            ? "Incline levemente a câmera para trás até o indicador ficar verde."
            : torchOn
              ? "Luz ligada • encaixe o cartão na moldura e ajuste o ângulo."
              : "Encaixe o cartão na moldura e ajuste o ângulo da câmera até ficar verde."}</p>
      <button className="shutter ready" onClick={onCapture} aria-label="Tirar fotografia"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

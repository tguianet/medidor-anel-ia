import type { RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cardReady: boolean;
  calibrationStep: "reference" | "measurement" | "done";
  cameraAngleGuide: "forward" | "backward" | "aligned" | "unknown";
  cameraOpening: boolean;
  error: string;
  referenceCardWidthPercent?: number | null;
  referenceCardAngleDeg?: number | null;
  onClose: () => void;
  onCapture: () => void;
  onRetry: () => void;
};

export default function CameraScreen({
  videoRef, torchOn, torchSupported, onToggleTorch, cardReady, calibrationStep, cameraAngleGuide, cameraOpening, error,
  referenceCardWidthPercent = null, referenceCardAngleDeg = null,
  onClose, onCapture, onRetry,
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
        {calibrationStep === "measurement" && referenceCardWidthPercent !== null && (
          <div
            className="reference-card-ghost"
            aria-hidden="true"
            style={{
              width: `${referenceCardWidthPercent}%`,
              transform: `translateX(-50%) rotate(${referenceCardAngleDeg ?? 0}deg)`,
            }}
          >
            <span>GUIA DA FOTO 1</span>
          </div>
        )}
        <div className={`capture-standard-guide${cardReady ? " ready" : ""}`} aria-hidden="true">
          <div className="live-card-frame">
            <span>{cardReady ? "✓ ALINHADO — PODE CAPTURAR" : "ENCAIXE O CARTÃO"}</span>
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
        ? (calibrationStep === "reference"
            ? "Tudo verde. Toque no botão para capturar o cartão na base plana."
            : "Aproxime ou afaste o celular até o cartão coincidir com a guia da Foto 1. Depois capture manualmente.")
        : cameraAngleGuide === "forward"
          ? "Incline levemente a câmera para frente até o indicador ficar verde."
          : cameraAngleGuide === "backward"
            ? "Incline levemente a câmera para trás até o indicador ficar verde."
            : calibrationStep === "reference"
              ? "Coloque o cartão em uma base plana, enquadre na moldura e ajuste o ângulo até ficar verde."
              : "Coloque o cartão sobre o dedo e ajuste a distância do celular até o cartão coincidir com a guia fantasma da Foto 1."}</p>
      <button className={`shutter${cardReady ? " ready" : ""}`} onClick={onCapture} aria-label="Capturar foto manualmente"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

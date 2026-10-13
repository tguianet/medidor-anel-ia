import { useEffect, useRef, useState, type RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cardReady: boolean;
  liveCardWidthPx?: number | null;
  calibrationStep: "reference" | "measurement" | "done";
  cameraAngleGuide: "forward" | "backward" | "aligned" | "unknown";
  liveFingerTiltDeg?: number | null;
  liveFingerTiltConfidence?: number;
  liveOpticalCenterOffsetPx?: number | null;
  liveCardFingerOffsetPx?: number | null;
  liveOpticalCenterConfidence?: number;
  devicePitch?: number | null;
  deviceRoll?: number | null;
  cameraOpening: boolean;
  error: string;
  referenceCardWidthPercent?: number | null;
  referenceCardAngleDeg?: number | null;
  singlePhotoTestMode?: boolean;
  onClose: () => void;
  onCapture: () => void;
  onRetry: () => void;
};

export default function FrozenCameraScreen({
  videoRef, torchOn, torchSupported, onToggleTorch, cardReady, liveCardWidthPx = null, calibrationStep, cameraAngleGuide,
  liveFingerTiltDeg = null, liveFingerTiltConfidence = 0,
  liveOpticalCenterOffsetPx = null, liveCardFingerOffsetPx = null, liveOpticalCenterConfidence = 0,
  devicePitch = null, deviceRoll = null,
  cameraOpening, error,
  referenceCardWidthPercent = null, referenceCardAngleDeg = null, singlePhotoTestMode = false,
  onClose, onCapture, onRetry,
}: Props) {
  // O detector usa canvas de 300 px e guia entre 11% e 89% da largura.
  // Meta relativa ao enquadramento, nao distancia fisica em centimetros.
  const targetCardWidthPx = 300 * 0.78;
  const cardScalePercent = liveCardWidthPx !== null && Number.isFinite(liveCardWidthPx)
    ? Math.round(liveCardWidthPx / targetCardWidthPx * 100)
    : null;
  const distanceAligned = cardScalePercent !== null && Math.abs(cardScalePercent - 100) <= 5;
  const distanceInstruction = cardScalePercent === null
    ? "Procurando laterais do cartão"
    : cardScalePercent < 95
      ? "APROXIME O CELULAR"
      : cardScalePercent > 105
        ? "AFASTE O CELULAR"
        : "DISTÂNCIA ADEQUADA";

  // Centralizacao estimada pelo alinhamento visual; nao mede paralaxe real.
  const centerKnown = liveOpticalCenterConfidence >= 45 &&
    liveOpticalCenterOffsetPx !== null && liveCardFingerOffsetPx !== null;
  const centerOffset = centerKnown ? liveOpticalCenterOffsetPx! : 0;
  const cardFingerOffset = centerKnown ? liveCardFingerOffsetPx! : 0;
  const centerAligned = centerKnown &&
    Math.abs(centerOffset) <= 6 && Math.abs(cardFingerOffset) <= 5;
  const centerInstruction = !centerKnown ? "PROCURANDO DEDO E CARTÃO"
    : centerOffset > 6 ? "← MOVA O CELULAR PARA A ESQUERDA"
    : centerOffset < -6 ? "MOVA O CELULAR PARA A DIREITA →"
    : Math.abs(cardFingerOffset) > 5 ? "CENTRE O CARTÃO SOBRE O DEDO"
    : "✓ ENQUADRAMENTO CENTRALIZADO";
  const autoCaptureTimerRef = useRef<number | null>(null);
  const autoCaptureLockedRef = useRef(false);

  const clampLevel = (value:number, max:number) =>
    Math.max(-1, Math.min(1, value / max));

  // DEDO: horizontal = inclinacao; vertical = cartao em relacao ao dedo.
  const fingerX =
    liveFingerTiltDeg === null || liveFingerTiltConfidence < 45
      ? 0
      : clampLevel(liveFingerTiltDeg, 7) * 34;
  const fingerY =
    liveCardFingerOffsetPx === null || liveOpticalCenterConfidence < 45
      ? 0
      : clampLevel(liveCardFingerOffsetPx, 18) * 34;

  // CELULAR: nivel bidimensional real usando roll e pitch.
  const phoneX =
    deviceRoll === null ? 0 : clampLevel(deviceRoll, 8) * 34;
  const phoneY =
    devicePitch === null ? 0 : clampLevel(devicePitch, 14) * 34;

  const fingerReady =
    liveFingerTiltDeg !== null &&
    liveFingerTiltConfidence >= 45 &&
    Math.abs(liveFingerTiltDeg) <= 1.5 &&
    liveCardFingerOffsetPx !== null &&
    liveOpticalCenterConfidence >= 45 &&
    Math.abs(liveCardFingerOffsetPx) <= 5;

  const phoneReady =
    devicePitch !== null &&
    deviceRoll !== null &&
    Math.abs(devicePitch) <= 6 &&
    Math.abs(deviceRoll) <= 3;

  const levelReady =
    singlePhotoTestMode &&
    cardReady &&
    fingerReady &&
    phoneReady &&
    !cameraOpening;

  useEffect(() => {
    if (!levelReady) {
      if (autoCaptureTimerRef.current !== null) {
        window.clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
      autoCaptureLockedRef.current = false;
      return;
    }

    if (autoCaptureLockedRef.current || autoCaptureTimerRef.current !== null) return;

    autoCaptureTimerRef.current = window.setTimeout(() => {
      autoCaptureTimerRef.current = null;
      if (!levelReady || autoCaptureLockedRef.current) return;
      autoCaptureLockedRef.current = true;
      onCapture();
    }, 700);

    return () => {
      if (autoCaptureTimerRef.current !== null) {
        window.clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [levelReady, onCapture]);

  return (
    <section className="camera-screen">
      <div className="camera-top">
        <button className="icon-button" onClick={onClose}>×</button>
        <span>Fotografe de cima</span>
      </div>
      <div className="viewport">
        <video ref={videoRef} playsInline muted autoPlay />
        {singlePhotoTestMode && (
          <div role="status" aria-live="polite" style={{
            position:"absolute",top:8,left:12,right:120,zIndex:60,
            background:"rgba(10,12,13,.88)",borderRadius:9,
            padding:"8px 9px",pointerEvents:"none",
            color:cardReady&&centerAligned?"#52e0a3":"#ffe19d",
            fontSize:12,fontWeight:800
          }}>
            {!cardReady?"ENQUADRE O CARTÃO":!centerKnown?"CENTRE O DEDO":!centerAligned?centerInstruction:!phoneReady?"NIVELE O CELULAR":"✓ PRONTO PARA FOTO"}
          </div>
        )}
        <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} style={{zIndex:100,top:8,right:8,position:"absolute"}} onClick={onToggleTorch}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
        {calibrationStep === "measurement" && !singlePhotoTestMode && referenceCardWidthPercent !== null && (
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
            <span style={{display:singlePhotoTestMode?"none":undefined}}>{cardReady ? "✓ ALINHADO — PODE CAPTURAR" : "ENCAIXE O CARTÃO"}</span>
            <i className="card-guide-corner tl" />
            <i className="card-guide-corner tr" />
            <i className="card-guide-corner br" />
            <i className="card-guide-corner bl" />
          </div>

          <div className={`camera-angle-guide ${cameraAngleGuide}`} style={{display:singlePhotoTestMode?"none":undefined}}>
            <span className="angle-arrow forward">↑</span>
            <strong>
              {cameraAngleGuide === "forward" ? "INCLINE A CÂMERA PARA FRENTE" :
               cameraAngleGuide === "backward" ? "INCLINE A CÂMERA PARA TRÁS" :
               cameraAngleGuide === "aligned" ? "✓ ÂNGULO CORRETO" :
               "AJUSTE O ÂNGULO"}
            </strong>
            <span className="angle-arrow backward">↓</span>
          </div>

          <div
            aria-hidden="true"
            style={{
              position:"absolute",
              left:"37%",
              top:"8%",
              bottom:"7%",
              width:2,
              transform:"translateX(-50%)",
              borderRadius:999,
              background:"rgba(255,255,255,.58)",
              boxShadow:"0 0 0 1px rgba(0,0,0,.35), 0 0 7px rgba(255,255,255,.16)",
              pointerEvents:"none",
            }}
          />
          <div className="live-finger-axis" style={{display:singlePhotoTestMode?"none":undefined}}>
            <span>{fingerReady ? "✓ DEDO RETO" : "ALINHE O DEDO"}</span>
          </div>


          <div
            aria-hidden="true"
            style={{
              position:"absolute",
              left:"63%",
              top:"8%",
              bottom:"7%",
              width:2,
              transform:"translateX(-50%)",
              borderRadius:999,
              background:"rgba(255,255,255,.58)",
              boxShadow:"0 0 0 1px rgba(0,0,0,.35), 0 0 7px rgba(255,255,255,.16)",
              pointerEvents:"none",
            }}
          />
        </div>
        {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
      </div>
      <p style={{display:singlePhotoTestMode?"none":undefined}}>{cardReady
        ? (singlePhotoTestMode
            ? "Tudo verde. Capture o cartão já posicionado sobre o dedo."
            : calibrationStep === "reference"
              ? "Tudo verde. Toque no botão para capturar o cartão na base plana."
              : "Aproxime ou afaste o celular até o cartão coincidir com a guia da Foto 1. Depois capture manualmente.")
        : cameraAngleGuide === "forward"
          ? "Incline levemente a câmera para frente até o indicador ficar verde."
          : cameraAngleGuide === "backward"
            ? "Incline levemente a câmera para trás até o indicador ficar verde."
            : singlePhotoTestMode
              ? "Modo 1 foto: coloque o cartão sobre o dedo, enquadre na moldura e ajuste o ângulo até ficar verde."
              : calibrationStep === "reference"
                ? "Coloque o cartão em uma base plana, enquadre na moldura e ajuste o ângulo até ficar verde."
                : "Coloque o cartão sobre o dedo e ajuste a distância do celular até o cartão coincidir com a guia fantasma da Foto 1."}</p>
      <button className={`shutter${cardReady ? " ready" : ""}`} style={{display:"block",margin:"0 auto"}} onClick={onCapture} aria-label="Capturar foto manualmente"><span /></button>
      {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={onRetry}>Tentar novamente</button></>}
    </section>
  );
}

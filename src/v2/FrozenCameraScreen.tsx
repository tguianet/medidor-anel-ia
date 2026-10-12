import { useEffect, useRef, useState, type RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  torchOn: boolean;
  torchSupported: boolean;
  onToggleTorch: () => void;
  cardReady: boolean;
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
  videoRef, torchOn, torchSupported, onToggleTorch, cardReady, calibrationStep, cameraAngleGuide,
  liveFingerTiltDeg = null, liveFingerTiltConfidence = 0,
  liveOpticalCenterOffsetPx = null, liveCardFingerOffsetPx = null, liveOpticalCenterConfidence = 0,
  devicePitch = null, deviceRoll = null,
  cameraOpening, error,
  referenceCardWidthPercent = null, referenceCardAngleDeg = null, singlePhotoTestMode = false,
  onClose, onCapture, onRetry,
}: Props) {
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
        <div
          aria-live="polite"
          style={{
            display:"none",
            position:"absolute",
            top:18,
            left:"50%",
            transform:"translateX(-50%)",
            zIndex:50,
            minWidth:"230px",
            maxWidth:"calc(100% - 28px)",
            padding:"10px 14px",
            borderRadius:14,
            border:`2px solid ${
              liveFingerTiltDeg!==null && Math.abs(liveFingerTiltDeg)<=1.5
                ? "#52e0a3"
                : "#f0c75e"
            }`,
            background:"rgba(18,18,18,.88)",
            color:
              liveFingerTiltDeg!==null && Math.abs(liveFingerTiltDeg)<=1.5
                ? "#52e0a3"
                : "#f5d477",
            fontWeight:800,
            textAlign:"center",
            lineHeight:1.25,
            boxShadow:"0 4px 18px rgba(0,0,0,.38)",
            pointerEvents:"none",
          }}
        >
          {liveFingerTiltDeg===null || liveFingerTiltConfidence<45
            ? "DEDO: procurando inclinação..."
            : Math.abs(liveFingerTiltDeg)<=1.5
              ? `✓ DEDO RETO · ${Math.abs(liveFingerTiltDeg).toFixed(1)}°`
              : `DEDO ${Math.abs(liveFingerTiltDeg).toFixed(1)}° · AJUSTE ATÉ 0°`}
        </div>
        <div
          aria-live="polite"
          style={{
            display:"none",
            position:"absolute",
            top:88,
            left:"50%",
            transform:"translateX(-50%)",
            zIndex:49,
            minWidth:"250px",
            maxWidth:"calc(100% - 28px)",
            padding:"9px 12px",
            borderRadius:12,
            border:`2px solid ${
              liveOpticalCenterOffsetPx!==null &&
              liveCardFingerOffsetPx!==null &&
              Math.abs(liveOpticalCenterOffsetPx)<=6 &&
              Math.abs(liveCardFingerOffsetPx)<=5
                ? "#52e0a3"
                : "#7ec4ff"
            }`,
            background:"rgba(12,18,24,.88)",
            color:
              liveOpticalCenterOffsetPx!==null &&
              liveCardFingerOffsetPx!==null &&
              Math.abs(liveOpticalCenterOffsetPx)<=6 &&
              Math.abs(liveCardFingerOffsetPx)<=5
                ? "#52e0a3"
                : "#9ed2ff",
            fontWeight:800,
            textAlign:"center",
            lineHeight:1.25,
            boxShadow:"0 4px 18px rgba(0,0,0,.32)",
            pointerEvents:"none",
          }}
        >
          {liveOpticalCenterOffsetPx===null || liveCardFingerOffsetPx===null || liveOpticalCenterConfidence<45
            ? "CELULAR: procurando centro óptico..."
            : Math.abs(liveOpticalCenterOffsetPx)<=6 && Math.abs(liveCardFingerOffsetPx)<=5
              ? `✓ CELULAR CENTRALIZADO · centro ${liveOpticalCenterOffsetPx.toFixed(1)} px · cartão↔dedo ${liveCardFingerOffsetPx.toFixed(1)} px`
              : liveOpticalCenterOffsetPx>6
                ? `← MOVA O CELULAR PARA A ESQUERDA · centro +${liveOpticalCenterOffsetPx.toFixed(1)} px`
                : liveOpticalCenterOffsetPx<-6
                  ? `MOVA O CELULAR PARA A DIREITA → · centro ${liveOpticalCenterOffsetPx.toFixed(1)} px`
                  : `CENTRE CARTÃO SOBRE O DEDO · diferença ${liveCardFingerOffsetPx.toFixed(1)} px`}
        </div>
        {singlePhotoTestMode && (
          <div
            aria-label="Nivel visual de alinhamento do dedo e do celular"
            style={{
              position:"absolute",
              left:"50%",
              top:18,
              zIndex:50,
              transform:"translateX(-50%)",
              display:"grid",
              justifyItems:"center",
              gap:7,
              width:"min(270px, calc(100% - 110px))",
              pointerEvents:"none",
            }}
          >
            <div
              style={{
                position:"relative",
                width:112,
                height:112,
                borderRadius:"50%",
                border:`3px solid ${levelReady ? "#52e0a3" : "rgba(242,207,115,.88)"}`,
                background:"rgba(8,8,8,.62)",
                boxShadow:levelReady
                  ? "0 0 22px rgba(82,224,163,.55)"
                  : "0 0 16px rgba(0,0,0,.45)",
                transition:"border-color .15s ease, box-shadow .15s ease",
              }}
            >
              <span style={{position:"absolute",left:"50%",top:8,bottom:8,width:1,background:"rgba(255,255,255,.16)",transform:"translateX(-50%)"}} />
              <span style={{position:"absolute",top:"50%",left:8,right:8,height:1,background:"rgba(255,255,255,.16)",transform:"translateY(-50%)"}} />

              <span
                aria-hidden="true"
                style={{
                  position:"absolute",
                  left:"50%",
                  top:"50%",
                  width:34,
                  height:34,
                  borderRadius:"50%",
                  border:`2px solid ${levelReady ? "#52e0a3" : "rgba(255,255,255,.55)"}`,
                  transform:"translate(-50%,-50%)",
                  boxShadow:levelReady ? "0 0 12px rgba(82,224,163,.7)" : "none",
                }}
              />

              <span
                title="Celular"
                style={{
                  position:"absolute",
                  left:`calc(50% + ${phoneX.toFixed(1)}px)`,
                  top:`calc(50% + ${phoneY.toFixed(1)}px)`,
                  width:14,
                  height:14,
                  borderRadius:"50%",
                  transform:"translate(-50%,-50%)",
                  background:phoneReady ? "#52e0a3" : "#79c8ff",
                  border:"2px solid rgba(0,0,0,.55)",
                  boxShadow:"0 0 9px rgba(121,200,255,.8)",
                  transition:"left .10s linear, top .10s linear, background .15s ease",
                }}
              />
            </div>

            <strong
              style={{
                padding:"4px 9px",
                borderRadius:999,
                color:levelReady ? "#071b14" : "#f5dfaa",
                background:levelReady ? "#52e0a3" : "rgba(10,9,7,.78)",
                fontSize:10,
                letterSpacing:".04em",
              }}
            >
              {phoneReady ? "✓ CELULAR CENTRALIZADO" : "CENTRALIZE A BOLINHA"}
            </strong>

          </div>
        )}
        {singlePhotoTestMode && (() => {
          // PRUMO DO DEDO: ponteiro inclina junto com o dedo; verde quando reto.
          const has=liveFingerTiltDeg!==null && liveFingerTiltConfidence>=45;
          const deg=has ? Math.max(-15, Math.min(15, liveFingerTiltDeg as number)) : 0;
          const ok=has && Math.abs(liveFingerTiltDeg as number)<=1.5;
          const color=!has ? "rgba(255,255,255,.55)" : ok ? "#52e0a3" : Math.abs(liveFingerTiltDeg as number)<=5 ? "#f2cf73" : "#ff9f5a";
          return (
            <div
              aria-label="Prumo do ângulo do dedo"
              style={{position:"absolute",left:"50%",bottom:14,transform:"translateX(-50%)",zIndex:50,display:"grid",justifyItems:"center",gap:4,pointerEvents:"none"}}
            >
              <div style={{position:"relative",width:150,height:78,overflow:"hidden"}}>
                <div style={{position:"absolute",left:0,right:0,top:0,height:150,borderRadius:"50%",border:`3px solid ${color}`,background:"rgba(8,8,8,.62)",boxShadow:ok?"0 0 18px rgba(82,224,163,.55)":"0 0 12px rgba(0,0,0,.45)"}} />
                {[-10,-5,0,5,10].map(t=>(
                  <span key={t} style={{position:"absolute",left:"50%",top:6,width:t===0?3:1.5,height:t===0?16:9,background:t===0?"#52e0a3":"rgba(255,255,255,.55)",transformOrigin:"50% 69px",transform:`translateX(-50%) rotate(${t*4}deg)`}} />
                ))}
                <span style={{position:"absolute",left:"50%",top:10,width:4,height:64,borderRadius:2,background:color,transformOrigin:"50% 64px",transform:`translateX(-50%) rotate(${(deg*4).toFixed(1)}deg)`,transition:"transform .12s linear, background .15s ease",boxShadow:`0 0 8px ${color}`}} />
                <span style={{position:"absolute",left:"50%",top:66,width:14,height:14,borderRadius:"50%",background:color,transform:"translateX(-50%)",border:"2px solid rgba(0,0,0,.55)"}} />
              </div>
              <strong style={{padding:"4px 10px",borderRadius:999,fontSize:11,letterSpacing:".04em",color:ok?"#071b14":"#f5dfaa",background:ok?"#52e0a3":"rgba(10,9,7,.8)"}}>
                {!has ? "DEDO: procurando…" : ok ? `✓ DEDO RETO · ${Math.abs(liveFingerTiltDeg as number).toFixed(1)}°` : `DEDO ${Math.abs(liveFingerTiltDeg as number).toFixed(1)}° · endireite até o ponteiro ficar verde`}
              </strong>
            </div>
          );
        })()}

        <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} onClick={onToggleTorch}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
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
          <div className="live-finger-axis">
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
      <p>{cardReady
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

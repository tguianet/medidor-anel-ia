import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react";
import { clamp } from "../ringCalculation";
import { RING_MODELS, wearableRingImage, type DragTarget, type RingMetal, type RingStyle } from "../types";

type Props = {
  measureRef: RefObject<HTMLDivElement | null>;
  handPhoto: string;
  showcaseX: number;
  showcaseY: number;
  showcaseWidth: number;
  showcaseAngle: number;
  ringMetal: RingMetal;
  ringStyle: RingStyle;
  ringBandWidth: number;
  ringSize: number | null;
  setShowcaseWidth: Dispatch<SetStateAction<number>>;
  setShowcaseAngle: Dispatch<SetStateAction<number>>;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: () => void;
  onStartDrag: (target: DragTarget, event: ReactPointerEvent) => void;
  onStartShowcaseDrag: (event: ReactPointerEvent) => void;
  onRetakePhoto: () => void;
  onBackToReview: () => void;
};

export default function HandReviewScreen({
  measureRef, handPhoto, showcaseX, showcaseY, showcaseWidth, showcaseAngle,
  ringMetal, ringStyle, ringBandWidth, ringSize,
  setShowcaseWidth, setShowcaseAngle,
  onPointerMove, onPointerUp, onPointerCancel, onStartDrag, onStartShowcaseDrag,
  onRetakePhoto, onBackToReview,
}: Props) {
  return (
    <section className="panel hand-result">
      <span className="step">PROVADOR NA MÃO INTEIRA</span>
      <h1>Ajuste o anel no dedo</h1>
      <p className="lead">Arraste o anel até o dedo e encaixe as linhas magnéticas nas duas bordas. O anel será centralizado automaticamente.</p>
      <div
        ref={measureRef}
        className="measurement-stage hand-showcase"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {handPhoto && <img src={handPhoto} alt="Foto da mão inteira com anel virtual" draggable={false} />}
        <button className="showcase-caliper left" style={{ left: `${showcaseX - showcaseWidth / 2}%`, top: `${showcaseY - 10}%` }} onPointerDown={(event) => onStartDrag("showcase-left", event)} aria-label="Ajustar borda esquerda do dedo"><span /></button>
        <button className="showcase-caliper right" style={{ left: `${showcaseX + showcaseWidth / 2}%`, top: `${showcaseY - 10}%` }} onPointerDown={(event) => onStartDrag("showcase-right", event)} aria-label="Ajustar borda direita do dedo"><span /></button>
        <div className="showcase-magnetic-line" style={{ left: `${showcaseX - showcaseWidth / 2}%`, top: `${showcaseY}%`, width: `${showcaseWidth}%` }} aria-hidden="true" />
        <button
          type="button"
          className={`virtual-ring showcase-ring metal-${ringMetal} style-${ringStyle}`}
          style={{
            left: `${showcaseX}%`,
            top: `${showcaseY}%`,
            width: `${showcaseWidth}%`,
            height: `${clamp(showcaseWidth * ringBandWidth / 15, 2.4, 11)}%`,
            transform: `translate(-50%, -50%) rotate(${showcaseAngle}deg)`,
          }}
          onPointerDown={onStartShowcaseDrag}
          aria-label="Arraste o anel para posicionar"
        >
          <img src={wearableRingImage(ringStyle)} alt="" />
        </button>
      </div>
      <div className="showcase-controls">
        <div><span>Tamanho</span><button type="button" onClick={() => setShowcaseWidth((value) => clamp(value - 2, 10, 50))}>−</button><strong>{showcaseWidth}%</strong><button type="button" onClick={() => setShowcaseWidth((value) => clamp(value + 2, 10, 50))}>+</button></div>
        <div><span>Inclinação</span><button type="button" onClick={() => setShowcaseAngle((value) => value - 3)}>↶</button><strong>{showcaseAngle}°</strong><button type="button" onClick={() => setShowcaseAngle((value) => value + 3)}>↷</button></div>
      </div>
      <div className="hand-result-summary"><strong>{RING_MODELS.find((model) => model.id === ringStyle)?.label} · {ringBandWidth} mm</strong><span>{ringSize !== null ? `Aro ${ringSize}` : "Modelo selecionado"}</span></div>
      <div className="review-actions">
        <button className="secondary" type="button" onClick={onRetakePhoto}>Tirar outra foto</button>
        <button className="primary" type="button" onClick={onBackToReview}>Voltar aos modelos</button>
      </div>
    </section>
  );
}

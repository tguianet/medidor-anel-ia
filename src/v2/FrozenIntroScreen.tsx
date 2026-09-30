import { useState } from "react";

type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function FrozenIntroScreen({ error, onMeasureFinger }: Props) {
  const [showPresentation, setShowPresentation] = useState(true);
  const [videoAvailable, setVideoAvailable] = useState(true);

  return (
    <section className="panel intro">
      <span className="step">MEDIDOR DE ANEL</span>
      <h1>Descubra seu tamanho</h1>

      {showPresentation && videoAvailable && (
        <div
          style={{
            position:"relative",
            overflow:"hidden",
            margin:"12px 0 16px",
            border:"1px solid rgba(220,180,90,.55)",
            borderRadius:18,
            background:"#050505",
            boxShadow:"0 12px 30px rgba(0,0,0,.35)",
          }}
        >
          <video
            src="/medidor-apresentacao.mp4"
            controls
            playsInline
            preload="metadata"
            onError={() => setVideoAvailable(false)}
            style={{
              display:"block",
              width:"100%",
              aspectRatio:"16 / 9",
              objectFit:"contain",
              background:"#000",
            }}
          />

          <button
            type="button"
            onClick={() => setShowPresentation(false)}
            aria-label="Ocultar apresentação"
            style={{
              position:"absolute",
              top:10,
              right:10,
              zIndex:3,
              minWidth:38,
              height:38,
              padding:"0 11px",
              border:"1px solid rgba(255,255,255,.38)",
              borderRadius:999,
              color:"#fff",
              background:"rgba(0,0,0,.72)",
              fontSize:18,
              fontWeight:900,
              cursor:"pointer",
            }}
          >
            ×
          </button>
        </div>
      )}

      {!showPresentation && videoAvailable && (
        <button
          type="button"
          className="secondary"
          onClick={() => setShowPresentation(true)}
          style={{marginBottom:14}}
        >
          Ver apresentação
        </button>
      )}

      <p className="lead">
        Assista à apresentação ou toque em COMEÇAR para ir direto à medição.
      </p>

      <button
        className="primary"
        onClick={onMeasureFinger}
        style={{marginTop:10}}
      >
        COMEÇAR
      </button>

      <p style={{margin:"10px 0 0",fontSize:12,opacity:.66,textAlign:"center"}}>
        Você pode começar a medição a qualquer momento, sem precisar assistir ao vídeo completo.
      </p>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

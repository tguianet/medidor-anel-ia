import { useState } from "react";

type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function FrozenIntroScreen({ error, onMeasureFinger }: Props) {
  const [showPresentation, setShowPresentation] = useState(true);
  const [videoAvailable, setVideoAvailable] = useState(true);

  return (
    <section className="panel intro intro-lux">
      <div className="intro-lux-glow" aria-hidden="true" />
      <span className="intro-lux-kicker">◇ MEDIDOR DE ANEL</span>
      <h1 className="intro-lux-title">
        Descubra o <em>número</em> do seu anel
      </h1>
      <p className="intro-lux-sub">Só com o celular e um cartão comum. Leva menos de um minuto.</p>

      {showPresentation && videoAvailable && (
        <div className="intro-lux-video">
          <video
            src="/medidor-apresentacao.mp4"
            controls
            playsInline
            preload="metadata"
            onError={() => setVideoAvailable(false)}
          />
          <button
            type="button"
            className="intro-lux-video-close"
            onClick={() => setShowPresentation(false)}
            aria-label="Ocultar apresentação"
          >
            ×
          </button>
        </div>
      )}

      {!showPresentation && videoAvailable && (
        <button type="button" className="intro-lux-link" onClick={() => setShowPresentation(true)}>
          ▶ Ver como funciona
        </button>
      )}

      <ol className="intro-lux-steps">
        <li><span>1</span><div><strong>Apoie a mão</strong><small>Cartão deitado sobre os dedos</small></div></li>
        <li><span>2</span><div><strong>Fotografe de cima</strong><small>Dedo do anel no centro da tela</small></div></li>
        <li><span>3</span><div><strong>Ajuste as linhas</strong><small>Nas bordas do cartão e do dedo</small></div></li>
      </ol>

      <button className="primary intro-lux-cta" onClick={onMeasureFinger}>
        Começar medição
      </button>

      <p className="intro-lux-note">Você recebe o número exato e as opções justa e confortável.</p>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

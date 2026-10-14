import { useState } from "react";


// Ícones em SVG (não dependem de fonte externa).
const ICONS: Record<string, string> = {
  token: "M12 2l8 5v10l-8 5-8-5V7l8-5zm0 3.3L6.5 8.7v6.6L12 18.7l5.5-3.4V8.7L12 5.3z",
  straighten: "M3 7h18v10H3V7zm2 2v6h14V9h-1v3h-2V9h-1v2h-2V9h-1v3h-2V9h-1v2H9V9H8v3H6V9H5z",
  verified: "M12 2l2.4 1.8 3 .2.9 2.9 2.4 1.8-1 2.9 1 2.9-2.4 1.8-.9 2.9-3 .2L12 22l-2.4-1.8-3-.2-.9-2.9-2.4-1.8 1-2.9-1-2.9 2.4-1.8.9-2.9 3-.2L12 2zm-1.2 13.6l5.7-5.7-1.4-1.4-4.3 4.3-2.1-2.1-1.4 1.4 3.5 3.5z",
  pan_tool: "M8 5.5a1.5 1.5 0 013 0V11h1V3.5a1.5 1.5 0 013 0V11h1V5.5a1.5 1.5 0 013 0V15c0 3.9-3.1 7-7 7-2.4 0-4.3-1.1-5.7-3.1L3 14.6a1.5 1.5 0 012.5-1.7L8 15.6V5.5z",
  credit_card: "M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm1 4v8h16V9H4zm0-2h16V7H4zm2 6h5v2H6v-2z",
  photo_camera: "M9 4h6l1.5 2H20a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h3.5L9 4zm3 4.5A4.5 4.5 0 1012 17.5a4.5 4.5 0 000-9zm0 2a2.5 2.5 0 110 5 2.5 2.5 0 010-5z",
  center_focus_strong: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 15H2v5a2 2 0 002 2h5v-2H4v-5zm0-11h5V2H4a2 2 0 00-2 2v5h2V4zm16-2h-5v2h5v5h2V4a2 2 0 00-2-2zm0 18h-5v2h5a2 2 0 002-2v-5h-2v5z",
  lock: "M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v10a1 1 0 01-1 1H6a1 1 0 01-1-1V11a1 1 0 011-1h1zm2 0h6V7a3 3 0 00-6 0v3z",
  stars: "M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7L12 2z",
};
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <svg className={`home-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} fill="currentColor" />
  </svg>
);

type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function FrozenIntroScreen({ error, onMeasureFinger }: Props) {
  const [showPresentation, setShowPresentation] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(true);

  return (
    <section className="home-lux">
      <div className="home-glow" aria-hidden="true" />

      <div className="home-chip">
        <Icon name="token" />
        PAQUÍMETRO POR FOTO
      </div>
      <h1 className="home-title">
        Descubra o <em>número exato</em> do seu anel.
      </h1>
      <p className="home-sub">
        Apenas com a câmera do celular e um cartão padrão como referência. Em menos de 60 segundos.
      </p>

      <div className="home-preview">
        <div className="home-preview-stage">
          <div className="home-preview-scrim" aria-hidden="true" />
          <div className="home-hud">
            <div className="home-hud-pill">
              <Icon name="straighten" />
              EXEMPLO · ARO <strong>25</strong>
            </div>
            <div className="home-caliper" aria-hidden="true">
              <div className="home-caliper-arm"><i /><b /></div>
              <div className="home-caliper-line" />
              <div className="home-caliper-arm"><i /><b /></div>
            </div>
            <div className="home-tolerance">
              <span>Justo 24</span><em>✦</em><strong>Exato 25</strong><em>✦</em><span>Conforto 26</span>
            </div>
          </div>
          <div className="home-scan" aria-hidden="true" />
        </div>
        <div className="home-preview-foot">
          <span><Icon name="verified" className="home-ok" />Escala pelo cartão (85,60 mm)</span>
          {videoAvailable && (
            <button type="button" className="home-video-link" onClick={() => setShowPresentation((v) => !v)}>
              {showPresentation ? "Fechar vídeo" : "▶ Ver como funciona"}
            </button>
          )}
        </div>
      </div>

      {showPresentation && videoAvailable && (
        <div className="home-video">
          <video
            src="/medidor-apresentacao.mp4"
            controls
            playsInline
            preload="metadata"
            onError={() => setVideoAvailable(false)}
          />
        </div>
      )}

      <div className="home-steps-label">Como funciona em 3 passos</div>
      <ol className="home-steps">
        <li>
          <span className="home-step-n">1</span>
          <div><strong>Apoie a mão</strong><small>Mão espalmada sobre uma mesa bem iluminada.</small></div>
          <Icon name="pan_tool" className="home-step-ico" />
        </li>
        <li>
          <span className="home-step-n">2</span>
          <div><strong>Use qualquer cartão</strong><small>Cartão deitado sobre os dedos, como régua.</small></div>
          <Icon name="credit_card" className="home-step-ico" />
        </li>
        <li>
          <span className="home-step-n">3</span>
          <div><strong>Fotografe de cima</strong><small>Dedo no centro; depois ajuste as linhas.</small></div>
          <Icon name="photo_camera" className="home-step-ico" />
        </li>
      </ol>

      <button type="button" className="home-cta" onClick={() => { try { navigator.vibrate?.(25); } catch { /* sem vibração */ } onMeasureFinger(); }}>
        <Icon name="center_focus_strong" />
        Começar medição agora
      </button>
      <div className="home-safe">
        <Icon name="lock" />
        Sem cadastro · leva menos de 1 minuto
      </div>

      <div className="home-foot">
        <div><Icon name="stars" />Justo · Exato · Conforto</div>
        <p>Você recebe o número exato e também uma opção mais justa e uma mais confortável.</p>
      </div>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function CommercialIntroScreen({ error, onMeasureFinger }: Props) {
  return (
    <section className="commercial-hero">
      <div className="commercial-hero-glow commercial-hero-glow-a" />
      <div className="commercial-hero-glow commercial-hero-glow-b" />

      <div className="commercial-brand">
        <div className="commercial-ring-mark" aria-hidden="true">
          <span className="commercial-ring-orbit commercial-ring-orbit-a" />
          <span className="commercial-ring-orbit commercial-ring-orbit-b" />
          <span className="commercial-ring-gem" />
        </div>
        <div>
          <div className="commercial-brand-title">Medidor de</div>
          <div className="commercial-brand-title">Anel IA</div>
        </div>
      </div>

      <div className="commercial-hero-copy">
        <span className="commercial-kicker">MEDIÇÃO INTELIGENTE</span>
        <h1>
          Descubra o <em>aro ideal</em><br />
          do seu anel<br />
          em <em>segundos</em>
        </h1>
        <p>
          Uma única captura com o cartão sobre o dedo. O sistema calibra,
          mede e apresenta o resultado automaticamente.
        </p>
      </div>

      <div className="commercial-benefits">
        <div className="commercial-benefit">
          <span className="commercial-benefit-icon commercial-card-icon" aria-hidden="true">
            <i />
          </span>
          <span>Use qualquer<br />cartão bancário</span>
        </div>

        <div className="commercial-benefit">
          <span className="commercial-benefit-icon commercial-target-icon" aria-hidden="true">
            <i />
          </span>
          <span>Apenas 1 foto<br />com o cartão sobre o dedo</span>
        </div>

        <div className="commercial-benefit">
          <span className="commercial-benefit-icon commercial-check-icon" aria-hidden="true">
            <i>✓</i>
          </span>
          <span>Resultado exato<br />e conforto</span>
        </div>
      </div>

      <button className="commercial-start" onClick={onMeasureFinger}>
        <span>COMEÇAR</span>
        <span className="commercial-start-arrow">›</span>
      </button>

      {error && <p className="error commercial-error">{error}</p>}
    </section>
  );
}

type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function CommercialIntroScreen({ error, onMeasureFinger }: Props) {
  return (
    <section className="panel intro commercial-intro commercial-intro-v2">
      <div className="commercial-hero-mark" aria-hidden="true">
        <span className="commercial-ring-icon">◯</span>
        <span className="commercial-ring-spark">✦</span>
      </div>

      <span className="step">MEDIDOR DE ANEL IA</span>
      <h1>
        Descubra o tamanho <em>ideal</em> do seu anel em segundos
      </h1>
      <p className="lead">
        Uma única foto com o cartão sobre o dedo. A calibração e a medição continuam
        usando exatamente o motor atual do sistema.
      </p>

      <div className="commercial-benefits" aria-label="Benefícios">
        <div>
          <span className="commercial-benefit-icon" aria-hidden="true">▣</span>
          <span><strong>Use qualquer cartão</strong><small>O cartão serve como referência física da medida.</small></span>
        </div>
        <div>
          <span className="commercial-benefit-icon" aria-hidden="true">⌖</span>
          <span><strong>Medição inteligente</strong><small>O sistema encontra as bordas e calcula o aro.</small></span>
        </div>
        <div>
          <span className="commercial-benefit-icon" aria-hidden="true">✓</span>
          <span><strong>Resultado fácil de entender</strong><small>Veja as opções justo, exato e conforto.</small></span>
        </div>
      </div>

      <div className="commercial-flow-preview" aria-label="Fluxo de medição">
        <div><b>1</b><span>Posicione</span></div>
        <i aria-hidden="true">›</i>
        <div><b>2</b><span>Meça</span></div>
        <i aria-hidden="true">›</i>
        <div><b>3</b><span>Confira</span></div>
      </div>

      <button className="primary commercial-start" onClick={onMeasureFinger}>
        <span>COMEÇAR MEDIÇÃO</span>
        <b aria-hidden="true">›</b>
      </button>

      <p className="commercial-safe-note">
        Nenhuma alteração foi feita na calibração, nas linhas, na fórmula ou no cálculo do aro.
      </p>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

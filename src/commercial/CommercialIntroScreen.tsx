type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function CommercialIntroScreen({ error, onMeasureFinger }: Props) {
  return (
    <section className="panel intro commercial-intro">
      <span className="step">MEDIDOR DE ANEL</span>
      <h1>Descubra seu tamanho</h1>
      <p className="lead">
        Faça uma única captura com o cartão sobre o dedo. O sistema calibra o cartão,
        localiza as bordas do dedo e calcula automaticamente o seu aro.
      </p>

      <div className="commercial-howto" aria-label="Como medir">
        <div>
          <b>1</b>
          <span><strong>Posicione o cartão</strong><small>Deixe o cartão sobre o dedo e siga as guias da câmera.</small></span>
        </div>
        <div>
          <b>2</b>
          <span><strong>Capture uma vez</strong><small>O sistema escolhe automaticamente o melhor quadro da captura.</small></span>
        </div>
        <div>
          <b>3</b>
          <span><strong>Confira o resultado</strong><small>Você verá o número justo, exato e de conforto.</small></span>
        </div>
      </div>

      <ul className="tips">
        <li>Use boa iluminação e mantenha o celular firme.</li>
        <li>Mantenha o cartão centralizado sobre o dedo.</li>
        <li>Meça a região mais grossa por onde o anel precisa passar.</li>
      </ul>

      <button className="primary" onClick={onMeasureFinger}>Medir meu dedo</button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

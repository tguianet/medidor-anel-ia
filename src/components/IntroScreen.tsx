type Props = {
  error: string;
  onMeasureFinger: () => void;
};

export default function IntroScreen({ error, onMeasureFinger }: Props) {
  return (
    <section className="panel intro">
      <span className="step">MEDIDOR DE ANEL</span>
      <h1>Descubra seu tamanho</h1>
      <p className="lead">
        Faça uma única captura com o cartão sobre o dedo. O sistema calibra o cartão,
        localiza as bordas do dedo e calcula automaticamente o seu aro.
      </p>
      <img
        className="tutorial-image"
        src="/tutorial-medidor.svg"
        alt="Como medir o tamanho do anel em uma única captura"
      />
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

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
        Use a câmera do celular e siga as instruções na tela. O sistema fará a medição e mostrará o número exato e o número de conforto.
      </p>
      <img className="tutorial-image" src="/tutorial-medidor.svg" alt="Passo a passo ilustrado para medir o tamanho do anel" />
      <ul className="tips">
        <li>Use boa iluminação e mantenha o celular firme.</li>
        <li>Siga o alinhamento indicado na tela em cada etapa.</li>
        <li>Meça a região mais grossa por onde o anel precisa passar.</li>
      </ul>
      <button className="primary" onClick={onMeasureFinger}>Medir meu dedo</button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

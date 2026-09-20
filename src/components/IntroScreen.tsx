type Props = {
  error: string;
  onMeasureFinger: () => void;
  onTestSideCard: () => void;
  onTestGauge: () => void;
};

export default function IntroScreen({ error, onMeasureFinger, onTestSideCard, onTestGauge }: Props) {
  return (
    <section className="panel intro">
      <span className="step">MEDIÇÃO MANUAL ASSISTIDA</span>
      <h1>Como medir corretamente</h1>
      <p className="lead">Antes de abrir a câmera, coloque qualquer cartão padrão deitado sobre o dedo. O sistema usa somente a base de 85,60 mm e o formato do cartão para calibrar; a cor não importa.</p>
      <img className="tutorial-image" src="/tutorial-medidor.svg" alt="Passo a passo ilustrado para medir o tamanho do anel" />
      <ul className="tips">
        <li>Use qualquer cartão padrão de 85,60 × 53,98 mm, de qualquer cor.</li>
        <li>Deixe o cartão inteiro visível na foto, sem cobrir o ponto do anel.</li>
        <li>Mantenha cartão, dedos e câmera paralelos.</li>
        <li>Na câmera, mantenha o dedo reto sobre a linha vertical.</li>
      </ul>
      <button className="primary" onClick={onMeasureFinger}>Medir meu dedo</button>
      <button className="secondary" onClick={onTestSideCard}>Área de teste: cartão ao lado</button>
      <button className="secondary" onClick={onTestGauge}>Testar no anelímetro</button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

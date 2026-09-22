type Props = {
  error: string;
  onMeasureFinger: () => void;
  onTestGauge: () => void;
  onTestDiameterPhoto: () => void;
};

export default function IntroScreen({ error, onMeasureFinger, onTestGauge, onTestDiameterPhoto }: Props) {
  return (
    <section className="panel intro">
      <span className="step">MEDIÇÃO MANUAL ASSISTIDA</span>
      <h1>Como medir corretamente</h1>
      <p className="lead">A medição do dedo agora usa duas fotos: primeiro calibre uma reta de 85,60 mm com o cartão em uma superfície plana; depois ajuste a mesma reta no cartão colocado sobre o dedo.</p>
      <img className="tutorial-image" src="/tutorial-medidor.svg" alt="Passo a passo ilustrado para medir o tamanho do anel" />
      <ul className="tips">
        <li>Foto 1: coloque o cartão reto e ajuste a reta exatamente entre as duas extremidades da largura de 85,60 mm.</li>
        <li>Foto 2: coloque o cartão sobre o dedo e reajuste a mesma reta às extremidades do cartão.</li>
        <li>O sistema calcula a nova escala em px/mm usando o comprimento da reta na segunda foto.</li>
        <li>Depois ajuste as duas laterais do dedo para obter o aro pela tabela física.</li>
      </ul>
      <button className="primary" onClick={onMeasureFinger}>Medir meu dedo</button>
      <button className="secondary" onClick={onTestGauge}>Testar no anelímetro</button>
      <button className="secondary" onClick={onTestDiameterPhoto}>Teste diâmetro interno por foto</button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

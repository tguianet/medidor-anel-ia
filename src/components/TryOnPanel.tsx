import { RING_MODELS, ringImage, type RingMetal, type RingStyle } from "../types";

type Props = {
  ringSize: number;
  ringMetal: RingMetal;
  ringBandWidth: number;
  ringStyle: RingStyle;
  onSelectMetal: (metal: RingMetal) => void;
  onSelectBandWidth: (width: number) => void;
  onSelectStyle: (style: RingStyle) => void;
  onClose: () => void;
  onGoHandCamera: () => void;
};

const METALS: RingMetal[] = ["gold", "silver", "rose", "black"];
const BAND_WIDTHS = [2, 4, 6, 8];

export default function TryOnPanel({
  ringSize, ringMetal, ringBandWidth, ringStyle, onSelectMetal, onSelectBandWidth, onSelectStyle, onClose, onGoHandCamera,
}: Props) {
  return (
    <section className="try-on-panel">
      <div className="try-on-heading"><div><span>PROVADOR VIRTUAL</span><strong>Aro {ringSize} no seu dedo</strong></div><button type="button" onClick={onClose}>×</button></div>
      <label>Cor do metal</label>
      <div className="choice-row metal-choices">
        {METALS.map((metal) => <button key={metal} type="button" className={`${metal}${ringMetal === metal ? " selected" : ""}`} onClick={() => onSelectMetal(metal)} aria-label={`Selecionar ${metal}`} />)}
      </div>
      <label>Largura da aliança</label>
      <div className="choice-row width-choices">
        {BAND_WIDTHS.map((width) => <button key={width} type="button" className={ringBandWidth === width ? "selected" : ""} onClick={() => onSelectBandWidth(width)}>{width} mm</button>)}
      </div>
      <label>Modelo</label>
      <div className="choice-row style-choices">
        {RING_MODELS.map((model) => (
          <button key={model.id} type="button" className={ringStyle === model.id ? "selected" : ""} onClick={() => onSelectStyle(model.id)}>
            <img src={ringImage(model.id)} alt="" />
            <span>{model.label}</span>
          </button>
        ))}
      </div>
      <button className="secondary back-to-measure" type="button" onClick={onClose}>Voltar ao ajuste</button>
      <div className="full-hand-question">
        <strong>Quer ver este anel em uma foto da mão inteira?</strong>
        <span>Vamos manter o modelo, a cor, a largura e o aro escolhidos.</span>
        <button className="primary" type="button" onClick={onGoHandCamera}>Sim, tirar foto da mão</button>
      </div>
    </section>
  );
}

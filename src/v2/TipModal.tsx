// Avisos de orientação (só visual): explicam ao cliente como tirar a foto,
// calibrar o cartão e ajustar o dedo. Não alteram nenhuma medida.

export type TipKind = "photo" | "card" | "finger";

type Props = {
  kind: TipKind;
  onConfirm: () => void;
  onClose?: () => void;
};

const PhotoArt = () => (
  <img
    className="tip-modal-photo"
    src="/tips/foto-certa.jpg"
    width={800}
    height={520}
    alt="Celular paralelo à mão, cartão reto sobre 2 a 3 dedos e encaixado na moldura"
  />
);

const CardArt = () => (
  <svg viewBox="0 0 320 170" role="img" aria-label="Linha do cartão certa encostada na borda e errada para dentro">
    <rect x="0" y="0" width="320" height="170" rx="16" fill="#15120c" />
    {/* errado */}
    <g transform="translate(18 26)">
      <rect x="22" y="0" width="110" height="106" rx="8" fill="#2f5fb3" />
      <line x1="40" y1="-10" x2="40" y2="118" stroke="#ff6b5e" strokeWidth="3" />
      <text x="70" y="132" textAnchor="middle" fill="#ff8f85" fontSize="12" fontWeight="800">✕ Para dentro</text>
    </g>
    {/* certo */}
    <g transform="translate(168 26)">
      <rect x="22" y="0" width="110" height="106" rx="8" fill="#2f5fb3" />
      <line x1="22" y1="-10" x2="22" y2="118" stroke="#52e0a3" strokeWidth="3" />
      <text x="70" y="132" textAnchor="middle" fill="#52e0a3" fontSize="12" fontWeight="800">✓ Na borda</text>
    </g>
  </svg>
);

const FingerArt = () => (
  <svg viewBox="0 0 320 180" role="img" aria-label="Lupa mostrando a linha no começo da pele, sem a sombra">
    <rect x="0" y="0" width="320" height="180" rx="16" fill="#15120c" />
    {/* dedo com sombra */}
    <rect x="44" y="10" width="78" height="160" rx="10" fill="#000" opacity=".35" />
    <rect x="52" y="10" width="62" height="160" rx="10" fill="#e2ab8a" />
    <line x1="52" y1="10" x2="52" y2="170" stroke="#52e0a3" strokeWidth="2.5" />
    <line x1="114" y1="10" x2="114" y2="170" stroke="#52e0a3" strokeWidth="2.5" />
    <line x1="46" y1="100" x2="120" y2="100" stroke="#ffd86b" strokeWidth="2.5" />
    {/* lupa */}
    <g transform="translate(218 90)">
      <circle r="70" fill="#211a12" stroke="#52e0a3" strokeWidth="3" />
      <clipPath id="tipLoupe"><circle r="67" /></clipPath>
      <g clipPath="url(#tipLoupe)">
        <rect x="-70" y="-70" width="140" height="140" fill="#3a3329" />
        <rect x="-40" y="-70" width="34" height="140" fill="#1b1712" />
        <rect x="-6" y="-70" width="80" height="140" fill="#e2ab8a" />
        <line x1="-6" y1="-70" x2="-6" y2="70" stroke="#52e0a3" strokeWidth="3" />
      </g>
      <text x="-34" y="-40" textAnchor="middle" fill="#f3e5ab" fontSize="10" fontWeight="700">sombra</text>
      <text x="32" y="-40" textAnchor="middle" fill="#2a1c12" fontSize="10" fontWeight="800">pele</text>
      <text x="0" y="58" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800">LUPA 10×</text>
    </g>
    <path d="M118 100 L150 96" stroke="#c9a25e" strokeWidth="2" strokeDasharray="4 4" />
  </svg>
);

const CONTENT: Record<TipKind, { step: string; title: string; art: typeof PhotoArt; items: string[]; note?: string; cta: string }> = {
  photo: {
    step: "ANTES DA FOTO",
    title: "Como tirar a foto certa",
    art: PhotoArt,
    items: [
      "Apoie a mão na mesa e deite o cartão bem reto sobre 2 ou 3 dedos (não em um dedo só).",
      "Use um fundo de cor diferente do cartão.",
      "Segure o celular paralelo à mesa, bem em cima da mão.",
      "Aproxime ou afaste até o cartão encaixar na moldura: ela fica verde.",
    ],
    note: "As bolinhas de nível não precisam ficar perfeitamente juntas — é quase impossível. O que importa é a moldura verde e o celular reto. Quando estiver bom, a foto sai sozinha: segure parado.",
    cta: "Entendi, abrir a câmera",
  },
  card: {
    step: "CALIBRAR O CARTÃO",
    title: "Encoste as linhas nas bordas do cartão",
    art: CardArt,
    items: [
      "Arraste as duas linhas verdes até as bordas laterais do cartão.",
      "Use o zoom (+) para ver a borda de perto.",
      "A linha deve encostar na borda de fora: sem sobrar e sem ficar para dentro.",
    ],
    note: "Quanto mais alinhado com a borda, mais exato fica o aro. 1 mm de diferença no cartão já pode mudar o número.",
    cta: "Entendi, calibrar o cartão",
  },
  finger: {
    step: "AJUSTAR O DEDO",
    title: "Marque só o dedo, sem a sombra",
    art: FingerArt,
    items: [
      "Arraste cada linha verde até a borda do dedo, na altura da linha amarela (onde o anel fica).",
      "Ao arrastar, aparece uma lupa 10×: coloque a linha exatamente onde começa a pele.",
      "Deixe a sombra em volta do dedo do lado de fora da linha.",
    ],
    note: "A sombra deixa o dedo maior do que ele é. Pegando só a pele, o aro fica o mais exato possível.",
    cta: "Entendi, ajustar o dedo",
  },
};

export default function TipModal({ kind, onConfirm, onClose }: Props) {
  const c = CONTENT[kind];
  const Art = c.art;
  return (
    <div className="tip-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tip-modal-title">
      <div className="tip-modal">
        {onClose && (
          <button type="button" className="tip-modal-close" onClick={onClose} aria-label="Fechar">×</button>
        )}
        <span className="tip-modal-step">{c.step}</span>
        <h2 id="tip-modal-title">{c.title}</h2>
        <div className="tip-modal-art"><Art /></div>
        <ol className="tip-modal-list">
          {c.items.map((item) => <li key={item}>{item}</li>)}
        </ol>
        {c.note && <p className="tip-modal-note">{c.note}</p>}
        <button type="button" className="tip-modal-cta" onClick={onConfirm}>{c.cta}</button>
      </div>
    </div>
  );
}

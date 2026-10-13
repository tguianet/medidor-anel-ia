// Canal automático do cartão.
// Igual a escolher um canal no Photoshop: para cada foto testamos alguns
// canais e ficamos com o que deixa o cartão mais diferente do fundo. Usado
// SOMENTE para achar as bordas do cartão; a foto exibida continua colorida
// e a medida do dedo não muda.

export type CardChannel = {
  id: "cinza" | "vermelho" | "verde" | "azul" | "saturacao" | "quente-frio";
  read: (d: Uint8ClampedArray, o: number) => number;
};

export const CARD_CHANNELS: CardChannel[] = [
  { id: "cinza", read: (d, o) => d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114 },
  { id: "vermelho", read: (d, o) => d[o] },
  { id: "verde", read: (d, o) => d[o + 1] },
  { id: "azul", read: (d, o) => d[o + 2] },
  { id: "saturacao", read: (d, o) => Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]) },
  { id: "quente-frio", read: (d, o) => Math.max(0, Math.min(255, (d[o] - d[o + 2]) * 0.8 + 128)) },
];

export type ChannelChoice = { channel: CardChannel; score: number; grayScore: number };

/**
 * box: retângulo aproximado do cartão em px (do detector). Compara o miolo
 * do cartão com uma faixa logo fora dele (dos 4 lados).
 */
export const pickCardChannel = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): ChannelChoice => {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const inside: number[] = [];
  const outside: number[] = [];
  const step = Math.max(2, Math.round(Math.min(bw, bh) / 40));
  const at = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return (iy * width + ix) * 4;
  };
  for (let y = box.y0 + bh * 0.15; y <= box.y1 - bh * 0.15; y += step)
    for (let x = box.x0 + bw * 0.15; x <= box.x1 - bw * 0.15; x += step) inside.push(at(x, y));
  const gap = Math.max(4, bw * 0.03), band = Math.max(8, bw * 0.06);
  const pushOut = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) outside.push(at(x, y));
  };
  for (let y = box.y0; y <= box.y1; y += step) {
    for (let k = gap; k <= gap + band; k += step) { pushOut(box.x0 - k, y); pushOut(box.x1 + k, y); }
  }
  for (let x = box.x0; x <= box.x1; x += step) {
    for (let k = gap; k <= gap + band; k += step) { pushOut(x, box.y0 - k); pushOut(x, box.y1 + k); }
  }
  const stats = (ch: CardChannel, offs: number[]) => {
    const v = offs.map((o) => ch.read(data, o)).sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)] ?? 0;
    const mad = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
    return { med, spread: 1.4826 * mad };
  };
  let best: ChannelChoice | null = null;
  let grayScore = 0;
  for (const ch of CARD_CHANNELS) {
    if (!inside.length || !outside.length) break;
    const a = stats(ch, inside), b = stats(ch, outside);
    const score = Math.abs(a.med - b.med) / (a.spread + b.spread + 4);
    if (ch.id === "cinza") grayScore = score;
    if (!best || score > best.score) best = { channel: ch, score, grayScore: 0 };
  }
  if (!best) return { channel: CARD_CHANNELS[0], score: 0, grayScore: 0 };
  // Só troca o cinza quando o ganho é claro (20%+).
  if (best.channel.id !== "cinza" && best.score < grayScore * 1.2) {
    return { channel: CARD_CHANNELS[0], score: grayScore, grayScore };
  }
  return { ...best, grayScore };
};

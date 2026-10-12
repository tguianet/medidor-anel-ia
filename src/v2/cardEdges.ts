// Detector de borda fisica do cartao, independente da cor.
//
// Por que existe:
//   A escala da v2 vem da distancia entre a borda esquerda e a direita do
//   cartao (= 85,60 mm). O detector antigo convertia a foto para cinza e,
//   entre os candidatos fortes, escolhia "o mais externo". Com isso:
//     - cartoes escuros/vermelhos/azuis em fundo de brilho parecido quase
//       nao tinham borda em cinza e caiam em frisos internos ou no fallback;
//     - cartoes claros grudavam na sombra projetada fora do cartao.
//   Um erro de ~6 px por lateral (foto 900 px) ja troca o aro.
//
// O que este detector faz:
//   1) contraste nos 3 canais (R, G, B), nao so no cinza;
//   2) exige que a diferenca "fora x dentro" tenha a MESMA direcao ao longo
//      de toda a borda (frisos, letras e logotipos alternam e sao rejeitados);
//   3) localiza a borda no PICO do perfil, com precisao subpixel,
//      em vez de pegar a ponta externa de um plato.

export type RgbaImage = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type EdgeSide = "left" | "right" | "top" | "bottom";

export type CardEdgeResult = {
  /** Posicao da borda (x para left/right, y para top/bottom), subpixel. */
  position: number;
  /** Deslocamento em relacao a posicao esperada. */
  shift: number;
  /** Contraste medio robusto na borda (escala ~ diferenca de brilho 0-255). */
  strength: number;
  /** Fracao das amostras com contraste >= 10. */
  coverage: number;
  /** 0-1: quao constante e a direcao da diferenca de cor ao longo da borda. */
  consistency: number;
  /** Borda com contraste, continuidade e direcao suficientes. */
  reliable: boolean;
};

export type CardEdgeOptions = {
  side: EdgeSide;
  /** Posicao esperada da borda (x para left/right, y para top/bottom). */
  expected: number;
  /** Inicio e fim do trecho amostrado ao longo da borda. */
  from: number;
  to: number;
  /** Raio de busca em px. */
  searchPx?: number;
  /** Meia janela da diferenca fora/dentro em px. */
  halfWindow?: number;
  /** Quantidade aproximada de amostras ao longo da borda. */
  samples?: number;
};

const SQRT3 = Math.sqrt(3);

const robustMean = (values: number[]) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const trim = Math.floor(ordered.length * 0.18);
  const kept = ordered.slice(trim, Math.max(trim + 1, ordered.length - trim));
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
};

type EdgeProfilePoint = {
  offset: number;
  score: number;
  strength: number;
  coverage: number;
  consistency: number;
};

export const findCardEdge = (image: RgbaImage, options: CardEdgeOptions): CardEdgeResult => {
  const { data, width, height } = image;
  const { side, expected } = options;
  const searchPx = options.searchPx ?? 18;
  const half = options.halfWindow ?? 2;
  const sampleCount = Math.max(6, options.samples ?? 28);

  const vertical = side === "left" || side === "right";
  // "fora" do cartao fica para a esquerda/direita/cima/baixo conforme o lado.
  const outwardSign = side === "left" || side === "top" ? -1 : 1;

  const along0 = Math.min(options.from, options.to);
  const along1 = Math.max(options.from, options.to);
  const alongStep = Math.max(1, (along1 - along0) / (sampleCount - 1));

  const read = (across: number, along: number, out: number[]) => {
    const x = vertical ? across : along;
    const y = vertical ? along : across;
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const o = (iy * width + ix) * 4;
    out[0] = data[o];
    out[1] = data[o + 1];
    out[2] = data[o + 2];
  };

  const outside = [0, 0, 0];
  const inside = [0, 0, 0];
  const pixel = [0, 0, 0];
  const profile: EdgeProfilePoint[] = [];

  // Faixa larga de cada lado (alem da janela estreita) usada para confirmar
  // que existe um DEGRAU persistente: fundo de um lado, cartao do outro.
  // Um friso ou uma letra e uma linha fina: a faixa larga dos dois lados
  // tem praticamente a mesma cor e o candidato perde forca.
  const bandStart = half + 1;
  const bandEnd = half + 7;
  const bandMean = (at: number, along: number, direction: number, out: number[]) => {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let k = bandStart; k <= bandEnd; k++) {
      read(at + direction * k, along, pixel);
      out[0] += pixel[0];
      out[1] += pixel[1];
      out[2] += pixel[2];
    }
    const count = bandEnd - bandStart + 1;
    out[0] /= count;
    out[1] /= count;
    out[2] /= count;
  };
  const bandOutside = [0, 0, 0];
  const bandInside = [0, 0, 0];

  for (let offset = -searchPx; offset <= searchPx; offset++) {
    const at = expected + offset;
    const magnitudes: number[] = [];
    const wideMagnitudes: number[] = [];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumMagnitude = 0;
    let strong = 0;

    for (let along = along0; along <= along1 + 0.001; along += alongStep) {
      read(at + outwardSign * half, along, outside);
      read(at - outwardSign * half, along, inside);
      const dr = outside[0] - inside[0];
      const dg = outside[1] - inside[1];
      const db = outside[2] - inside[2];
      // Normalizado por sqrt(3): uma mudanca de cinza de D vale D, como antes.
      const magnitude = Math.sqrt(dr * dr + dg * dg + db * db) / SQRT3;
      magnitudes.push(magnitude);
      sumR += dr;
      sumG += dg;
      sumB += db;
      sumMagnitude += magnitude * SQRT3;
      if (magnitude >= 10) strong++;

      bandMean(at, along, outwardSign, bandOutside);
      bandMean(at, along, -outwardSign, bandInside);
      const wr = bandOutside[0] - bandInside[0];
      const wg = bandOutside[1] - bandInside[1];
      const wb = bandOutside[2] - bandInside[2];
      wideMagnitudes.push(Math.sqrt(wr * wr + wg * wg + wb * wb) / SQRT3);
    }

    const strength = robustMean(magnitudes);
    const wideStrength = robustMean(wideMagnitudes);
    const persistence = strength > 0 ? Math.min(1, wideStrength / strength) : 0;
    const coverage = strong / Math.max(1, magnitudes.length);
    const consistency = sumMagnitude > 0
      ? Math.min(1, Math.sqrt(sumR * sumR + sumG * sumG + sumB * sumB) / sumMagnitude)
      : 0;
    const score =
      strength *
      (0.35 + 0.65 * consistency) *
      (0.4 + 0.6 * coverage) *
      (0.15 + 0.85 * persistence);
    profile.push({ offset, score, strength, coverage, consistency });
  }

  const scoreAt = (index: number) =>
    index >= 0 && index < profile.length ? profile[index].score : 0;

  // Picos locais com direcao coerente.
  // "Nitidez": a borda fisica do cartao e um degrau, que gera um pico estreito
  // no perfil. Uma sombra projetada e uma rampa gradual, que gera um plato
  // largo. Comparamos o pico com o perfil 4 px para cada lado.
  type Peak = { index: number; sharpness: number };
  const peaks: Peak[] = [];
  for (let i = 0; i < profile.length; i++) {
    const current = profile[i].score;
    if (current <= 0) continue;
    if (current < scoreAt(i - 1) || current < scoreAt(i + 1)) continue;
    if (profile[i].consistency < 0.5) continue;
    // Plato de valores iguais: guarda so o primeiro indice.
    if (peaks.length && peaks[peaks.length - 1].index === i - 1 && scoreAt(i - 1) === current) continue;
    const shoulder = Math.max(scoreAt(i - 4), scoreAt(i + 4));
    peaks.push({ index: i, sharpness: Math.max(0, 1 - shoulder / current) });
  }

  const sharpPeaks = peaks.filter((peak) => peak.sharpness >= 0.3);
  const bestSharpScore = Math.max(0, ...sharpPeaks.map((peak) => profile[peak.index].score));
  const candidates = sharpPeaks.filter((peak) => profile[peak.index].score >= bestSharpScore * 0.25);

  let chosen: number;
  if (candidates.length) {
    // Entre degraus nitidos, fortes e coerentes, a borda externa do cartao e o
    // mais externo: frisos, faixas e desenhos ficam para dentro dele.
    chosen = candidates.reduce((best, peak) =>
      outwardSign * profile[peak.index].offset > outwardSign * profile[best].offset ? peak.index : best,
    candidates[0].index);
  } else {
    chosen = profile.reduce((best, point, index) => (point.score > profile[best].score ? index : best), 0);
  }

  // Refinamento subpixel por parabola nos 3 pontos em torno do pico.
  let subpixel = 0;
  if (chosen > 0 && chosen < profile.length - 1) {
    const a = profile[chosen - 1].score;
    const b = profile[chosen].score;
    const c = profile[chosen + 1].score;
    const denominator = a - 2 * b + c;
    if (Math.abs(denominator) > 1e-9) subpixel = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator));
  }

  const point = profile[chosen];
  const shift = point.offset + subpixel;
  return {
    position: expected + shift,
    shift,
    strength: point.strength,
    coverage: point.coverage,
    consistency: point.consistency,
    reliable: point.strength >= 7 && point.coverage >= 0.5 && point.consistency >= 0.5,
  };
};

/** Diferenca de cor entre dois pixels, na mesma escala de uma diferenca de cinza. */
export const colorDifference = (
  data: Uint8ClampedArray | Uint8Array,
  offsetA: number,
  offsetB: number,
) => {
  const dr = data[offsetA] - data[offsetB];
  const dg = data[offsetA + 1] - data[offsetB + 1];
  const db = data[offsetA + 2] - data[offsetB + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / SQRT3;
};

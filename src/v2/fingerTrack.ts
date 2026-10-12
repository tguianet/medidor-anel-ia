// medidordedov13: rastreamento denso das bordas do dedo.
// Parte das linhas da lupa (posicionadas pelo usuario na altura do anel),
// segue a borda esquerda e a direita para cima e para baixo enquanto ela for
// visivel e mede N cortes (padrao 3000) com precisao subpixel. A largura de
// cada corte e corrigida pela inclinacao do eixo do dedo.

export type PixelImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type FingerTrackResult = {
  count: number;
  yStart: number;
  yEnd: number;
  meanPx: number;
  medianPx: number;
  minPx: number;
  maxPx: number;
  widthAtStartPx: number;
  axisAngleDeg: number;
  // amostra reduzida para desenhar (coordenadas da imagem)
  leftPath: { x: number; y: number }[];
  rightPath: { x: number; y: number }[];
};

// Alargamento maximo aceito durante o rastreamento (3%): exclui a curva
// onde o dedo se abre para a palma.
const FLARE_LIMIT = 1.03;
const ROW_RADIUS = 1.5;
const ROW_STEP_MAX = 0.75;

const grayAt = (img: PixelImage, x: number, y: number) => {
  const w = img.width, h = img.height;
  const xx = Math.max(0, Math.min(w - 1.001, x));
  const yy = Math.max(0, Math.min(h - 1.001, y));
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const fx = xx - x0, fy = yy - y0;
  const g = (ix: number, iy: number) => {
    const o = (iy * w + ix) * 4;
    return img.data[o] * 0.299 + img.data[o + 1] * 0.587 + img.data[o + 2] * 0.114;
  };
  const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};

// Gradiente horizontal suavizado (diferenca a +-h px, media de 3 linhas).
const gradAt = (img: PixelImage, x: number, y: number, h: number) => {
  // Media vertical proporcional a h (fotos em alta tem mais ruido por pixel).
  const span = Math.max(0.5, h * 0.6);
  let s = 0;
  for (const k of [-1, -0.5, 0, 0.5, 1]) s += grayAt(img, x + h, y + k * span) - grayAt(img, x - h, y + k * span);
  return s / 5;
};

/** Borda mais forte com a polaridade esperada perto de `pred`, subpixel. */
const findEdge = (img: PixelImage, pred: number, y: number, radius: number, sign: number, h: number) => {
  const step = 0.25;
  let bestX = pred, bestG = -Infinity;
  const values: { x: number; g: number }[] = [];
  for (let x = pred - radius; x <= pred + radius + 1e-9; x += step) {
    const g = gradAt(img, x, y, h) * sign;
    values.push({ x, g });
    if (g > bestG) { bestG = g; bestX = x; }
  }
  const i = values.findIndex((v) => v.x === bestX);
  if (i > 0 && i < values.length - 1) {
    const a = values[i - 1].g, b = values[i].g, c = values[i + 1].g;
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) bestX += Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) * step;
  }
  return { x: bestX, g: bestG };
};

// Ajuste robusto x = a + b*y (descarta pontos fora de 2,5 x desvio mediano).
const robustLine = (pts: { y: number; x: number }[]) => {
  let use = pts.slice();
  let a = 0, b = 0;
  for (let it = 0; it < 4; it++) {
    const n = use.length;
    if (n < 10) break;
    let sy = 0, sx = 0, syy = 0, sxy = 0;
    for (const p of use) { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.y * p.x; }
    const den = n * syy - sy * sy;
    b = Math.abs(den) > 1e-9 ? (n * sxy - sy * sx) / den : 0;
    a = (sx - b * sy) / n;
    const res = pts.map((p) => Math.abs(p.x - (a + b * p.y)));
    const mad = [...res].sort((u, v) => u - v)[Math.floor(res.length / 2)] || 0.1;
    const lim = Math.max(0.6, 2.5 * mad);
    use = pts.filter((_, k) => res[k] <= lim);
  }
  const inl = new Set(use);
  return { a, b, inliers: pts.map((p) => inl.has(p)) };
};

export const trackFinger = (
  img: PixelImage,
  startLeftX: number,
  startRightX: number,
  startY: number,
  opts: { minY: number; maxY: number; samples?: number; scale?: number; windowPx?: number },
): FingerTrackResult | null => {
  const scale = opts.scale ?? 1;
  const h = 1.5 * scale;
  const total = Math.max(50, Math.round(opts.samples ?? 3000));
  const win = Math.min(opts.windowPx ?? 40 * scale, 400 * scale);
  const yStart = Math.max(opts.minY, startY - win);
  const yEnd = Math.min(opts.maxY, startY + win);
  if (yEnd - yStart < 4) return null;

  // Polaridade (fundo x pele) de cada lado, no ponto de partida.
  const sL = Math.sign(grayAt(img, startLeftX + 4 * scale, startY) - grayAt(img, startLeftX - 4 * scale, startY)) || 1;
  const sR = Math.sign(grayAt(img, startRightX + 4 * scale, startY) - grayAt(img, startRightX - 4 * scale, startY)) || -1;
  const R = 5 * scale; // busca em volta das linhas da lupa

  // 1) Cada corte acha a borda sozinho (sem depender do corte anterior).
  const L: { y: number; x: number }[] = [], Rt: { y: number; x: number }[] = [];
  const strong: boolean[] = [];
  const gL: number[] = [], gR: number[] = [];
  for (let k = 0; k < total; k++) {
    const y = yStart + ((yEnd - yStart) * k) / (total - 1);
    const el = findEdge(img, startLeftX, y, R, sL, h);
    const er = findEdge(img, startRightX, y, R, sR, h);
    L.push({ y, x: el.x }); Rt.push({ y, x: er.x });
    gL.push(el.g); gR.push(er.g);
    strong.push(el.g > 4 && er.g > 4);
  }
  const medG = (g: number[]) => [...g].sort((u, v) => u - v)[Math.floor(g.length / 2)];
  const mL = medG(gL), mR = medG(gR);
  const ok = strong.map((v, k) => v && gL[k] >= mL * 0.4 && gR[k] >= mR * 0.4);

  // 2) Reta robusta por lado; eixo do dedo = media das inclinacoes.
  const fl = robustLine(L.filter((_, k) => ok[k]));
  const fr = robustLine(Rt.filter((_, k) => ok[k]));
  const b = (fl.b + fr.b) / 2;
  const cosA = Math.cos(Math.atan(b));

  // 3) Largura de cada corte valido (inlier dos dois lados), perpendicular ao eixo.
  const okIdx = ok.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
  const widths: number[] = [];
  const leftPath: { x: number; y: number }[] = [], rightPath: { x: number; y: number }[] = [];
  okIdx.forEach((k, j) => {
    if (!fl.inliers[j] || !fr.inliers[j]) return;
    widths.push((Rt[k].x - L[k].x) * cosA);
    leftPath.push(L[k]); rightPath.push(Rt[k]);
  });
  if (widths.length < Math.max(30, total * 0.2)) return null;
  widths.sort((u, v) => u - v);
  const n = widths.length;
  const lo = Math.floor(n * 0.1), hi = Math.max(lo + 1, Math.ceil(n * 0.9));
  const kept = widths.slice(lo, hi);
  const every = Math.max(1, Math.floor(leftPath.length / 150));
  const wAt = (fr.a + fr.b * startY - (fl.a + fl.b * startY)) * cosA;
  return {
    count: n,
    yStart,
    yEnd,
    meanPx: kept.reduce((a2, v) => a2 + v, 0) / kept.length,
    medianPx: widths[Math.floor(n / 2)],
    minPx: widths[0],
    maxPx: widths[n - 1],
    widthAtStartPx: wAt,
    axisAngleDeg: (Math.atan(b) * 180) / Math.PI,
    leftPath: leftPath.filter((_, i2) => i2 % every === 0),
    rightPath: rightPath.filter((_, i2) => i2 % every === 0),
  };
};

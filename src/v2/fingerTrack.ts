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
  let s = 0;
  for (const dy of [-0.5, 0, 0.5]) s += grayAt(img, x + h, y + dy) - grayAt(img, x - h, y + dy);
  return s / 3;
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

export const trackFinger = (
  img: PixelImage,
  startLeftX: number,
  startRightX: number,
  startY: number,
  opts: { minY: number; maxY: number; samples?: number; scale?: number },
): FingerTrackResult | null => {
  const scale = opts.scale ?? 1; // fator da imagem em relacao a 900 px
  const h = 1.5 * scale;
  const total = Math.max(50, Math.round(opts.samples ?? 3000));

  // Polaridade de cada lado (fundo x pele) medida no ponto de partida.
  const sL = Math.sign(grayAt(img, startLeftX + 4 * scale, startY) - grayAt(img, startLeftX - 4 * scale, startY)) || 1;
  const sR = Math.sign(grayAt(img, startRightX + 4 * scale, startY) - grayAt(img, startRightX - 4 * scale, startY)) || -1;

  const l0 = findEdge(img, startLeftX, startY, 6 * scale, sL, h);
  const r0 = findEdge(img, startRightX, startY, 6 * scale, sR, h);
  if (!(l0.g > 4 && r0.g > 4) || r0.x - l0.x < 20 * scale) return null;
  const width0 = r0.x - l0.x;
  const refL = l0.g, refR = r0.g;

  // 1) Rastreamento linha a linha para descobrir onde a borda continua visivel.
  type Row = { y: number; xl: number; xr: number };
  const track = (dir: 1 | -1) => {
    const rows: Row[] = [];
    let pl = l0.x, pr = r0.x, misses = 0;
    for (let y = startY + dir; dir < 0 ? y >= opts.minY : y <= opts.maxY; y += dir) {
      const el = findEdge(img, pl, y, 2 * scale, sL, h);
      const er = findEdge(img, pr, y, 2 * scale, sR, h);
      const okL = el.g >= refL * 0.35 && Math.abs(el.x - pl) <= 2 * scale;
      const okR = er.g >= refR * 0.35 && Math.abs(er.x - pr) <= 2 * scale;
      const w = er.x - el.x;
      // Referencia = mediana das larguras ja aceitas neste sentido (ou a inicial).
      const ref = rows.length >= 9 ? [...rows.map((r) => r.xr - r.xl)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] : width0;
      // Para quando o dedo comeca a ALARGAR (curva da dobra/palma) ou afinar demais.
      const okW = w > ref * 0.95 && w < ref * FLARE_LIMIT;
      if (okL && okR && okW) {
        misses = 0;
        pl = el.x; pr = er.x;
        rows.push({ y, xl: el.x, xr: er.x });
      } else if (++misses >= 3) break;
    }
    return rows;
  };
  const up = track(-1).reverse();
  const down = track(1);
  const rows: Row[] = [...up, { y: startY, xl: l0.x, xr: r0.x }, ...down];
  if (rows.length < 8) return null;
  const yStart = rows[0].y, yEnd = rows[rows.length - 1].y;

  const interp = (y: number, key: "xl" | "xr") => {
    const t = (y - yStart);
    const i = Math.max(0, Math.min(rows.length - 2, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i));
    return rows[i][key] * (1 - f) + rows[i + 1][key] * f;
  };

  // 2) N cortes uniformes no trecho rastreado, cada um refinado em subpixel.
  const pts: { y: number; xl: number; xr: number }[] = [];
  for (let k = 0; k < total; k++) {
    const y = yStart + ((yEnd - yStart) * k) / (total - 1);
    const el = findEdge(img, interp(y, "xl"), y, 1 * scale, sL, h);
    const er = findEdge(img, interp(y, "xr"), y, 1 * scale, sR, h);
    pts.push({ y, xl: el.x, xr: er.x });
  }

  // 3) Eixo do dedo (centro) por minimos quadrados x = a + b*y -> inclinacao.
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const c = (p.xl + p.xr) / 2; sy += p.y; sx += c; syy += p.y * p.y; sxy += p.y * c; }
  const n = pts.length;
  const b = (n * sxy - sy * sx) / Math.max(1e-9, n * syy - sy * sy);
  const cosA = Math.cos(Math.atan(b));
  const widths = pts.map((p) => (p.xr - p.xl) * cosA).sort((x, y) => x - y);
  // Media aparada: descarta 10% mais estreitos e 10% mais largos.
  const lo = Math.floor(n * 0.1), hi = Math.max(lo + 1, Math.ceil(n * 0.9));
  const kept = widths.slice(lo, hi);
  const mean = kept.reduce((a, v) => a + v, 0) / kept.length;
  const median = widths[Math.floor(n / 2)];

  const every = Math.max(1, Math.floor(n / 150));
  return {
    count: n,
    yStart,
    yEnd,
    meanPx: mean,
    medianPx: median,
    minPx: widths[0],
    maxPx: widths[n - 1],
    widthAtStartPx: width0 * cosA,
    axisAngleDeg: (Math.atan(b) * 180) / Math.PI,
    leftPath: pts.filter((_, i) => i % every === 0).map((p) => ({ x: p.xl, y: p.y })),
    rightPath: pts.filter((_, i) => i % every === 0).map((p) => ({ x: p.xr, y: p.y })),
  };
};

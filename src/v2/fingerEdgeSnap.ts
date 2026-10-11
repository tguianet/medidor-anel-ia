// Snap de UMA borda do dedo que acompanha a inclinacao do dedo.
//
// O usuario solta a linha verde perto da borda. A partir desse ponto o
// rastreador segue a borda para cima e para baixo (a posicao prevista anda
// junto com a inclinacao ja medida), ajusta uma reta x = x0 + slope*(y - y0)
// com descarte de pontos fora da reta, e devolve a borda inclinada.
// Modulo puro: recebe pixels, nao depende de React.

export type SnapImage = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type FingerEdgeSnapOptions = {
  side: "left" | "right";
  /** Ponto onde o usuario soltou a linha (pixels da foto). */
  seedX: number;
  seedY: number;
  /** Raio de busca da primeira borda em px (padrao 14). */
  seedRadius?: number;
  /** Meia altura rastreada em px (padrao 140). */
  halfSpan?: number;
  /** Passo vertical em px (padrao 2). */
  step?: number;
  /** Inclinacao maxima aceita em graus (padrao 20). */
  maxTiltDeg?: number;
  /** Nao rastreia acima desta altura (ex.: base do cartao + margem). */
  minY?: number;
  /** Nao rastreia abaixo desta altura. */
  maxY?: number;
};

export type FingerEdgeSnapResult = {
  /** x da borda na altura seedY. */
  x0: number;
  y0: number;
  /** dx/dy da borda (0 = vertical). */
  slope: number;
  tiltDeg: number;
  points: { x: number; y: number }[];
  /** Mediana do desvio dos pontos ate a reta (px). */
  residual: number;
  /** Faixa vertical efetivamente rastreada (px). */
  coveredPx: number;
  confidence: number;
};

const luminance = (img: SnapImage, x: number, y: number) => {
  const ix = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return img.data[o] * 0.299 + img.data[o + 1] * 0.587 + img.data[o + 2] * 0.114;
};

const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
};

const fitLine = (points: { x: number; y: number }[], yRef: number) => {
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  let yy = 0;
  let yx = 0;
  for (const p of points) {
    yy += (p.y - my) ** 2;
    yx += (p.y - my) * (p.x - mx);
  }
  const slope = yy > 1e-6 ? yx / yy : 0;
  return { slope, x0: mx + slope * (yRef - my) };
};

export const snapFingerEdge = (img: SnapImage, options: FingerEdgeSnapOptions): FingerEdgeSnapResult | null => {
  const { side, seedX, seedY } = options;
  const seedRadius = options.seedRadius ?? 14;
  const halfSpan = options.halfSpan ?? 140;
  const step = options.step ?? 2;
  const maxSlope = Math.tan(((options.maxTiltDeg ?? 20) * Math.PI) / 180);
  const out = side === "left" ? -1 : 1; // lado de fora do dedo
  const minY = Math.max(6, options.minY ?? 6);
  const maxY = Math.min(img.height - 6, options.maxY ?? img.height - 6);
  if (seedY < minY || seedY > maxY) return null;

  // Contraste fino (+-2 px) entre o lado de fora e o de dentro do dedo.
  const signedAt = (x: number, y: number) => luminance(img, x + out * 2, y) - luminance(img, x - out * 2, y);

  // SEMENTE: a borda do dedo e a PRIMEIRA transicao forte vindo de dentro
  // para fora. Uma sombra ao lado do dedo cria uma segunda transicao mais
  // externa (as vezes mais forte); grudar nela deixava o dedo ~2% mais largo.
  // Aceita os dois sentidos de contraste (sombra pode ser mais escura que a pele).
  const seedPeaks: { x: number; signed: number; strength: number }[] = [];
  {
    const values: { x: number; signed: number; strength: number }[] = [];
    for (let x = Math.round(seedX) - seedRadius - 1; x <= Math.round(seedX) + seedRadius + 1; x++) {
      if (x < 6 || x >= img.width - 6) continue;
      const signed = signedAt(x, seedY);
      values.push({ x, signed, strength: Math.abs(signed) });
    }
    const maxStrength = Math.max(0, ...values.map((v) => v.strength));
    const threshold = Math.max(8, maxStrength * 0.25);
    for (let i = 1; i < values.length - 1; i++) {
      const v = values[i];
      if (v.strength < threshold) continue;
      if (v.strength < values[i - 1].strength || v.strength < values[i + 1].strength) continue;
      if (Math.abs(v.x - seedX) > seedRadius) continue;
      seedPeaks.push(v);
    }
  }
  if (!seedPeaks.length) return null;
  // Mais para dentro: na borda esquerda o dedo fica a direita (maior x).
  const inner = seedPeaks.reduce((best, peak) => (-out * peak.x > -out * best.x ? peak : best), seedPeaks[0]);
  const polarity = Math.sign(inner.signed) || 1;

  const edgeAt = (center: number, y: number, radius: number) => {
    let best: { x: number; strength: number } | null = null;
    const strengths = new Map<number, number>();
    for (let x = Math.round(center) - radius - 1; x <= Math.round(center) + radius + 1; x++) {
      if (x < 6 || x >= img.width - 6) continue;
      const strength = Math.max(0, signedAt(x, y) * polarity);
      strengths.set(x, strength);
    }
    for (let x = Math.round(center) - radius; x <= Math.round(center) + radius; x++) {
      const v = strengths.get(x);
      if (v === undefined || v < 6) continue;
      if (!best || v > best.strength) best = { x, strength: v };
    }
    if (!best) return null;
    // Refinamento subpixel por parabola.
    const a = strengths.get(best.x - 1) ?? best.strength;
    const c = strengths.get(best.x + 1) ?? best.strength;
    const denominator = a - 2 * best.strength + c;
    const offset = Math.abs(denominator) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator)) : 0;
    return { x: best.x + offset, strength: best.strength };
  };

  const seed = edgeAt(inner.x, seedY, 1);
  if (!seed) return null;

  const points: { x: number; y: number; strength: number }[] = [{ x: seed.x, y: seedY, strength: seed.strength }];
  const trace = (direction: 1 | -1) => {
    let prevX = seed.x;
    let prevY = seedY;
    let localSlope = 0;
    let misses = 0;
    for (let y = seedY + direction * step; Math.abs(y - seedY) <= halfSpan; y += direction * step) {
      if (y < minY || y >= maxY) break;
      const predicted = prevX + localSlope * (y - prevY);
      const hit = edgeAt(predicted, y, 3);
      if (!hit || Math.abs(hit.x - predicted) > 2.5) {
        misses++;
        if (misses >= 6) break;
        continue;
      }
      misses = 0;
      points.push({ x: hit.x, y, strength: hit.strength });
      // Atualiza a inclinacao local com os ultimos pontos do mesmo lado.
      const recent = points.filter((p) => (p.y - seedY) * direction >= 0).slice(-12);
      if (recent.length >= 6) {
        const fit = fitLine(recent, y);
        localSlope = Math.max(-maxSlope, Math.min(maxSlope, fit.slope));
      }
      prevX = hit.x;
      prevY = y;
    }
  };
  trace(-1);
  trace(1);

  if (points.length < 30) return null;

  // Ajuste robusto: reta, descarta quem desvia > 2 px, reajusta.
  let kept: { x: number; y: number; strength: number }[] = points;
  let fit = fitLine(kept, seedY);
  for (let pass = 0; pass < 2; pass++) {
    const f = fit;
    const filtered = kept.filter((p) => Math.abs(p.x - (f.x0 + f.slope * (p.y - seedY))) <= 2);
    if (filtered.length < 30) break;
    kept = filtered;
    fit = fitLine(kept, seedY);
  }
  if (Math.abs(fit.slope) > maxSlope) return null;

  const residual = median(kept.map((p) => Math.abs(p.x - (fit.x0 + fit.slope * (p.y - seedY)))));
  const ys = kept.map((p) => p.y);
  const coveredPx = Math.max(...ys) - Math.min(...ys);
  if (residual > 1.8 || coveredPx < 40) return null;

  const avgStrength = kept.reduce((s, p) => s + p.strength, 0) / kept.length;
  const confidence = Math.round(
    Math.max(0, Math.min(99, 40 + Math.min(30, kept.length * 0.25) + Math.min(25, avgStrength * 0.4) - residual * 8)),
  );

  return {
    x0: fit.x0,
    y0: seedY,
    slope: fit.slope,
    tiltDeg: (Math.atan(fit.slope) * 180) / Math.PI,
    points: kept.map(({ x, y }) => ({ x, y })),
    residual,
    coveredPx,
    confidence,
  };
};

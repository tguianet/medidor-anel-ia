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

  // Polaridade esperada (fora x dentro): sinal do contraste mais forte na
  // janela de busca. Funciona com a linha solta por dentro ou por fora.
  let polarityRaw = 0;
  for (let x = Math.round(seedX) - seedRadius; x <= Math.round(seedX) + seedRadius; x++) {
    const signed = luminance(img, x + out * 4, seedY) - luminance(img, x - out * 4, seedY);
    if (Math.abs(signed) > Math.abs(polarityRaw)) polarityRaw = signed;
  }
  const polarity = Math.abs(polarityRaw) >= 6 ? Math.sign(polarityRaw) : 0;

  const edgeAt = (center: number, y: number, radius: number) => {
    let best: { x: number; strength: number } | null = null;
    const candidates: { x: number; strength: number }[] = [];
    for (let x = Math.round(center) - radius; x <= Math.round(center) + radius; x++) {
      if (x < 6 || x >= img.width - 6) continue;
      const signed = luminance(img, x + out * 4, y) - luminance(img, x - out * 4, y);
      const strength = polarity === 0 ? Math.abs(signed) : Math.max(0, signed * polarity);
      if (strength < 6) continue;
      candidates.push({ x, strength });
      if (!best || strength > best.strength) best = { x, strength };
    }
    if (!best) return null;
    // Grupo continuo em torno do pico, centro ponderado (subpixel).
    const strong = candidates.filter((c) => c.strength >= best!.strength * 0.6 && Math.abs(c.x - best!.x) <= 4);
    const weight = strong.reduce((s, c) => s + c.strength, 0);
    return { x: strong.reduce((s, c) => s + c.x * c.strength, 0) / weight, strength: best.strength };
  };

  const seed = edgeAt(seedX, seedY, seedRadius);
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

export type CardCalibration = {
  pixelsPerMm: number;
  confidence: number;
  cardBox: { x: number; y: number; width: number; height: number };
};

type Box = { minX: number; minY: number; maxX: number; maxY: number; count: number };

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

// Detecta cartões coloridos de qualquer cor. Cartões escuros, brancos ou
// foscos continuam sendo tratados pelo detector de bordas como alternativa.
const isChromaticCardSurface = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 48 && (max - min) / max > 0.24;
};

const percentile = (values: number[], amount: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.round((ordered.length - 1) * amount)))];
};

const findCardByEdges = (pixels: Uint8ClampedArray, width: number, height: number): Box | null => {
  const total = width * height;
  const gray = new Uint8Array(total);
  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    gray[index] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }

  const strength = new Uint16Array(total);
  const samples: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gx = gray[index + 1] - gray[index - 1];
      const gy = gray[index + width] - gray[index - width];
      const value = Math.abs(gx) + Math.abs(gy);
      strength[index] = value;
      if ((x + y) % 3 === 0) samples.push(value);
    }
  }
  const threshold = Math.max(28, percentile(samples, 0.84));
  let mask = new Uint8Array(total);
  for (let index = 0; index < total; index++) mask[index] = strength[index] >= threshold ? 1 : 0;

  // Une bordas interrompidas por reflexos, letras e cantos arredondados.
  for (let pass = 0; pass < 4; pass++) {
    const expanded = new Uint8Array(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (mask[index]) continue;
        if (mask[index - 1] || mask[index + 1] || mask[index - width] || mask[index + width]) expanded[index] = 1;
      }
    }
    mask = expanded;
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let best: Box | null = null;
  let bestScore = 0;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const box: Box = { minX: width, minY: height, maxX: 0, maxY: 0, count: 0 };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.count++;
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        if (Math.abs((next % width) - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;
    const area = boxWidth * boxHeight;
    const areaShare = area / total;
    const ratio = Math.max(boxWidth, boxHeight) / Math.max(1, Math.min(boxWidth, boxHeight));
    if (areaShare < 0.012 || areaShare > 0.58 || ratio < 1.25 || ratio > 2.02) continue;
    const ratioQuality = 1 - Math.min(1, Math.abs(ratio - 1.586) / 0.5);
    const density = Math.min(1, box.count / Math.max(1, area * 0.18));
    const score = areaShare * (0.35 + ratioQuality * 0.65) * (0.4 + density * 0.6);
    if (score > bestScore) { best = box; bestScore = score; }
  }
  return best;
};

export async function calibratePhoto(photo: string): Promise<CardCalibration> {
  const image = await loadImage(photo);
  const work = document.createElement("canvas");
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  work.width = Math.max(1, Math.round(image.naturalWidth * scale));
  work.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, work.width, work.height);
  const pixels = ctx.getImageData(0, 0, work.width, work.height).data;
  const total = work.width * work.height;
  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    mask[index] = isChromaticCardSurface(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ? 1 : 0;
  }
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let colorCandidate: Box | null = null;
  let colorScore = 0;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const box: Box = { minX: work.width, minY: work.height, maxX: 0, maxY: 0, count: 0 };
    while (head < tail) {
      const index = queue[head++];
      const x = index % work.width;
      const y = (index / work.width) | 0;
      box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y); box.count++;
      for (const next of [index - 1, index + 1, index - work.width, index + work.width]) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        if (Math.abs((next % work.width) - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    const width = box.maxX - box.minX + 1;
    const height = box.maxY - box.minY + 1;
    const areaShare = width * height / total;
    const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    const density = box.count / Math.max(1, width * height);
    if (areaShare < 0.008 || areaShare > 0.48 || ratio < 1.25 || ratio > 2.15 || density < 0.12) continue;
    const score = box.count * density * (1 - Math.min(1, Math.abs(ratio - 1.586) / 0.8));
    if (score > colorScore) { colorCandidate = box; colorScore = score; }
  }
  const best = colorCandidate || findCardByEdges(pixels, work.width, work.height);
  if (!best) throw new Error("Não encontrei a base do cartão. Deixe a borda inferior e os dois cantos visíveis, evite reflexo e fotografe de cima.");

  let axisA = best.maxX - best.minX + 1;
  let axisB = best.maxY - best.minY + 1;
  const longPx = Math.max(axisA, axisB) / scale;
  const shortPx = Math.min(axisA, axisB) / scale;
  const longScale = longPx / 85.6;
  const observedRatio = longPx / Math.max(1, shortPx);
  const ratioError = Math.abs(observedRatio - 1.586) / 1.586;

  return {
    pixelsPerMm: longScale,
    confidence: Math.max(70, Math.min(colorCandidate ? 98 : 96, Math.round((colorCandidate ? 98 : 96) - ratioError * 45))),
    cardBox: {
      x: best.minX / work.width,
      y: best.minY / work.height,
      width: (best.maxX - best.minX + 1) / work.width,
      height: (best.maxY - best.minY + 1) / work.height,
    },
  };
}
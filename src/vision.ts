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

const isCardColor = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation > 0.24 && max > 48 && b > r * 1.06 && b > g * 1.02;
};

const percentile = (values: number[], amount: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.round((ordered.length - 1) * amount)))];
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
    mask[index] = isCardColor(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ? 1 : 0;
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const candidates: Box[] = [];
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
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.count++;
      for (const next of [index - 1, index + 1, index - work.width, index + work.width]) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        if (Math.abs((next % work.width) - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (box.count > total * 0.003) candidates.push(box);
  }

  let best: Box | null = null;
  let bestScore = 0;
  for (const box of candidates) {
    const width = box.maxX - box.minX + 1;
    const height = box.maxY - box.minY + 1;
    const areaShare = width * height / total;
    const density = box.count / (width * height);
    const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (areaShare < 0.008 || areaShare > 0.4 || ratio > 2.35) continue;
    const score = box.count * density;
    if (score > bestScore) {
      best = box;
      bestScore = score;
    }
  }
  if (!best) throw new Error("Não encontrei o cartão azul. Deixe o cartão inteiro visível, sem reflexo e no mesmo plano do dedo.");

  const points: Array<[number, number]> = [];
  for (let y = best.minY; y <= best.maxY; y++) {
    for (let x = best.minX; x <= best.maxX; x++) {
      if (mask[y * work.width + x]) points.push([x, y]);
    }
  }
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    const dx = x - meanX;
    const dy = y - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = points.map(([x, y]) => (x - meanX) * cos + (y - meanY) * sin);
  const across = points.map(([x, y]) => -(x - meanX) * sin + (y - meanY) * cos);
  const axisA = percentile(along, 0.995) - percentile(along, 0.005);
  const axisB = percentile(across, 0.995) - percentile(across, 0.005);
  const longPx = Math.max(axisA, axisB) / scale;
  const shortPx = Math.min(axisA, axisB) / scale;
  const longScale = longPx / 85.6;
  const shortScale = shortPx / 53.98;
  const disagreement = Math.abs(longScale - shortScale) / ((longScale + shortScale) / 2);
  if (disagreement > 0.22) throw new Error("O cartão ficou inclinado. Apoie cartão e dedo na mesma superfície e fotografe de cima.");

  return {
    pixelsPerMm: (longScale + shortScale) / 2,
    confidence: Math.max(55, Math.min(98, Math.round(98 - disagreement * 160))),
    cardBox: {
      x: best.minX / work.width,
      y: best.minY / work.height,
      width: (best.maxX - best.minX + 1) / work.width,
      height: (best.maxY - best.minY + 1) / work.height,
    },
  };
}

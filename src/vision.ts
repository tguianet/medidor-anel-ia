export type CardAnalysis = {
  pixelsPerMm: number;
  confidence: number;
  annotatedPhoto: string;
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
  const blueDominant = b > r * 1.08 && b > g * 1.03;
  return saturation > 0.28 && max > 55 && blueDominant;
};

export async function detectCard(photo: string): Promise<CardAnalysis> {
  const image = await loadImage(photo);
  await new Promise((resolve) => setTimeout(resolve, 30));

  const work = document.createElement("canvas");
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  work.width = Math.max(1, Math.round(image.naturalWidth * scale));
  work.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const workCtx = work.getContext("2d", { willReadFrequently: true })!;
  workCtx.drawImage(image, 0, 0, work.width, work.height);

  const pixels = workCtx.getImageData(0, 0, work.width, work.height).data;
  const total = work.width * work.height;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const offset = i * 4;
    mask[i] = isCardColor(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ? 1 : 0;
  }

  const visited = new Uint8Array(total);
  const candidates: Box[] = [];
  const queue = new Int32Array(total);

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

      const neighbors = [index - 1, index + 1, index - work.width, index + work.width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        const nx = next % work.width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (box.count > total * 0.004) candidates.push(box);
  }

  let best: { box: Box; score: number; ratio: number } | null = null;
  for (const box of candidates) {
    const width = box.maxX - box.minX + 1;
    const height = box.maxY - box.minY + 1;
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const ratio = long / Math.max(short, 1);
    const boxArea = width * height;
    const density = box.count / boxArea;
    const areaShare = boxArea / total;
    if (ratio < 1.2 || ratio > 2.05 || areaShare < 0.01 || areaShare > 0.35) continue;
    const score = boxArea * density * Math.max(0.1, 1 - Math.abs(ratio - 1.586));
    if (!best || score > best.score) best = { box, score, ratio };
  }

  if (!best) {
    throw new Error("Não encontrei o cartão azul. Aproxime um pouco, deixe os quatro cantos visíveis e evite reflexo.");
  }

  const factor = 1 / scale;
  const x = best.box.minX * factor;
  const y = best.box.minY * factor;
  const width = (best.box.maxX - best.box.minX + 1) * factor;
  const height = (best.box.maxY - best.box.minY + 1) * factor;
  const longPx = Math.max(width, height);
  const shortPx = Math.min(width, height);
  const pixelsPerMm = ((longPx / 85.6) + (shortPx / 53.98)) / 2;
  const confidence = Math.max(55, Math.min(96, Math.round(96 - Math.abs(best.ratio - 1.586) * 70)));

  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const ctx = output.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  ctx.strokeStyle = "#f2cf73";
  ctx.lineWidth = Math.max(5, output.width / 180);
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#f2cf73";
  ctx.font = `bold ${Math.max(24, output.width / 32)}px sans-serif`;
  ctx.fillText("CARTÃO RECONHECIDO", x, Math.max(38, y - 16));

  return {
    pixelsPerMm,
    confidence,
    annotatedPhoto: output.toDataURL("image/jpeg", 0.9),
  };
}

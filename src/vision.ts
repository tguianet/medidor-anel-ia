export type CardAnalysis = {
  pixelsPerMm: number;
  confidence: number;
  annotatedPhoto: string;
  fingerWidthMm: number;
  circumferenceMm: number;
  ringSize: number;
  ringRange: [number, number];
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

  // Segmentação leve de pele em YCbCr para localizar os quatro dedos.
  const skinMask = new Uint8Array(total);
  let skinMinX = work.width, skinMinY = work.height, skinMaxX = 0, skinMaxY = 0;
  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const x = index % work.width;
    const y = (index / work.width) | 0;
    const insideCard = x >= best.box.minX - 3 && x <= best.box.maxX + 3 &&
      y >= best.box.minY - 3 && y <= best.box.maxY + 3;
    const skin = !insideCard && r > 45 && r > b * 1.08 && cb > 72 && cb < 136 && cr > 132 && cr < 183;
    if (skin) {
      skinMask[index] = 1;
      skinMinX = Math.min(skinMinX, x); skinMaxX = Math.max(skinMaxX, x);
      skinMinY = Math.min(skinMinY, y); skinMaxY = Math.max(skinMaxY, y);
    }
  }

  if (skinMaxX <= skinMinX || skinMaxY <= skinMinY) {
    throw new Error("Encontrei o cartão, mas não consegui separar a mão do fundo. Use uma mesa clara e iluminação uniforme.");
  }

  type Run = { start: number; end: number; width: number };
  let selectedRuns: Run[] | null = null;
  let selectedY = 0;
  const cardIsRight = (best.box.minX + best.box.maxX) / 2 > (skinMinX + skinMaxX) / 2;
  const ringSamples: Array<{ run: Run; row: number }> = [];
  const searchBottom = Math.round(skinMinY + (skinMaxY - skinMinY) * 0.52);

  for (let row = skinMinY; row <= searchBottom; row++) {
    const runs: Run[] = [];
    let start = -1;
    for (let col = skinMinX; col <= skinMaxX + 1; col++) {
      const on = col <= skinMaxX && skinMask[row * work.width + col] === 1;
      if (on && start < 0) start = col;
      if (!on && start >= 0) {
        const width = col - start;
        if (width >= 4 && width <= work.width * 0.18) runs.push({ start, end: col - 1, width });
        start = -1;
      }
    }
    if (runs.length >= 4) {
      const four = runs.length === 4
        ? runs
        : [...runs].sort((a, b) => b.width - a.width).slice(0, 4).sort((a, b) => a.start - b.start);
      selectedRuns = four;
      selectedY = row;
      four.sort((a, b) => a.start - b.start);
      const target = cardIsRight ? four[1] : four[four.length - 2];
      ringSamples.push({ run: target, row });
    }
  }

  if (!selectedRuns || selectedRuns.length < 4 || ringSamples.length < 6) {
    throw new Error("Cartão encontrado, mas não consegui distinguir os quatro dedos. Afaste bem os dedos e tire outra foto.");
  }

  // Evita medir a ponta e também a membrana entre os dedos.
  const startAt = Math.floor(ringSamples.length * 0.35);
  const endAt = Math.max(startAt + 1, Math.floor(ringSamples.length * 0.78));
  const stableSamples = ringSamples.slice(startAt, endAt).sort((a, b) => a.run.width - b.run.width);
  const chosen = stableSamples[Math.floor(stableSamples.length / 2)];
  const ringRun = chosen.run;
  selectedY = chosen.row;

  const widths = stableSamples.map((sample) => sample.run.width);
  const minWidth = Math.min(...widths);
  const maxWidth = Math.max(...widths);
  if (maxWidth / Math.max(1, minWidth) > 1.38) {
    throw new Error("A leitura do dedo ficou instável. Mantenha a mão reta, afaste os dedos e fotografe exatamente de cima.");
  }

  const fingerWidthOriginalPx = ringRun.width / scale;
  const fingerWidthMm = fingerWidthOriginalPx / pixelsPerMm;
  if (fingerWidthMm < 13 || fingerWidthMm > 28) {
    throw new Error("A largura encontrada não parece válida. Aproxime a mão e mantenha os quatro dedos separados.");
  }
  const circumferenceMm = fingerWidthMm * 2.85;
  const ringSize = Math.max(5, Math.min(40, Math.round(circumferenceMm - 40)));
  const ringRange: [number, number] = [Math.max(5, ringSize - 1), Math.min(40, ringSize + 1)];

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

  const lineY = selectedY / scale;
  const lineStart = ringRun.start / scale;
  const lineEnd = ringRun.end / scale;
  ctx.strokeStyle = "#52e0a3";
  ctx.lineWidth = Math.max(6, output.width / 160);
  ctx.beginPath();
  ctx.moveTo(lineStart, lineY);
  ctx.lineTo(lineEnd, lineY);
  ctx.stroke();
  ctx.fillStyle = "#52e0a3";
  ctx.font = `bold ${Math.max(24, output.width / 34)}px sans-serif`;
  ctx.fillText("ANELAR", lineStart, Math.max(40, lineY - 18));

  return {
    pixelsPerMm,
    confidence,
    annotatedPhoto: output.toDataURL("image/jpeg", 0.9),
    fingerWidthMm,
    circumferenceMm,
    ringSize,
    ringRange,
  };
}

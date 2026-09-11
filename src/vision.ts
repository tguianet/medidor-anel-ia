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

const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const percentile = (values: number[], amount: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.round((ordered.length - 1) * amount)))];
};

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

  // Mede o cartão nos próprios eixos. A caixa alinhada à tela muda bastante
  // quando o cartão gira e era a principal fonte de resultados diferentes.
  const cardPoints: Array<[number, number]> = [];
  for (let py = best.box.minY; py <= best.box.maxY; py++) {
    for (let px = best.box.minX; px <= best.box.maxX; px++) {
      if (mask[py * work.width + px]) cardPoints.push([px, py]);
    }
  }
  const meanX = cardPoints.reduce((sum, point) => sum + point[0], 0) / cardPoints.length;
  const meanY = cardPoints.reduce((sum, point) => sum + point[1], 0) / cardPoints.length;
  let covXX = 0, covXY = 0, covYY = 0;
  for (const [px, py] of cardPoints) {
    const dx = px - meanX;
    const dy = py - meanY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  const cardAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const axisX = Math.cos(cardAngle), axisY = Math.sin(cardAngle);
  const crossX = -axisY, crossY = axisX;
  const along = cardPoints.map(([px, py]) => (px - meanX) * axisX + (py - meanY) * axisY);
  const across = cardPoints.map(([px, py]) => (px - meanX) * crossX + (py - meanY) * crossY);
  const orientedA = percentile(along, 0.99) - percentile(along, 0.01);
  const orientedB = percentile(across, 0.99) - percentile(across, 0.01);
  const cardLong = Math.max(orientedA, orientedB);
  const cardShort = Math.min(orientedA, orientedB);
  const orientedRatio = cardLong / Math.max(cardShort, 1);
  if (orientedRatio < 1.35 || orientedRatio > 1.82) {
    throw new Error("O cartão está muito inclinado. Apoie cartão e mão na mesma superfície e fotografe totalmente de cima.");
  }

  const factor = 1 / scale;
  const x = best.box.minX * factor;
  const y = best.box.minY * factor;
  const width = (best.box.maxX - best.box.minX + 1) * factor;
  const height = (best.box.maxY - best.box.minY + 1) * factor;
  const longPx = cardLong * factor;
  const shortPx = cardShort * factor;
  const pixelsPerMm = ((longPx / 85.6) + (shortPx / 53.98)) / 2;
  const scaleLong = longPx / 85.6;
  const scaleShort = shortPx / 53.98;
  const scaleDisagreement = Math.abs(scaleLong - scaleShort) / ((scaleLong + scaleShort) / 2);
  if (scaleDisagreement > 0.16) {
    throw new Error("A perspectiva da foto está alterando a medida. Deixe o celular paralelo ao cartão e tente novamente.");
  }
  const confidence = Math.max(55, Math.min(96, Math.round(96 - scaleDisagreement * 180)));

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

  // Mantém somente a maior região de pele conectada (dedo + mão).
  const skinVisited = new Uint8Array(total);
  const skinLabels = new Int32Array(total);
  const skinQueue = new Int32Array(total);
  const componentSizes: number[] = [0];
  let componentId = 0;

  for (let start = 0; start < total; start++) {
    if (!skinMask[start] || skinVisited[start]) continue;
    componentId++;
    let head = 0;
    let tail = 0;
    skinQueue[tail++] = start;
    skinVisited[start] = 1;
    let size = 0;

    while (head < tail) {
      const index = skinQueue[head++];
      skinLabels[index] = componentId;
      size++;
      const x = index % work.width;
      const neighbors = [index - 1, index + 1, index - work.width, index + work.width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || skinVisited[next] || !skinMask[next]) continue;
        const nx = next % work.width;
        if (Math.abs(nx - x) > 1) continue;
        skinVisited[next] = 1;
        skinQueue[tail++] = next;
      }
    }
    componentSizes[componentId] = size;
  }

  let largestLabel = 0;
  for (let id = 1; id < componentSizes.length; id++) {
    if (componentSizes[id] > (componentSizes[largestLabel] || 0)) largestLabel = id;
  }

  skinMinX = work.width; skinMinY = work.height; skinMaxX = 0; skinMaxY = 0;
  for (let index = 0; index < total; index++) {
    if (skinLabels[index] !== largestLabel) {
      skinMask[index] = 0;
      continue;
    }
    const x = index % work.width;
    const y = (index / work.width) | 0;
    skinMinX = Math.min(skinMinX, x); skinMaxX = Math.max(skinMaxX, x);
    skinMinY = Math.min(skinMinY, y); skinMaxY = Math.max(skinMaxY, y);
  }

  if (skinMaxX <= skinMinX || skinMaxY <= skinMinY) {
    throw new Error("Encontrei o cartão, mas não consegui separar a mão do fundo. Use uma mesa clara e iluminação uniforme.");
  }

  // Coordenada fixa da aliança virtual exibida no visor 3:4.
  const targetX = Math.round(work.width * 0.26);
  const targetY = Math.round(work.height * 0.49);
  let centerX = targetX;
  let centerY = targetY;

  if (!skinMask[centerY * work.width + centerX]) {
    let found = false;
    const tolerance = Math.round(work.width * 0.025);
    for (let radius = 1; radius <= tolerance && !found; radius++) {
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = targetX + dx;
          const y = targetY + dy;
          if (x >= 0 && x < work.width && y >= 0 && y < work.height &&
              skinMask[y * work.width + x]) {
            centerX = x; centerY = y; found = true; break;
          }
        }
      }
    }
    if (!found) {
      throw new Error("O dedo não ficou encaixado na aliança dourada. Posicione o local do anel dentro da marca e tire outra foto.");
    }
  }

  // Mede várias linhas ao redor do ponto do anel. Sombras ou ruído em uma
  // única linha não conseguem mais alterar todo o resultado.
  const samples: Array<{ width: number; left: number; right: number; y: number }> = [];
  const sampleRadius = Math.max(4, Math.round(work.height * 0.012));
  for (let offsetY = -sampleRadius; offsetY <= sampleRadius; offsetY += 2) {
    const sampleY = centerY + offsetY;
    if (sampleY < 0 || sampleY >= work.height || !skinMask[sampleY * work.width + centerX]) continue;
    let sampleLeft = centerX;
    let sampleRight = centerX;
    while (sampleLeft > 0 && skinMask[sampleY * work.width + sampleLeft - 1]) sampleLeft--;
    while (sampleRight < work.width - 1 && skinMask[sampleY * work.width + sampleRight + 1]) sampleRight++;
    samples.push({ width: sampleRight - sampleLeft + 1, left: sampleLeft, right: sampleRight, y: sampleY });
  }
  if (samples.length < 5) {
    throw new Error("O ponto do anel não ficou nítido o suficiente. Use fundo liso, boa luz e mantenha o dedo parado.");
  }
  const measuredWidth = median(samples.map((sample) => sample.width));
  const deviations = samples.map((sample) => Math.abs(sample.width - measuredWidth) / measuredWidth);
  if (median(deviations) > 0.08 || Math.max(...deviations) > 0.22) {
    throw new Error("As bordas do dedo variaram muito no ponto do anel. Mantenha o dedo reto, sem sombra, e tire outra foto.");
  }
  const representative = samples.reduce((bestSample, sample) =>
    Math.abs(sample.width - measuredWidth) < Math.abs(bestSample.width - measuredWidth) ? sample : bestSample
  );
  const left = representative.left;
  const right = representative.right;
  centerY = representative.y;

  if (measuredWidth < 4 || measuredWidth > work.width * 0.16) {
    throw new Error("Não consegui separar as bordas dentro da aliança dourada. Use fundo contrastante e mantenha o dedo reto.");
  }

  const lineStartX = left;
  const lineStartY = centerY;
  const lineEndX = right;
  const lineEndY = centerY;
  const fingerWidthOriginalPx = measuredWidth / scale;
  const fingerWidthMm = fingerWidthOriginalPx / pixelsPerMm;
  if (fingerWidthMm < 13 || fingerWidthMm > 28) {
    throw new Error("A largura encontrada não parece válida. Deixe somente um dedo estendido e mantenha a câmera paralela.");
  }
  // Aro brasileiro: circunferência interna em mm menos 40.
  // Acrescenta 0,4 mm ao diâmetro visível para a folga confortável.
  const circumferenceMm = Math.PI * (fingerWidthMm + 0.4);
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

  const lineStartXOut = lineStartX / scale;
  const lineStartYOut = lineStartY / scale;
  const lineEndXOut = lineEndX / scale;
  const lineEndYOut = lineEndY / scale;
  const ringCenterX = (lineStartXOut + lineEndXOut) / 2;
  const ringCenterY = (lineStartYOut + lineEndYOut) / 2;
  const ringRadiusX = Math.hypot(lineEndXOut - lineStartXOut, lineEndYOut - lineStartYOut) / 2;
  const ringAngle = Math.atan2(lineEndYOut - lineStartYOut, lineEndXOut - lineStartXOut);
  const bandWidth = Math.max(5, ringRadiusX * 0.16);
  ctx.strokeStyle = "#52e0a3";
  ctx.lineWidth = Math.max(4, output.width / 260);
  ctx.beginPath();
  ctx.ellipse(ringCenterX, ringCenterY, ringRadiusX, Math.max(5, ringRadiusX * 0.22), ringAngle, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(3, output.width / 340);
  ctx.beginPath();
  ctx.ellipse(ringCenterX, ringCenterY, Math.max(2, ringRadiusX - bandWidth), Math.max(3, ringRadiusX * 0.14), ringAngle, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#52e0a3";
  ctx.font = `bold ${Math.max(24, output.width / 34)}px sans-serif`;
  ctx.fillText("PONTO MEDIDO", lineStartXOut, Math.max(40, lineStartYOut - 18));

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

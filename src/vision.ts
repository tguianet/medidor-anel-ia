import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

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

let handLandmarkerPromise: Promise<HandLandmarker> | null = null;

const getHandLandmarker = () => {
  if (!handLandmarkerPromise) {
    handLandmarkerPromise = (async () => {
      const files = await FilesetResolver.forVisionTasks(
        "/mediapipe/wasm",
      );
      const options = {
        baseOptions: {
          modelAssetPath: "/mediapipe/hand_landmarker.task",
        },
        runningMode: "IMAGE" as const,
        numHands: 1,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
      };
      try {
        return await HandLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "GPU" },
        });
      } catch {
        return HandLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" },
        });
      }
    })();
  }
  return Promise.race([
    handLandmarkerPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("O reconhecimento da mão demorou para carregar. Verifique a internet e tente novamente.")), 25000),
    ),
  ]);
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

  const landmarker = await getHandLandmarker();
  const handResult = landmarker.detect(work);
  const landmarks = handResult.landmarks?.[0];

  if (!landmarks) {
    throw new Error("Não reconheci a mão. Mostre a palma aberta, deixe os quatro dedos visíveis e tente novamente.");
  }

  // Pontos 13 e 14: base e primeira articulação do anelar.
  const mcp = landmarks[13];
  const pip = landmarks[14];
  const centerX = (mcp.x + (pip.x - mcp.x) * 0.58) * work.width;
  const centerY = (mcp.y + (pip.y - mcp.y) * 0.58) * work.height;
  const vx = pip.x - mcp.x;
  const vy = pip.y - mcp.y;
  const length = Math.hypot(vx, vy) || 1;
  const nx = -vy / length;
  const ny = vx / length;

  const colorAt = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(work.width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(work.height - 1, Math.round(y)));
    const offset = (iy * work.width + ix) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };

  const colorDistance = (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const workPixelsPerMm = pixelsPerMm * scale;
  const minEdgeDistance = Math.max(3, workPixelsPerMm * 6.2);
  const maxEdgeDistance = Math.min(work.width * 0.1, workPixelsPerMm * 15);
  const expectedHalfWidth = workPixelsPerMm * 12.7;
  const centerColor = colorAt(centerX, centerY);

  const findEdge = (direction: number) => {
    let bestDistance = 0;
    let bestScore = -Infinity;
    let bestContrast = 0;
    for (let distance = minEdgeDistance; distance <= maxEdgeDistance; distance += 0.35) {
      const inner = colorAt(
        centerX + nx * direction * (distance - 1.4),
        centerY + ny * direction * (distance - 1.4),
      );
      const outer = colorAt(
        centerX + nx * direction * (distance + 1.8),
        centerY + ny * direction * (distance + 1.8),
      );
      const localContrast = colorDistance(inner, outer);
      const outsideDifference = colorDistance(centerColor, outer);
      const distancePenalty = Math.abs(distance - expectedHalfWidth) * 0.22;
      const score = localContrast + outsideDifference * 0.3 - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestContrast = localContrast;
        bestDistance = distance;
      }
    }
    return { distance: bestDistance, score: bestScore, contrast: bestContrast };
  };

  const negativeEdge = findEdge(-1);
  const positiveEdge = findEdge(1);
  if (negativeEdge.contrast < 8 || positiveEdge.contrast < 8) {
    throw new Error("Reconheci o anelar, mas faltou contraste nas laterais. Use uma superfície de cor diferente da pele.");
  }

  const symmetry = Math.max(negativeEdge.distance, positiveEdge.distance) /
    Math.max(1, Math.min(negativeEdge.distance, positiveEdge.distance));
  if (symmetry > 1.42) {
    throw new Error("As bordas do anelar ficaram assimétricas. Deixe o dedo reto e a câmera paralela.");
  }

  const measuredWidth = negativeEdge.distance + positiveEdge.distance;
  const lineStartX = centerX - nx * negativeEdge.distance;
  const lineStartY = centerY - ny * negativeEdge.distance;
  const lineEndX = centerX + nx * positiveEdge.distance;
  const lineEndY = centerY + ny * positiveEdge.distance;
  const fingerWidthOriginalPx = measuredWidth / scale;
  const fingerWidthOriginalPx = measuredWidth / scale;
  const fingerWidthMm = fingerWidthOriginalPx / pixelsPerMm;
  if (fingerWidthMm < 13 || fingerWidthMm > 28) {
    throw new Error("A largura encontrada não parece válida. Aproxime a mão e mantenha os quatro dedos separados.");
  }
  // Calibração experimental na linha fixa: 25,4 mm detectados = aro 24 (64 mm).
  // Coeficiente inicial: 64 / 25,4 = 2,519685.
  const circumferenceMm = fingerWidthMm * 2.519685;
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
  ctx.fillText("ANELAR RECONHECIDO", lineStartXOut, Math.max(40, lineStartYOut - 18));

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

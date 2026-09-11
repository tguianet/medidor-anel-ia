declare global {
  interface Window { cv: any; }
}

export type CardAnalysis = {
  pixelsPerMm: number;
  confidence: number;
  annotatedPhoto: string;
};

const waitForOpenCv = async () => {
  for (let i = 0; i < 100; i++) {
    if (window.cv?.Mat) return window.cv;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("A visão computacional ainda está carregando. Tente novamente.");
};

const distance = (a: {x:number;y:number}, b: {x:number;y:number}) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export async function detectCard(photo: string): Promise<CardAnalysis> {
  const cv = await waitForOpenCv();
  const image = new Image();
  image.src = photo;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 135);
    cv.dilate(edges, edges, cv.Mat.ones(3, 3, cv.CV_8U));
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = src.rows * src.cols;
    let best: { points: Array<{x:number;y:number}>; score: number; area: number } | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = Math.abs(cv.contourArea(contour));
      if (area < imageArea * 0.015 || area > imageArea * 0.45) {
        contour.delete();
        continue;
      }

      const perimeter = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, perimeter * 0.025, true);

      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = [];
        for (let p = 0; p < 4; p++) {
          pts.push({ x: approx.intPtr(p, 0)[0], y: approx.intPtr(p, 0)[1] });
        }
        const sides = pts.map((point, p) => distance(point, pts[(p + 1) % 4]));
        const long = (Math.max(sides[0], sides[2]) + Math.max(sides[1], sides[3])) / 2;
        const short = (Math.min(sides[0], sides[2]) + Math.min(sides[1], sides[3])) / 2;
        const ratio = long / Math.max(short, 1);
        const ratioError = Math.abs(ratio - 1.586);
        const rectangularity = area / Math.max(1, long * short);
        const score = area * Math.max(0, 1 - ratioError / 0.45) * Math.min(1, rectangularity);

        if (ratio > 1.25 && ratio < 1.95 && (!best || score > best.score)) {
          best = { points: pts, score, area };
        }
      }
      approx.delete();
      contour.delete();
    }

    if (!best) throw new Error("Não encontrei o cartão. Mostre os quatro cantos e use um fundo que contraste.");

    const sides = best.points.map((point, p) => distance(point, best!.points[(p + 1) % 4]));
    const sorted = [...sides].sort((a, b) => a - b);
    const shortPx = (sorted[0] + sorted[1]) / 2;
    const longPx = (sorted[2] + sorted[3]) / 2;
    const pixelsPerMm = ((longPx / 85.6) + (shortPx / 53.98)) / 2;
    const measuredRatio = longPx / shortPx;
    const confidence = Math.max(55, Math.min(98, Math.round(98 - Math.abs(measuredRatio - 1.586) * 85)));

    ctx.strokeStyle = "#f2cf73";
    ctx.lineWidth = Math.max(5, canvas.width / 180);
    ctx.beginPath();
    best.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#f2cf73";
    ctx.font = `bold ${Math.max(24, canvas.width / 30)}px sans-serif`;
    ctx.fillText("CARTÃO RECONHECIDO", best.points[0].x, Math.max(36, best.points[0].y - 18));

    return { pixelsPerMm, confidence, annotatedPhoto: canvas.toDataURL("image/jpeg", .92) };
  } finally {
    src.delete(); gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
}

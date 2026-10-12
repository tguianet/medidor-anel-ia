// medidordedov15: testes salvos para conferencia em lote.
// Cada teste guarda recortes da foto (dedo com linhas/snaps e as duas bordas
// do cartao com as linhas usadas) + todos os numeros. "Gerar relatorio" monta
// UMA imagem com todos os testes para o usuario enviar de uma vez.

export type Pt = { x: number; y: number };
export type SegLine = { a: Pt; b: Pt };

export type SavedTest = {
  id: string;
  createdAt: string;
  realRing: number | null;
  lines: string[]; // texto ja formatado
  fingerCrop: string; // dataURL jpeg
  cardLeftCrop: string;
  cardRightCrop: string;
};

const STORAGE_KEY = "medidordedov-tests";
const MAX_TESTS = 20;

export const loadTests = (): SavedTest[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const storeTests = (tests: SavedTest[]): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tests.slice(-MAX_TESTS)));
    return true;
  } catch {
    return false;
  }
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

type CropSpec = {
  // retangulo na escala 900 (coordenadas da foto de processamento)
  x0: number; y0: number; x1: number; y1: number;
  outW: number; outH: number;
};

const crop = (
  img: HTMLImageElement,
  scale: number, // pixels da imagem por pixel da escala 900
  spec: CropSpec,
  draw: (ctx: CanvasRenderingContext2D, map: (p: Pt) => Pt) => void,
) => {
  const c = document.createElement("canvas");
  c.width = spec.outW;
  c.height = spec.outH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, c.width, c.height);
  const sw = spec.x1 - spec.x0, sh = spec.y1 - spec.y0;
  const k = Math.min(spec.outW / sw, spec.outH / sh);
  const dw = sw * k, dh = sh * k;
  const ox = (spec.outW - dw) / 2, oy = (spec.outH - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, spec.x0 * scale, spec.y0 * scale, sw * scale, sh * scale, ox, oy, dw, dh);
  const map = (p: Pt) => ({ x: ox + (p.x - spec.x0) * k, y: oy + (p.y - spec.y0) * k });
  draw(ctx, map);
  return c.toDataURL("image/jpeg", 0.86);
};

const strokeLine = (ctx: CanvasRenderingContext2D, map: (p: Pt) => Pt, l: SegLine, color: string, w = 1.5) => {
  const a = map(l.a), b = map(l.b);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

const strokePath = (ctx: CanvasRenderingContext2D, map: (p: Pt) => Pt, pts: Pt[], color: string, w = 1.5) => {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  pts.forEach((p, i) => { const q = map(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  ctx.stroke();
};

export type TestGeometry = {
  photoUrl: string;
  photoWidth: number; // largura real da imagem em photoUrl
  baseWidth: number;  // 900
  baseHeight: number; // 1200
  fingerLeftX: number; fingerRightX: number; ringY: number;
  trackLeft: Pt[]; trackRight: Pt[];
  cardLeft: SegLine; cardRight: SegLine; cardBottomY: number;
};

export const makeCrops = async (g: TestGeometry) => {
  const img = await loadImage(g.photoUrl);
  const scale = g.photoWidth / g.baseWidth;
  const W = g.baseWidth, H = g.baseHeight;
  const clampX = (v: number) => Math.max(0, Math.min(W, v));
  const clampY = (v: number) => Math.max(0, Math.min(H, v));

  const fw = g.fingerRightX - g.fingerLeftX;
  const ys = [...g.trackLeft, ...g.trackRight].map((p) => p.y);
  const yTop = Math.min(g.ringY, g.cardBottomY, ...ys) - 25;
  const yBot = Math.max(g.ringY, ...ys) + 25;
  const fingerCrop = crop(img, scale, {
    x0: clampX(g.fingerLeftX - fw * 0.35), x1: clampX(g.fingerRightX + fw * 0.35),
    y0: clampY(yTop), y1: clampY(yBot), outW: 520, outH: 420,
  }, (ctx, map) => {
    strokeLine(ctx, map, { a: { x: g.fingerLeftX, y: yTop }, b: { x: g.fingerLeftX, y: yBot } }, "#52e0a3", 1.2);
    strokeLine(ctx, map, { a: { x: g.fingerRightX, y: yTop }, b: { x: g.fingerRightX, y: yBot } }, "#52e0a3", 1.2);
    strokeLine(ctx, map, { a: { x: g.fingerLeftX - fw * 0.3, y: g.ringY }, b: { x: g.fingerRightX + fw * 0.3, y: g.ringY } }, "#f2cf73", 1.2);
    strokeLine(ctx, map, { a: { x: g.fingerLeftX - fw * 0.3, y: g.cardBottomY }, b: { x: g.fingerRightX + fw * 0.3, y: g.cardBottomY } }, "#ff6b6b", 1);
    strokePath(ctx, map, g.trackLeft, "#00e5ff", 1.6);
    strokePath(ctx, map, g.trackRight, "#00e5ff", 1.6);
  });

  const cardEdgeCrop = (l: SegLine) => {
    const xAtBase = l.a.x + (l.b.x - l.a.x) * ((g.cardBottomY - l.a.y) / ((l.b.y - l.a.y) || 1));
    return crop(img, scale, {
      x0: clampX(xAtBase - 22), x1: clampX(xAtBase + 22),
      y0: clampY(g.cardBottomY - 120), y1: clampY(g.cardBottomY + 20), outW: 200, outH: 420,
    }, (ctx, map) => {
      strokeLine(ctx, map, l, "#52e0a3", 1.2);
      strokeLine(ctx, map, { a: { x: xAtBase - 30, y: g.cardBottomY }, b: { x: xAtBase + 30, y: g.cardBottomY } }, "#ff6b6b", 1);
    });
  };

  return {
    fingerCrop,
    cardLeftCrop: cardEdgeCrop(g.cardLeft),
    cardRightCrop: cardEdgeCrop(g.cardRight),
  };
};

/** Monta uma imagem unica com todos os testes. */
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  const parts = text.split(" · ");
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    const next = cur ? `${cur} · ${part}` : part;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { out.push(cur); cur = `  ${part}`; }
  }
  if (cur) out.push(cur);
  return out;
};

export const buildReport = async (tests: SavedTest[], title: string): Promise<Blob | null> => {
  const W = 1500, headH = 70, textX = 965, textW = W - textX - 15, lineH = 22;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = "17px ui-monospace, Menlo, monospace";
  const wrapped = tests.map((t) => t.lines.flatMap((l) => wrap(measure, l, textW)));
  const rowHs = wrapped.map((ls) => Math.max(440, 66 + ls.length * lineH + 14));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = headH + rowHs.reduce((a, v) => a + v, 0);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#14100b";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f0cd78";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.fillText(title, 20, 46);
  let y = headH;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const rowH = rowHs[i];
    ctx.fillStyle = i % 2 ? "#1c160f" : "#211a12";
    ctx.fillRect(0, y, W, rowH);
    const [f, l, r] = await Promise.all([loadImage(t.fingerCrop), loadImage(t.cardLeftCrop), loadImage(t.cardRightCrop)]);
    ctx.drawImage(f, 10, y + 10, 520, 420);
    ctx.drawImage(l, 540, y + 10, 200, 420);
    ctx.drawImage(r, 750, y + 10, 200, 420);
    ctx.fillStyle = "#f4e7c8";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(`#${i + 1}  ${t.createdAt}${t.realRing ? `  ·  aro real ${t.realRing}` : ""}`, textX, y + 36);
    ctx.font = "17px ui-monospace, Menlo, monospace";
    wrapped[i].forEach((line, j) => ctx.fillText(line, textX, y + 66 + j * lineH));
    y += rowH;
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.9));
};

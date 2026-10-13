// medidordedov23 — motor de precisão.
//
// 1) RESOLUÇÃO TOTAL: trabalha na foto original da câmera do celular
//    (~3000×4000), não na cópia de 900×1200. Cada pixel vale ~0,03 mm.
// 2) ÍMÃ: as bordas do cartão e do dedo são localizadas com precisão
//    subpixel ao longo de dezenas de cortes e ajustadas por uma reta robusta.
//    Cartão: contraste RGB + cromaticidade (cor sem brilho: a sombra some).
// 3) DEDO AUTOMÁTICO: na altura do anel, encontra o par de bordas
//    (esquerda/direita) que forma o dedo debaixo do cartão.
// 4) INCLINAÇÃO E ALTURA: com a distância focal da foto (EXIF), as laterais
//    e a base do cartão definem o plano do cartão em 3D (inclinação e
//    distância). As bordas do dedo ficam ABAIXO do cartão (metade da
//    espessura do dedo), então são projetadas num plano paralelo mais
//    distante. Isso corrige o efeito de "cartão mais alto/mais baixo" e de
//    celular inclinado.

import { chromaticityImage, findCardEdge, type RgbaImage } from "./cardEdges";

export type Pt = { x: number; y: number };
export type Seg = { a: Pt; b: Pt };
export type Region = RgbaImage & { x0: number; y0: number };

export type PixelSource = {
  width: number;
  height: number;
  region: (x: number, y: number, w: number, h: number) => Region;
};

export const CARD_W_MM = 85.6;
export const CARD_H_MM = 53.98;
/** Profundidade da borda do dedo abaixo do cartão, em fração da largura do dedo. */
export const FINGER_DEPTH_RATIO = 0.5;
/** Enquadramento de referência da curva atual: cartão ocupando 90% da largura da foto. */
export const REFERENCE_CARD_FRACTION = 0.9;
/** Lente principal típica de celular (equivalente 35 mm) quando a foto não traz EXIF. */
export const DEFAULT_FOCAL_35MM = 26;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export const sourceFromCanvas = (canvas: HTMLCanvasElement): PixelSource => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  return {
    width: canvas.width,
    height: canvas.height,
    region(x, y, w, h) {
      const x0 = clampInt(x, 0, canvas.width - 1);
      const y0 = clampInt(y, 0, canvas.height - 1);
      const x1 = clampInt(x + w, x0 + 1, canvas.width);
      const y1 = clampInt(y + h, y0 + 1, canvas.height);
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      return { data: d.data, width: d.width, height: d.height, x0, y0 };
    },
  };
};

export const sourceFromPixels = (p: { data: Uint8ClampedArray; width: number; height: number }): PixelSource => ({
  width: p.width,
  height: p.height,
  region(x, y, w, h) {
    const x0 = clampInt(x, 0, p.width - 1);
    const y0 = clampInt(y, 0, p.height - 1);
    const x1 = clampInt(x + w, x0 + 1, p.width);
    const y1 = clampInt(y + h, y0 + 1, p.height);
    const rw = x1 - x0, rh = y1 - y0;
    const out = new Uint8ClampedArray(rw * rh * 4);
    for (let r = 0; r < rh; r++) {
      const s = ((y0 + r) * p.width + x0) * 4;
      out.set(p.data.subarray(s, s + rw * 4), r * rw * 4);
    }
    return { data: out, width: rw, height: rh, x0, y0 };
  },
});

// ---------------------------------------------------------------------------
// Ajuste robusto de reta: across = a + b * along
// ---------------------------------------------------------------------------
type FitPoint = { along: number; across: number; w: number };

export const robustFit = (pts: FitPoint[], minKeep = 4) => {
  let use = pts.slice();
  let a = 0, b = 0;
  for (let it = 0; it < 5; it++) {
    let sw = 0, s1 = 0, s2 = 0, s11 = 0, s12 = 0;
    for (const p of use) {
      sw += p.w; s1 += p.w * p.along; s2 += p.w * p.across;
      s11 += p.w * p.along * p.along; s12 += p.w * p.along * p.across;
    }
    const den = sw * s11 - s1 * s1;
    if (sw <= 0) break;
    b = Math.abs(den) > 1e-9 ? (sw * s12 - s1 * s2) / den : 0;
    a = (s2 - b * s1) / sw;
    const res = pts.map((p) => Math.abs(p.across - (a + b * p.along)));
    const mad = [...res].sort((u, v) => u - v)[Math.floor(res.length / 2)] || 0.1;
    const lim = Math.max(0.5, 2.5 * 1.4826 * mad);
    const next = pts.filter((_, k) => res[k] <= lim);
    if (next.length < minKeep || next.length === use.length) { if (next.length >= minKeep) use = next; break; }
    use = next;
  }
  const res = use.map((p) => p.across - (a + b * p.along));
  const rms = res.length ? Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length) : Infinity;
  return { a, b, kept: use.length, rms };
};

// ---------------------------------------------------------------------------
// 1) Bordas do cartão
// ---------------------------------------------------------------------------
export type CardEdgeName = "left" | "right" | "top" | "bottom";

export type CardEdgeFit = {
  line: Seg;
  points: number;
  total: number;
  rmsPx: number;
  chromaShare: number;
  ok: boolean;
};

export const refineCardEdge = (
  src: PixelSource,
  seg: Seg,
  edge: CardEdgeName,
  pxPerMm: number,
  radiusMm = 1.5,
): CardEdgeFit | null => {
  const vertical = edge === "left" || edge === "right";
  // across/along do segmento informado
  const A = vertical ? { along: seg.a.y, across: seg.a.x } : { along: seg.a.x, across: seg.a.y };
  const B = vertical ? { along: seg.b.y, across: seg.b.x } : { along: seg.b.x, across: seg.b.y };
  if (Math.abs(B.along - A.along) < 10) return null;
  const slope = (B.across - A.across) / (B.along - A.along);
  const acrossAt = (along: number) => A.across + slope * (along - A.along);
  const lo = Math.min(A.along, B.along), hi = Math.max(A.along, B.along);
  const span = hi - lo;

  const searchPx = Math.max(4, Math.round(radiusMm * pxPerMm));
  const half = Math.max(2, Math.round(pxPerMm * 0.2));
  const pad = half + 9;
  const K = 22;
  const segHalf = (span * 0.84) / K / 2;
  const pts: FitPoint[] = [];
  let chromaUsed = 0;

  for (let k = 0; k < K; k++) {
    const along = lo + span * 0.08 + span * 0.84 * ((k + 0.5) / K);
    const expected = acrossAt(along);
    const across0 = expected - searchPx - pad;
    const acrossLen = 2 * (searchPx + pad);
    const along0 = along - segHalf - 1;
    const alongLen = 2 * segHalf + 2;
    const reg = vertical
      ? src.region(across0, along0, acrossLen, alongLen)
      : src.region(along0, across0, alongLen, acrossLen);
    const rx = reg.x0, ry = reg.y0;
    const exp = vertical ? expected - rx : expected - ry;
    const from = vertical ? along - segHalf - ry : along - segHalf - rx;
    const to = vertical ? along + segHalf - ry : along + segHalf - rx;
    const opts = { side: edge, expected: exp, from, to, searchPx, halfWindow: half, samples: 8, scale: pxPerMm / 9.5 };
    const rgb = findCardEdge(reg, opts);
    const chroma = findCardEdge(chromaticityImage(reg), opts);
    const off = vertical ? rx : ry;
    let pos: number | null = null;
    let w = 0;
    const tol = Math.max(1.5, pxPerMm * 0.12);
    if (rgb.reliable && chroma.reliable) {
      if (Math.abs(rgb.position - chroma.position) <= tol) {
        pos = rgb.position; w = rgb.strength;
      } else {
        // Divergem: o RGB costuma ter pego a sombra. A cromaticidade ignora sombra.
        pos = chroma.position; w = chroma.strength; chromaUsed++;
      }
    } else if (rgb.reliable) {
      pos = rgb.position; w = rgb.strength;
    } else if (chroma.reliable) {
      pos = chroma.position; w = chroma.strength; chromaUsed++;
    }
    if (pos !== null) pts.push({ along, across: pos + off, w: Math.max(1, w) });
  }

  if (pts.length < 6) return { line: seg, points: pts.length, total: K, rmsPx: Infinity, chromaShare: 0, ok: false };
  const fit = robustFit(pts, 5);
  const mk = (along: number) => {
    const across = fit.a + fit.b * along;
    return vertical ? { x: across, y: along } : { x: along, y: across };
  };
  const ok = fit.kept >= Math.max(6, K * 0.45) && fit.rms <= Math.max(1.2, pxPerMm * 0.12);
  return {
    line: { a: mk(A.along), b: mk(B.along) },
    points: fit.kept,
    total: K,
    rmsPx: fit.rms,
    chromaShare: pts.length ? chromaUsed / pts.length : 0,
    ok,
  };
};

// ---------------------------------------------------------------------------
// Utilitários de imagem cinza numa região
// ---------------------------------------------------------------------------
const grayRegion = (reg: Region) => {
  const n = reg.width * reg.height;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    g[i] = reg.data[o] * 0.299 + reg.data[o + 1] * 0.587 + reg.data[o + 2] * 0.114;
  }
  return g;
};

const bilinear = (g: Float32Array, w: number, h: number, x: number, y: number) => {
  const xx = Math.max(0, Math.min(w - 1.001, x));
  const yy = Math.max(0, Math.min(h - 1.001, y));
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const fx = xx - x0, fy = yy - y0;
  const i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
};

// ---------------------------------------------------------------------------
// 2) Bordas do dedo (rastreamento denso perto das linhas verdes)
// ---------------------------------------------------------------------------
export type EdgeLine = { a: number; b: number }; // x = a + b*y (px da fonte)

export type FingerEdges = {
  left: EdgeLine;
  right: EdgeLine;
  rows: number;
  totalRows: number;
  widthPx: number;
  axisDeg: number;
  rmsLeftPx: number;
  rmsRightPx: number;
};

export const trackFingerEdges = (
  src: PixelSource,
  leftX: number,
  rightX: number,
  ringY: number,
  pxPerMm: number,
  opts: { halfBandMm?: number; radiusMm?: number } = {},
): FingerEdges | null => {
  if (!(rightX > leftX)) return null;
  const halfBand = Math.max(6, (opts.halfBandMm ?? 2.5) * pxPerMm);
  const R = Math.max(3, (opts.radiusMm ?? 0.6) * pxPerMm);
  const h = Math.max(1, 0.17 * pxPerMm);
  const pad = R + 3 * h + 4;
  const reg = src.region(leftX - pad, ringY - halfBand - 3, rightX - leftX + 2 * pad, 2 * halfBand + 6);
  const g = grayRegion(reg);
  const W = reg.width, H = reg.height;
  const lx = leftX - reg.x0, rxx = rightX - reg.x0, cy = ringY - reg.y0;

  const grad = (x: number, y: number) => {
    const span = Math.max(0.5, h * 0.6);
    let s = 0;
    for (const k of [-1, -0.5, 0, 0.5, 1]) s += bilinear(g, W, H, x + h, y + k * span) - bilinear(g, W, H, x - h, y + k * span);
    return s / 5;
  };
  const N = Math.max(30, Math.min(320, Math.round(2 * halfBand)));
  const rowsY = Array.from({ length: N }, (_, k) => cy - halfBand + (2 * halfBand * k) / (N - 1));

  // Polaridade de cada lado: média do gradiente na posição das linhas.
  let pl = 0, pr = 0;
  for (const y of rowsY) { pl += grad(lx, y); pr += grad(rxx, y); }
  const sL = Math.sign(pl) || 1;
  const sR = Math.sign(pr) || -1;

  const find = (pred: number, y: number, sign: number) => {
    const step = 0.25;
    let bestX = pred, bestG = -Infinity;
    const vals: number[] = [];
    for (let x = pred - R; x <= pred + R + 1e-9; x += step) {
      const v = grad(x, y) * sign;
      vals.push(v);
      if (v > bestG) { bestG = v; bestX = x; }
    }
    const i = Math.round((bestX - (pred - R)) / step);
    if (i > 0 && i < vals.length - 1) {
      const a = vals[i - 1], b = vals[i], c = vals[i + 1];
      const den = a - 2 * b + c;
      if (Math.abs(den) > 1e-9) bestX += Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) * step;
    }
    return { x: bestX, g: bestG };
  };

  const L: { y: number; x: number; g: number }[] = [];
  const Rt: { y: number; x: number; g: number }[] = [];
  for (const y of rowsY) {
    const el = find(lx, y, sL);
    const er = find(rxx, y, sR);
    L.push({ y, x: el.x, g: el.g });
    Rt.push({ y, x: er.x, g: er.g });
  }
  const med = (arr: number[]) => [...arr].sort((u, v) => u - v)[Math.floor(arr.length / 2)];
  const mL = med(L.map((p) => p.g)), mR = med(Rt.map((p) => p.g));
  const okRow = L.map((p, k) => p.g > 3 && Rt[k].g > 3 && p.g >= mL * 0.4 && Rt[k].g >= mR * 0.4);
  const ptsL = L.filter((_, k) => okRow[k]).map((p) => ({ along: p.y, across: p.x, w: 1 }));
  const ptsR = Rt.filter((_, k) => okRow[k]).map((p) => ({ along: p.y, across: p.x, w: 1 }));
  if (ptsL.length < Math.max(10, N * 0.3)) return null;
  const fl = robustFit(ptsL, 8);
  const fr = robustFit(ptsR, 8);
  const b = (fl.b + fr.b) / 2;
  const widthPx = (fr.a + fr.b * cy - (fl.a + fl.b * cy)) * Math.cos(Math.atan(b));
  // volta para coordenadas da fonte: x = a + b*y, com x,y globais
  const toGlobal = (f: { a: number; b: number }): EdgeLine => {
    // x_reg = a + b*y_reg ; x = x_reg + x0 ; y = y_reg + y0
    return { a: f.a + reg.x0 - f.b * reg.y0, b: f.b };
  };
  return {
    left: toGlobal(fl),
    right: toGlobal(fr),
    rows: Math.min(fl.kept, fr.kept),
    totalRows: N,
    widthPx,
    axisDeg: (Math.atan(b) * 180) / Math.PI,
    rmsLeftPx: fl.rms,
    rmsRightPx: fr.rms,
  };
};

// ---------------------------------------------------------------------------
// 3) Dedo automático: par de bordas na altura do anel
// ---------------------------------------------------------------------------
export type FingerPair = { leftX: number; rightX: number; score: number; widthMm: number };

export const detectFingerPair = (
  src: PixelSource,
  ringY: number,
  xMin: number,
  xMax: number,
  centerX: number,
  pxPerMm: number,
): FingerPair | null => {
  const halfBand = Math.max(4, 1.5 * pxPerMm);
  const h = Math.max(1, 0.3 * pxPerMm);
  const reg = src.region(xMin - h - 2, ringY - halfBand - 2, xMax - xMin + 2 * h + 4, 2 * halfBand + 4);
  const g = grayRegion(reg);
  const W = reg.width, H = reg.height;
  const rows = Math.min(40, Math.max(8, Math.round(2 * halfBand)));
  const step = Math.max(1, pxPerMm * 0.05);
  const xs: number[] = [];
  const prof: number[] = [];
  for (let x = xMin; x <= xMax; x += step) {
    const lxp = x - reg.x0;
    const vals: number[] = [];
    for (let r = 0; r < rows; r++) {
      const y = ringY - halfBand + (2 * halfBand * r) / (rows - 1) - reg.y0;
      vals.push(bilinear(g, W, H, lxp + h, y) - bilinear(g, W, H, lxp - h, y));
    }
    vals.sort((u, v) => u - v);
    xs.push(x);
    prof.push(vals[Math.floor(vals.length / 2)]);
  }
  if (prof.length < 10) return null;
  const maxAbs = Math.max(...prof.map(Math.abs));
  const T = Math.max(4, maxAbs * 0.2);
  type Ext = { x: number; v: number; i: number };
  const ext: Ext[] = [];
  for (let i = 1; i < prof.length - 1; i++) {
    const v = prof[i];
    if (Math.abs(v) < T) continue;
    if (Math.abs(v) >= Math.abs(prof[i - 1]) && Math.abs(v) >= Math.abs(prof[i + 1])) ext.push({ x: xs[i], v, i });
  }
  let best: FingerPair | null = null;
  for (let p = 0; p < ext.length; p++) {
    for (let q = p + 1; q < ext.length; q++) {
      const L = ext[p], Rr = ext[q];
      if (Math.sign(L.v) === Math.sign(Rr.v)) continue;
      const widthMm = (Rr.x - L.x) / pxPerMm;
      if (widthMm < 12 || widthMm > 27) continue;
      // interior deve ser liso comparado com as bordas
      const i0 = L.i + Math.round(pxPerMm / step), i1 = Rr.i - Math.round(pxPerMm / step);
      let inner = 0, n = 0;
      for (let i = i0; i <= i1; i++) { inner += Math.abs(prof[i]); n++; }
      inner = n ? inner / n : 0;
      const edgeStrength = Math.min(Math.abs(L.v), Math.abs(Rr.v));
      const smooth = 1 / (1 + 3 * (inner / edgeStrength));
      const mid = (L.x + Rr.x) / 2;
      const center = Math.exp(-(((mid - centerX) / (12 * pxPerMm)) ** 2));
      const widthPrior = widthMm >= 15 && widthMm <= 24 ? 1 : 0.7;
      const score = edgeStrength * smooth * center * widthPrior;
      if (!best || score > best.score) best = { leftX: L.x, rightX: Rr.x, score, widthMm };
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// 4) Plano do cartão em 3D (inclinação + distância) e largura real do dedo
// ---------------------------------------------------------------------------
type V3 = [number, number, number];
const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm = (u: V3) => Math.hypot(u[0], u[1], u[2]);
const unit = (u: V3): V3 => { const n = norm(u) || 1; return [u[0] / n, u[1] / n, u[2] / n]; };
const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const scale = (u: V3, s: number): V3 => [u[0] * s, u[1] * s, u[2] * s];

export type Camera = { f: number; cx: number; cy: number };

export type CardPlane = {
  n: V3;
  c: number; // distância perpendicular câmera → plano do cartão (mm)
  tiltDeg: number; // inclinação do cartão em relação ao sensor
  A: Pt; // esquerda × base (px)
  B: Pt; // direita × base (px)
  cardPx: number;
};

export const camRay = (cam: Camera, p: Pt): V3 => [(p.x - cam.cx) / cam.f, (p.y - cam.cy) / cam.f, 1];

const lineOf = (cam: Camera, s: Seg): V3 => cross(camRay(cam, s.a), camRay(cam, s.b));

export const solveCardPlane = (cam: Camera, left: Seg, right: Seg, bottom: Seg): CardPlane | null => {
  const lL = lineOf(cam, left), lR = lineOf(cam, right), lB = lineOf(cam, bottom);
  const d1 = unit(cross(lL, lR)); // direção 3D das laterais
  const nb = unit(lB);
  let d2 = cross(d1, nb);
  if (norm(d2) < 1e-9) return null;
  d2 = unit(d2);
  let n = unit(cross(d1, d2));
  const hA = cross(lL, lB), hB = cross(lR, lB);
  if (Math.abs(hA[2]) < 1e-12 || Math.abs(hB[2]) < 1e-12) return null;
  const rA: V3 = [hA[0] / hA[2], hA[1] / hA[2], 1];
  const rB: V3 = [hB[0] / hB[2], hB[1] / hB[2], 1];
  if (dot(n, rA) < 0) n = scale(n, -1);
  const nA = dot(n, rA), nB = dot(n, rB);
  if (nA <= 1e-9 || nB <= 1e-9) return null;
  const XA = scale(rA, 1 / nA), XB = scale(rB, 1 / nB);
  const c = CARD_W_MM / norm(sub(XA, XB));
  if (!Number.isFinite(c) || c <= 0) return null;
  const A = { x: rA[0] * cam.f + cam.cx, y: rA[1] * cam.f + cam.cy };
  const B = { x: rB[0] * cam.f + cam.cx, y: rB[1] * cam.f + cam.cy };
  return {
    n,
    c,
    tiltDeg: (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI,
    A,
    B,
    cardPx: Math.hypot(B.x - A.x, B.y - A.y),
  };
};

/**
 * Plano do cartão com fallback: se as 3 retas forem incoerentes com a focal
 * (foto sem EXIF, retas ruidosas) e a inclinação sair absurda, usamos o
 * modelo frontal (cartão paralelo ao sensor) na mesma distância média.
 */
export const solveCardPlaneSafe = (cam: Camera, left: Seg, right: Seg, bottom: Seg, maxTiltDeg = 25) => {
  const full = solveCardPlane(cam, left, right, bottom);
  if (full && full.tiltDeg <= maxTiltDeg) return { plane: full, model: "3d" as const };
  // frontal: mesmos pontos A/B, normal = eixo óptico
  const lL = lineOf(cam, left), lR = lineOf(cam, right), lB = lineOf(cam, bottom);
  const hA = cross(lL, lB), hB = cross(lR, lB);
  if (Math.abs(hA[2]) < 1e-12 || Math.abs(hB[2]) < 1e-12) return null;
  const rA: V3 = [hA[0] / hA[2], hA[1] / hA[2], 1];
  const rB: V3 = [hB[0] / hB[2], hB[1] / hB[2], 1];
  const c = CARD_W_MM / norm(sub(rA, rB));
  const A = { x: rA[0] * cam.f + cam.cx, y: rA[1] * cam.f + cam.cy };
  const B = { x: rB[0] * cam.f + cam.cx, y: rB[1] * cam.f + cam.cy };
  const plane: CardPlane = { n: [0, 0, 1], c, tiltDeg: 0, A, B, cardPx: Math.hypot(B.x - A.x, B.y - A.y) };
  return { plane, model: "frontal" as const };
};

/** Ponto da imagem projetado num plano paralelo ao cartão, `depthMm` mais longe da câmera. */
export const projectToPlane = (cam: Camera, plane: CardPlane, p: Pt, depthMm = 0): V3 => {
  const r = camRay(cam, p);
  return scale(r, (plane.c + depthMm) / dot(plane.n, r));
};

export type FingerWidth3D = {
  trueMm: number; // largura física estimada da borda do dedo
  cardPlaneMm: number; // mesma medida considerando a borda no plano do cartão
  formulaMm: number; // equivalente à curva atual (enquadramento de referência)
  depthMm: number;
  distanceMm: number;
  referenceDistanceMm: number;
  heightFactor: number;
};

export const fingerWidth3D = (
  cam: Camera,
  plane: CardPlane,
  left: EdgeLine,
  right: EdgeLine,
  ringY: number,
  imageWidthPx: number,
): FingerWidth3D | null => {
  const dy = Math.max(20, plane.cardPx * 0.05);
  const widthAt = (depth: number) => {
    const pL = { x: left.a + left.b * ringY, y: ringY };
    const pL2 = { x: left.a + left.b * (ringY + dy), y: ringY + dy };
    const pR = { x: right.a + right.b * ringY, y: ringY };
    const pR2 = { x: right.a + right.b * (ringY + dy), y: ringY + dy };
    const XL = projectToPlane(cam, plane, pL, depth), XL2 = projectToPlane(cam, plane, pL2, depth);
    const XR = projectToPlane(cam, plane, pR, depth), XR2 = projectToPlane(cam, plane, pR2, depth);
    const u = unit([...sub(XL2, XL)].map((v, i) => v + sub(XR2, XR)[i]) as V3);
    const d = sub(XR, XL);
    const along = dot(d, u);
    return norm(sub(d, scale(u, along)));
  };
  const cardPlaneMm = widthAt(0);
  if (!Number.isFinite(cardPlaneMm) || cardPlaneMm <= 0) return null;
  let w = cardPlaneMm;
  for (let i = 0; i < 6; i++) w = widthAt(FINGER_DEPTH_RATIO * w);
  const depthMm = FINGER_DEPTH_RATIO * w;
  const referenceDistanceMm = (cam.f * CARD_W_MM) / (REFERENCE_CARD_FRACTION * imageWidthPx);
  const formulaMm = (w * referenceDistanceMm) / (referenceDistanceMm + depthMm);
  return {
    trueMm: w,
    cardPlaneMm,
    formulaMm,
    depthMm,
    distanceMm: plane.c,
    referenceDistanceMm,
    heightFactor: w / cardPlaneMm,
  };
};

// ---------------------------------------------------------------------------
// EXIF: distância focal equivalente 35 mm
// ---------------------------------------------------------------------------
export const readExifFocal = async (file: Blob): Promise<{ f35: number | null; fMm: number | null }> => {
  const none = { f35: null, fMm: null };
  try {
    const buf = await file.slice(0, 262144).arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xffd8) return none;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      const size = dv.getUint16(off + 2);
      if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10;
        const le = dv.getUint16(tiff) === 0x4949;
        const u16 = (o: number) => dv.getUint16(o, le);
        const u32 = (o: number) => dv.getUint32(o, le);
        const findTag = (ifd: number, tag: number) => {
          const count = u16(ifd);
          for (let i = 0; i < count; i++) {
            const e = ifd + 2 + i * 12;
            if (e + 12 > dv.byteLength) return null;
            if (u16(e) === tag) return e;
          }
          return null;
        };
        const ifd0 = tiff + u32(tiff + 4);
        const exifPtr = findTag(ifd0, 0x8769);
        if (exifPtr === null) return none;
        const exif = tiff + u32(exifPtr + 8);
        const e35 = findTag(exif, 0xa405);
        const eF = findTag(exif, 0x920a);
        const f35 = e35 !== null ? u16(e35 + 8) : null;
        let fMm: number | null = null;
        if (eF !== null) {
          const vo = tiff + u32(eF + 8);
          const den = u32(vo + 4);
          fMm = den ? u32(vo) / den : null;
        }
        return { f35: f35 && f35 > 5 && f35 < 400 ? f35 : null, fMm };
      }
      off += 2 + size;
    }
  } catch {
    /* sem EXIF */
  }
  return none;
};

/** Distância focal em pixels da foto recortada/reduzida. */
export const focalPx = (f35: number | null, originalW: number, originalH: number, downscale: number) =>
  ((f35 ?? DEFAULT_FOCAL_35MM) / 43.27) * Math.hypot(originalW, originalH) * downscale;

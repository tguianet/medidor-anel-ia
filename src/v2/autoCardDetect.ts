// Detecção automática do cartão (quadrilátero inclinado) — VERSÃO DE TESTE.
// Só SUGERE onde as linhas do cartão começam; a medição continua usando as
// linhas que o usuário confirma (mesma fórmula da versão travada).
/* eslint-disable */
import type { Line } from "../perspective";

type Img = { w: number; h: number; data: Uint8ClampedArray };
type P2 = [number, number];
type HLine = { t: number; r: number; v: number };
type FLine = { p: P2; d: P2; n: P2 };
type Grad = { gx: Float32Array; gy: Float32Array; mag: Float32Array };

const D2R = Math.PI / 180;
function downscale(img: Img, maxSide: number): { img: Img; f: number } {
  const f = Math.max(img.w, img.h) / maxSide;
  if (f <= 1) return { img, f: 1 };
  const W = Math.round(img.w / f), H = Math.round(img.h / f), fx = img.w / W, fy = img.h / H;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((y + 1) * fy)));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(img.w, Math.floor((x + 1) * fx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const k = (yy * img.w + xx) * 4; r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2]; n++;
      }
      const o = (y * W + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { img: { w: W, h: H, data: out }, f: fx };
}
function gray(img: Img): Float32Array {
  const n = img.w * img.h, g = new Float32Array(n), d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return g;
}
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function sobel(g: Float32Array, w: number, h: number): Grad {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1], d = g[i - 1], f = g[i + 1], gg = g[i + w - 1], hh = g[i + w], ii = g[i + w + 1];
    const X = (c + 2 * f + ii) - (a + 2 * d + gg), Y = (gg + 2 * hh + ii) - (a + 2 * b + c);
    gx[i] = X; gy[i] = Y; mag[i] = Math.hypot(X, Y);
  }
  return { gx, gy, mag };
}
function percentile(arr: Float32Array, p: number): number {
  const s: number[] = []; for (let i = 0; i < arr.length; i += 3) if (arr[i] > 0) s.push(arr[i]);
  if (!s.length) return 0;
  s.sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
const angDiff = (a: number, b: number) => { let d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
function intersect(l1: HLine, l2: HLine): P2 | null {
  const a = Math.cos(l1.t * D2R), b = Math.sin(l1.t * D2R), c = Math.cos(l2.t * D2R), d = Math.sin(l2.t * D2R);
  const det = a * d - b * c; if (Math.abs(det) < 1e-6) return null;
  return [(l1.r * d - b * l2.r) / det, (a * l2.r - c * l1.r) / det];
}
function lineSep(l1: HLine, l2: HLine): number { // distância entre linhas quase paralelas
  const r2 = Math.abs(l1.t - l2.t) > 90 ? -l2.r : l2.r;
  return Math.abs(l1.r - r2);
}
function hough(G: Grad, w: number, h: number, thr: number): HLine[] {
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1, acc = new Float32Array(NT * NR);
  const cs = new Float32Array(NT), sn = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cs[t] = Math.cos(t * D2R); sn[t] = Math.sin(t * D2R); }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x; if (G.mag[i] < thr) continue;
    let a = Math.atan2(G.gy[i], G.gx[i]) / D2R; if (a < 0) a += 180;
    const ac = Math.round(a);
    for (let dt = -3; dt <= 3; dt++) {
      const t = ((ac + dt) % 180 + 180) % 180;
      acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + diag] += 1;
    }
  }
  const minV = Math.max(25, Math.min(w, h) * 0.06), cand: HLine[] = [];
  for (let t = 0; t < NT; t++) for (let r = 1; r < NR - 1; r++) {
    const v = acc[t * NR + r]; if (v < minV) continue;
    let ok = true;
    for (let dt = -3; dt <= 3 && ok; dt++) {
      const tt = ((t + dt) % 180 + 180) % 180;
      for (let dr = -5; dr <= 5; dr++) {
        if (!dt && !dr) continue;
        const rr = r + dr; if (rr < 0 || rr >= NR) continue;
        const u = acc[tt * NR + rr];
        if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) { ok = false; break; }
      }
    }
    if (ok) cand.push({ t, r: r - diag, v });
  }
  cand.sort((a, b) => b.v - a.v);
  const lines: HLine[] = [];
  for (const c of cand) {
    if (lines.some(l => angDiff(l.t, c.t) < 4 && lineSep(l, c) < 8)) continue;
    lines.push(c); if (lines.length >= 28) break;
  }
  return lines;
}
function support(G: Grad, w: number, h: number, p: P2, q: P2, thr: number): { s: number; gap: number } {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); if (L < 10) return { s: 0, gap: 1 };
  const nx = -dy / L, ny = dx / L; let hit = 0, run = 0, gap = 0; const K = 40;
  for (let k = 0; k < K; k++) {
    const t = 0.07 + 0.86 * k / (K - 1), x0 = p[0] + dx * t, y0 = p[1] + dy * t;
    let ok = false;
    for (let s = -1.5; s <= 1.5 && !ok; s += 0.75) {
      const x = Math.round(x0 + nx * s), y = Math.round(y0 + ny * s);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i = y * w + x, m = G.mag[i];
      if (m > thr * 0.6 && Math.abs(G.gx[i] * nx + G.gy[i] * ny) / m > 0.85) ok = true;
    }
    if (ok) { hit++; run = 0; } else { run++; gap = Math.max(gap, run); }
  }
  return { s: hit / K, gap: gap / K };
}
const d2 = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function quadArea(c: P2[]): number { let s = 0; for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
function convex(c: P2[]): boolean {
  let sg = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], e = c[(i + 2) % 4];
    const z = (b[0] - a[0]) * (e[1] - b[1]) - (b[1] - a[1]) * (e[0] - b[0]);
    const s = Math.sign(z); if (!s) return false; if (!sg) sg = s; else if (s !== sg) return false;
  }
  return true;
}
// ---- refino em resolução cheia ----
function grayAt(img: Img, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= img.w - 1 || y0 >= img.h - 1) return NaN;
  const fx = x - x0, fy = y - y0, d = img.data, w = img.w;
  const g = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  return (g(i00) * (1 - fx) + g(i10) * fx) * (1 - fy) + (g(i01) * (1 - fx) + g(i11) * fx) * fy;
}
function fitLine(P: P2[]): FLine { // mínimos quadrados total
  const n = P.length; let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
  return { p: [mx, my], d: [dx, dy], n: [-dy, dx] };
}
function lineX(a: FLine, b: FLine): P2 | null {
  const det = a.d[0] * (-b.d[1]) - a.d[1] * (-b.d[0]); if (Math.abs(det) < 1e-9) return null;
  const rx = b.p[0] - a.p[0], ry = b.p[1] - a.p[1];
  const t = (rx * (-b.d[1]) - ry * (-b.d[0])) / det;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}
function refineSide(img: Img, p: P2, q: P2, R: number): FLine | null {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, pts: P2[] = [];
  for (let k = 0; k < 40; k++) {
    const t = 0.1 + 0.8 * k / 39, x0 = p[0] + dx * t, y0 = p[1] + dy * t;
    let best = 0, bs = 0; const vals: number[] = [];
    for (let s = -R; s <= R; s += 0.5) {
      const a = grayAt(img, x0 + nx * (s + 0.75), y0 + ny * (s + 0.75)), b = grayAt(img, x0 + nx * (s - 0.75), y0 + ny * (s - 0.75));
      const v = isNaN(a) || isNaN(b) ? 0 : Math.abs(a - b); vals.push(v);
      if (v > best) { best = v; bs = s; }
    }
    if (best < 6) continue;
    const i = Math.round((bs + R) / 0.5);
    let off = 0;
    if (i > 0 && i < vals.length - 1) { const den = vals[i - 1] - 2 * vals[i] + vals[i + 1]; if (den < 0) off = 0.5 * 0.5 * (vals[i - 1] - vals[i + 1]) / den; }
    pts.push([x0 + nx * (bs + off), y0 + ny * (bs + off)]);
  }
  if (pts.length < 10) return null;
  let ln = fitLine(pts);
  const res = (p2: P2) => Math.abs((p2[0] - ln.p[0]) * ln.n[0] + (p2[1] - ln.p[1]) * ln.n[1]);
  const keep = pts.filter(p2 => res(p2) < 1.5);
  if (keep.length >= 8) ln = fitLine(keep);
  return ln;
}
function refineQuad(full: Img, c: P2[], f: number): P2[] {
  const R = Math.max(3, 2.5 * f), lines: (FLine | null)[] = [];
  for (let i = 0; i < 4; i++) lines.push(refineSide(full, c[i], c[(i + 1) % 4], R));
  if (lines.some(l => !l)) return c;
  const out: P2[] = [];
  for (let i = 0; i < 4; i++) { const x = lineX(lines[(i + 3) % 4] as FLine, lines[i] as FLine); if (!x) return c; out.push(x); }
  for (let i = 0; i < 4; i++) if (d2(out[i], c[i]) > 4 * R) return c;
  return out;
}
export function detectCardQuad(full: Img): { corners: P2[]; score: number } | null {
  const { img, f } = downscale(full, 640), w = img.w, h = img.h;
  const g = blur(blur(gray(img), w, h, 1), w, h, 1);
  const G = sobel(g, w, h);
  const thr = Math.max(18, percentile(G.mag, 0.88));
  const lines = hough(G, w, h, thr);
  const pairs: [HLine, HLine][] = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    if (angDiff(lines[i].t, lines[j].t) < 16 && lineSep(lines[i], lines[j]) > 15) pairs.push([lines[i], lines[j]]);
  }
  const meanT = (p: [HLine, HLine]) => { let a = p[0].t, b = p[1].t; if (Math.abs(a - b) > 90) b += a > b ? 180 : -180; return ((a + b) / 2 + 180) % 180; };
  let best: { score: number; c: P2[]; mn: number } | null = null;
  const imgA = w * h;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const A = pairs[i], B = pairs[j];
    if (angDiff(meanT(A), meanT(B)) < 45) continue;
    const c0 = [intersect(A[0], B[0]), intersect(A[0], B[1]), intersect(A[1], B[1]), intersect(A[1], B[0])];
    if (c0.some(p => !p)) continue;
    const c = c0 as P2[];
    if (c.some(p => p[0] < -0.02 * w || p[1] < -0.02 * h || p[0] > 1.02 * w || p[1] > 1.02 * h)) continue;
    if (!convex(c)) continue;
    const af = quadArea(c) / imgA; if (af < 0.015 || af > 0.85) continue;
    const s0 = d2(c[0], c[1]), s1 = d2(c[1], c[2]), s2 = d2(c[2], c[3]), s3 = d2(c[3], c[0]);
    if (Math.max(s0, s2) / Math.min(s0, s2) > 1.6 || Math.max(s1, s3) / Math.min(s1, s3) > 1.6) continue;
    const la = (s0 + s2) / 2, lb = (s1 + s3) / 2, ratio = Math.max(la, lb) / Math.min(la, lb);
    if (ratio < 1.25 || ratio > 2.0) continue;
    const sp = [0, 1, 2, 3].map(k => support(G, w, h, c[k], c[(k + 1) % 4], thr)), sup = sp.map(x => x.s);
    const mn = Math.min(...sup); if (mn < 0.45) continue;
    const avg = sup.reduce((a, b) => a + b, 0) / 4, gap = Math.max(...sp.map(x => x.gap));
    const score = mn + 0.5 * avg - 1.5 * gap - 1.5 * Math.abs(ratio - 1.586) / 1.586 + 0.1 * Math.sqrt(af);
    if (!best || score > best.score) best = { score, c, mn };
  }
  if (!best) return null;
  const coarse = best.c.map(p => [p[0] * f, p[1] * f] as P2);
  return { corners: refineQuad(full, coarse, f), score: best.score };
}


const mean = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function extend(a: P2, b: P2, k: number): [P2, P2] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return [[a[0] - dx * k, a[1] - dy * k], [b[0] + dx * k, b[1] + dy * k]];
}

/**
 * Procura o cartão na foto e devolve as 4 linhas (em % da imagem) no formato
 * do editor: top/bottom = lados longos, left/right = laterais curtas.
 * Retorna null se não achar ou se o cartão não estiver deitado (horizontal).
 */
export function detectCardLines(pixels: { data: Uint8ClampedArray; width: number; height: number }):
  { lines: Record<"top" | "right" | "bottom" | "left", Line>; score: number } | null {
  const img: Img = { w: pixels.width, h: pixels.height, data: pixels.data };
  const r = detectCardQuad(img);
  if (!r) return null;
  const c = r.corners;
  const sides = [0, 1, 2, 3].map(i => ({ a: c[i], b: c[(i + 1) % 4], len: d2(c[i], c[(i + 1) % 4]), mid: mean(c[i], c[(i + 1) % 4]) }));
  const long01 = sides[0].len + sides[2].len >= sides[1].len + sides[3].len;
  const longs = long01 ? [sides[0], sides[2]] : [sides[1], sides[3]];
  const shorts = long01 ? [sides[1], sides[3]] : [sides[0], sides[2]];
  for (const s of longs) {
    const ang = Math.abs(Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) / D2R) % 180;
    if (Math.min(ang, 180 - ang) > 35) return null; // cartão em pé: deixa o fluxo antigo
  }
  const [bottom, top] = longs[0].mid[1] > longs[1].mid[1] ? [longs[0], longs[1]] : [longs[1], longs[0]];
  const [left, right] = shorts[0].mid[0] < shorts[1].mid[0] ? [shorts[0], shorts[1]] : [shorts[1], shorts[0]];
  const pct = (p: P2) => ({ x: Math.max(1, Math.min(99, p[0] / img.w * 100)), y: Math.max(1, Math.min(99, p[1] / img.h * 100)) });
  const toLine = (s: { a: P2; b: P2 }, horizontal: boolean): Line => {
    // estende um pouco além dos cantos, sem sair da foto (não corta a linha: mantém a inclinação)
    const inside = (p: P2) => p[0] >= img.w * 0.01 && p[0] <= img.w * 0.99 && p[1] >= img.h * 0.01 && p[1] <= img.h * 0.99;
    let k = 0.12, a: P2 = s.a, b: P2 = s.b;
    while (k > 0) { const e = extend(s.a, s.b, k); if (inside(e[0]) && inside(e[1])) { [a, b] = e; break; } k -= 0.02; }
    if (horizontal ? a[0] > b[0] : a[1] > b[1]) [a, b] = [b, a];
    return { a: pct(a), b: pct(b) };
  };
  return {
    lines: { top: toLine(top, true), bottom: toLine(bottom, true), left: toLine(left, false), right: toLine(right, false) },
    score: r.score,
  };
}

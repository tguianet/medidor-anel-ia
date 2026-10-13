// Orientação automática da foto (portado da v23, sem outras mudanças).
// Com o celular apontado para baixo (mesa), o sensor de gravidade não sabe
// qual lado é "em pé" e a câmera pode salvar a foto girada. Na montagem certa
// o cartão fica DEITADO (lado comprido na horizontal) e os dedos saem por
// baixo dele. As bordas compridas do cartão são as retas fortes mais longas
// da foto: pela direção delas sabemos se a foto está deitada, e pela posição
// do cartão (o lado com mais espaço é o lado dos dedos) para onde girar.
export type Rotation = 0 | 90 | 180 | 270;

type Run = { len: number; pos: number };

const longestRuns = (mask: Uint8Array, w: number, h: number, horizontal: boolean) => {
  const along = horizontal ? w : h;
  const across = horizontal ? h : w;
  const runs: Run[] = [];
  for (const deg of [-8, -6, -4, -2, 0, 2, 4, 6, 8]) {
    const t = Math.tan((deg * Math.PI) / 180);
    for (let p0 = -Math.ceil(Math.abs(t) * along); p0 < across + Math.abs(t) * along; p0++) {
      let best = 0, bestMid = 0, cur = 0, gap = 0, start = 0;
      for (let a = 0; a < along; a++) {
        const p = Math.round(p0 + a * t);
        let hit = false;
        if (p >= 0 && p < across) {
          for (const dp of [-1, 0, 1]) {
            const q = p + dp;
            if (q < 0 || q >= across) continue;
            const idx = horizontal ? q * w + a : a * w + q;
            if (mask[idx]) { hit = true; break; }
          }
        }
        if (hit) {
          if (cur === 0) start = a;
          cur = a - start + 1;
          gap = 0;
          if (cur > best) { best = cur; bestMid = p0 + (start + a) / 2 * t; }
        } else if (cur > 0 && ++gap > 4) {
          cur = 0; gap = 0;
        }
      }
      if (best > 0) runs.push({ len: best, pos: bestMid });
    }
  }
  runs.sort((u, v) => v.len - u.len);
  return runs;
};

/**
 * channels: um ou mais canais (ex.: R, G, B) do mesmo tamanho. A borda é a
 * mais forte entre os canais — um cartão laranja sobre a pele quase some no
 * cinza, mas é fortíssimo no azul.
 */
export const estimateOrientation = (channels: Float32Array[], w: number, h: number) => {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (const gray of channels) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const a = gray[i - w - 1], b = gray[i - w], c = gray[i - w + 1];
        const d = gray[i - 1], f = gray[i + 1];
        const g = gray[i + w - 1], hh = gray[i + w], k = gray[i + w + 1];
        const sx = (c + 2 * f + k) - (a + 2 * d + g);
        const sy = (g + 2 * hh + k) - (a + 2 * b + c);
        const m = Math.hypot(sx, sy);
        if (m > mag[i]) { gx[i] = sx; gy[i] = sy; mag[i] = m; }
      }
    }
  }
  const sorted = Array.from(mag).sort((u, v) => u - v);
  const T = Math.max(60, sorted[Math.floor(sorted.length * 0.85)]);
  const mH = new Uint8Array(w * h), mV = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mag[i] < T) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    if (ay > 1.5 * ax) mH[i] = 1; else if (ax > 1.5 * ay) mV[i] = 1;
  }
  const rh = longestRuns(mH, w, h, true);
  const rv = longestRuns(mV, w, h, false);
  const lenH = rh[0]?.len ?? 0, lenV = rv[0]?.len ?? 0;
  const horizontalCard = lenH >= lenV;
  const runs = horizontalCard ? rh : rv;
  const across = horizontalCard ? h : w;
  const axisRatio = (Math.max(lenH, lenV) + 1) / (Math.min(lenH, lenV) + 1);
  // as duas bordas compridas do cartão: as duas maiores retas paralelas,
  // separadas por pelo menos 15% da foto
  const first = runs[0];
  const second = runs.find((r) => first && Math.abs(r.pos - first.pos) > across * 0.15 && r.len > first.len * 0.6);
  const center = first && second ? (first.pos + second.pos) / 2 : first?.pos ?? across / 2;
  const offset = (center - across / 2) / across; // <0: cartão no começo (cima/esquerda)
  let rotation: Rotation;
  if (horizontalCard) rotation = offset <= 0 ? 0 : 180;
  else rotation = offset <= 0 ? 90 : 270; // cartão à esquerda → dedos à direita → girar 90° horário
  return { rotation, axisRatio, offset, pair: !!second, lenH, lenV };
};

/** Decide se vale girar: só gira com evidência clara (sempre há o botão manual). */
export const chooseRotation = (est: ReturnType<typeof estimateOrientation>): Rotation => {
  if (est.rotation === 0) return 0;
  if (est.rotation === 180) return est.pair && Math.abs(est.offset) >= 0.08 ? 180 : 0;
  return est.axisRatio >= 1.15 && est.pair && Math.abs(est.offset) >= 0.06 ? est.rotation : 0;
};

// medidordedov17: foto completa da camera (sensor inteiro) em vez de um
// quadro do video. Usa ImageCapture.takePhoto() quando o navegador permite
// (Chrome/Android) ou uma foto vinda da camera nativa (<input capture>).
//
// A foto pode vir girada e com campo de visao MAIOR que o video (o video e um
// recorte do sensor). Por isso alinhamos a foto ao quadro do toque: testamos
// 0/90/180/270 graus e varias escalas de recorte central, comparando com o
// quadro do toque em miniatura. Se nenhuma combinacao bater (pessoa mexeu),
// a foto e descartada e fica o quadro do toque.

export type AlignedPhoto = {
  source: HTMLCanvasElement; // foto ja girada, em pe
  crop: { sx: number; sy: number; sw: number; sh: number }; // regiao 3:4 equivalente ao quadro
  score: number; // diferenca media (0-255) com o quadro do toque
};

type ImageCaptureLike = { takePhoto: (s?: unknown) => Promise<Blob> };

export const canTakeFullPhoto = (stream: MediaStream | null) => {
  const track = stream?.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  return !!(track && IC && track.readyState === "live");
};

export const takeFullPhoto = async (stream: MediaStream, timeoutMs: number): Promise<Blob | null> => {
  const track = stream.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (!track || !IC) return null;
  try {
    const ic = new IC(track);
    return await Promise.race([
      ic.takePhoto(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
};

export const decodePhoto = async (blob: Blob): Promise<HTMLCanvasElement | null> => {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close?.();
    return c;
  } catch {
    return null;
  }
};

const rotate = (src: HTMLCanvasElement, deg: 0 | 90 | 180 | 270) => {
  if (deg === 0) return src;
  const c = document.createElement("canvas");
  const swap = deg === 90 || deg === 270;
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
};

const TW = 60, TH = 80;
const thumbGray = (src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) => {
  const c = document.createElement("canvas");
  c.width = TW; c.height = TH;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, TW, TH);
  const d = ctx.getImageData(0, 0, TW, TH).data;
  const g = new Float32Array(TW * TH);
  let m = 0;
  for (let i = 0; i < TW * TH; i++) { g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; m += g[i]; }
  m /= TW * TH;
  for (let i = 0; i < g.length; i++) g[i] -= m; // remove diferenca de exposicao
  return g;
};

const centerCrop34 = (w: number, h: number, scale: number) => {
  let sw = w, sh = h;
  if (w / h > 3 / 4) sw = h * 0.75; else sh = w / 0.75;
  sw *= scale; sh *= scale;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
};

export const alignPhotoToFrame = (photo: HTMLCanvasElement, tapFrame: HTMLCanvasElement, maxScore = 18): AlignedPhoto | null => {
  const ref = thumbGray(tapFrame, 0, 0, tapFrame.width, tapFrame.height);
  let best: AlignedPhoto | null = null;
  for (const deg of [0, 90, 270, 180] as const) {
    const r = rotate(photo, deg);
    if (r.width > r.height) continue; // o quadro do app e sempre em pe
    for (let s = 1.0; s >= 0.55; s -= 0.0125) {
      const crop = centerCrop34(r.width, r.height, s);
      const g = thumbGray(r, crop.sx, crop.sy, crop.sw, crop.sh);
      let sad = 0;
      for (let i = 0; i < g.length; i++) sad += Math.abs(g[i] - ref[i]);
      const score = sad / g.length;
      if (!best || score < best.score) best = { source: r, crop, score };
    }
  }
  return best && best.score <= maxScore ? best : null;
};

/** Foto vinda da camera nativa (sem quadro de referencia): recorte central 3:4. */
export const wholePhotoAsFrame = (photo: HTMLCanvasElement): AlignedPhoto => {
  const p = photo.width > photo.height ? rotate(photo, 90) : photo;
  return { source: p, crop: centerCrop34(p.width, p.height, 1), score: 0 };
};

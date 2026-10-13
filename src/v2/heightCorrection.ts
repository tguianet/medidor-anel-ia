// Correção da altura: o cartão fica em cima do dedo, mas a borda do dedo
// (onde a lupa marca) fica ~metade da largura do dedo mais longe da câmera.
// Ela aparece menor que a escala do cartão, e quanto menor depende da altura
// do celular. A distância vem da largura do cartão em pixels e da lente do
// celular (gravada na foto). O fator é RELATIVO ao enquadramento de
// referência (cartão em 90% da largura da foto), para não descalibrar a
// curva atual: nesse enquadramento o fator é 1.

export const DEFAULT_FOCAL_35MM = 26;
export const REFERENCE_CARD_FRACTION = 0.9;

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

export type HeightCorrection = {
  distanceMm: number;
  referenceDistanceMm: number;
  depthMm: number;
  factor: number;
};

/**
 * focal900: distância focal em px na foto 900×1200.
 * cardPx: largura do cartão (A-B) em px nessa foto.
 * fingerMm: largura do dedo medida pela escala do cartão.
 */
export const heightCorrection = (focal900: number, cardPx: number, fingerMm: number, photoWidthPx = 900): HeightCorrection | null => {
  if (!(focal900 > 0) || !(cardPx > 0) || !(fingerMm > 0)) return null;
  const distanceMm = (focal900 * 85.6) / cardPx;
  const referenceDistanceMm = (focal900 * 85.6) / (REFERENCE_CARD_FRACTION * photoWidthPx);
  const depthMm = fingerMm / 2;
  const factor = ((distanceMm + depthMm) / distanceMm) / ((referenceDistanceMm + depthMm) / referenceDistanceMm);
  if (!Number.isFinite(factor) || factor < 0.9 || factor > 1.1) return null;
  return { distanceMm, referenceDistanceMm, depthMm, factor };
};

// ---------------------------------------------------------------------------
// Dedo fora do centro da foto
// ---------------------------------------------------------------------------
// O cartão é plano: em qualquer lugar da foto ele aparece na mesma escala.
// O dedo é redondo: fora do centro a câmera enxerga um pouco da lateral dele
// e a silhueta fica mais larga, na proporção 1/cos(ângulo). Ex.: celular a
// 10 cm e dedo 3 cm fora do centro → ~16° → dedo ~4% mais largo (~0,7 mm).
// Corrigimos pelo ângulo lateral entre o centro do dedo e o centro da foto.
export type OffCenterCorrection = { angleDeg: number; offsetMm: number; factor: number };

export const offCenterCorrection = (
  focal900: number,
  fingerCenterXpx: number,
  photoWidthPx: number,
  pxPerMm: number,
): OffCenterCorrection | null => {
  if (!(focal900 > 0) || !(pxPerMm > 0)) return null;
  const dx = fingerCenterXpx - photoWidthPx / 2;
  const angle = Math.atan(dx / focal900);
  const factor = Math.cos(angle);
  if (!Number.isFinite(factor) || factor < 0.85) return null;
  return { angleDeg: (angle * 180) / Math.PI, offsetMm: dx / pxPerMm, factor };
};

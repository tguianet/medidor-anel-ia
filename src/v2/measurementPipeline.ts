import { scaleFromLockedCardSides, type Line } from "./cardCalibration";

export type CalibratedWidth = {
  widthPx: number;
  widthMm: number;
  mmPerPx: number;
  cardReferenceLengthPx: number;
};

// Medicao V2 propositalmente burra:
// ela nao conhece aro, tabela, conforto ou correcoes historicas.
// Recebe somente a geometria do cartao e uma largura do dedo em pixels.
export const convertFingerPixelsToMillimeters = (
  leftCardSide: Line,
  rightCardSide: Line,
  fingerWidthPx: number,
): CalibratedWidth => {
  if(!Number.isFinite(fingerWidthPx) || fingerWidthPx<=0){
    throw new Error("invalid-finger-width");
  }

  const scale=scaleFromLockedCardSides(leftCardSide,rightCardSide);
  return {
    widthPx:fingerWidthPx,
    widthMm:fingerWidthPx*scale.mmPerPx,
    mmPerPx:scale.mmPerPx,
    cardReferenceLengthPx:scale.referenceLengthPx,
  };
};

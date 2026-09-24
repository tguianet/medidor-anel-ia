import { INITIAL_REFERENCE_RING, PHYSICAL_RING_TABLE } from "./physicalRingTable";

export type FingerRingReference = {
  ringSize: number;
  targetWidthMm: number;
  lowerBoundaryMm: number;
  upperBoundaryMm: number;
};

export type RingClassification = {
  measuredWidthMm: number;
  exactRingSize: number;
  comfortRingSize: number;
  targetWidthMm: number;
  distanceFromTargetMm: number;
  lowerBoundaryMm: number;
  upperBoundaryMm: number;
};

// Curva-base desenhada no laboratorio interno em 23/09/2026.
// Em 24/09/2026 o metodo de medicao passou a usar calibracao de 4 pontos.
// Para manter o desenho relativo da curva antiga, toda a curva foi
// transladada -0,440 mm e ancorada no novo aro 29 = 22,480 mm.
// Nenhuma distancia relativa entre os aros foi alterada.
export const MANUAL_FINGER_CURVE: Record<number, number> = {
  // Curva nova = mesma geometria relativa da curva antiga,
  // deslocada -0,440 mm para ancorar o novo metodo em aro 29 = 22,480 mm.
  // Assim preservamos exatamente o desenho/diferencas entre aros que ja
  // estavam funcionando, sem inventar uma nova progressao.
  17: 18.650,
  18: 18.936,
  19: 19.194,
  20: 19.439,
  21: 19.740,
  22: 20.250,
  23: 20.719,
  24: 21.237,
  25: 21.780,
  26: 22.013,
  27: 22.171,
  28: 22.329,
  29: 22.480,
  30: 23.005,
  31: 23.595,
  32: 24.156,
  33: 24.840,
};

// Mantemos compatibilidade abaixo do aro 17 extrapolando para tras apenas
// com os crescimentos fisicos medidos no paquimetro. A faixa 17-33 usa
// exclusivamente a curva manual acima.
const bySize = new Map(PHYSICAL_RING_TABLE.map((ring) => [ring.size, ring]));

const physicalGrowthBetween = (lowerRingSize: number, upperRingSize: number) => {
  const lower = bySize.get(lowerRingSize);
  const upper = bySize.get(upperRingSize);
  if (!lower || !upper || upperRingSize - lowerRingSize !== 1) {
    throw new Error("physical-ring-step-not-found");
  }
  return upper.meanDiameterMm - lower.meanDiameterMm;
};

export const INITIAL_REFERENCE_FINGER_WIDTH_MM = MANUAL_FINGER_CURVE[INITIAL_REFERENCE_RING];

export const buildFingerReferenceCurve = (): FingerRingReference[] => {
  const sizes = PHYSICAL_RING_TABLE.map((ring) => ring.size).sort((a, b) => a - b);
  const targets = new Map<number, number>();

  for (const [sizeText, mm] of Object.entries(MANUAL_FINGER_CURVE)) {
    targets.set(Number(sizeText), mm);
  }

  // Extrapolacao somente para 11-16 para nao quebrar a compatibilidade
  // existente da V2. A curva experimental em teste comeca no aro 17.
  for (let size = 16; size >= sizes[0]; size--) {
    const next = targets.get(size + 1);
    if (next === undefined) throw new Error("missing-next-target");
    targets.set(size, next - physicalGrowthBetween(size, size + 1));
  }

  return sizes.map((size, index) => {
    const targetWidthMm = targets.get(size);
    if (targetWidthMm === undefined) throw new Error("missing-finger-target");

    const previousSize = sizes[index - 1];
    const nextSize = sizes[index + 1];
    const previousTarget = previousSize === undefined ? null : targets.get(previousSize)!;
    const nextTarget = nextSize === undefined ? null : targets.get(nextSize)!;

    return {
      ringSize: size,
      targetWidthMm: Number(targetWidthMm.toFixed(3)),
      lowerBoundaryMm:
        previousTarget === null
          ? Number.NEGATIVE_INFINITY
          : Number(((previousTarget + targetWidthMm) / 2).toFixed(3)),
      upperBoundaryMm:
        nextTarget === null
          ? Number.POSITIVE_INFINITY
          : Number(((targetWidthMm + nextTarget) / 2).toFixed(3)),
    };
  });
};

export const FINGER_REFERENCE_CURVE = buildFingerReferenceCurve();

export const classifyFingerWidthMm = (
  measuredWidthMm: number,
  comfortOffset = 1,
): RingClassification => {
  if (!Number.isFinite(measuredWidthMm) || measuredWidthMm <= 0) {
    throw new Error("invalid-finger-width-mm");
  }

  const match =
    FINGER_REFERENCE_CURVE.find(
      (entry) =>
        measuredWidthMm >= entry.lowerBoundaryMm &&
        measuredWidthMm < entry.upperBoundaryMm,
    ) ?? FINGER_REFERENCE_CURVE[FINGER_REFERENCE_CURVE.length - 1];

  const minSize = FINGER_REFERENCE_CURVE[0].ringSize;
  const maxSize = FINGER_REFERENCE_CURVE[FINGER_REFERENCE_CURVE.length - 1].ringSize;
  const comfortRingSize = Math.max(
    minSize,
    Math.min(maxSize, match.ringSize + comfortOffset),
  );

  return {
    measuredWidthMm,
    exactRingSize: match.ringSize,
    comfortRingSize,
    targetWidthMm: match.targetWidthMm,
    distanceFromTargetMm: Number((measuredWidthMm - match.targetWidthMm).toFixed(3)),
    lowerBoundaryMm: match.lowerBoundaryMm,
    upperBoundaryMm: match.upperBoundaryMm,
  };
};

export type PhysicalRing = {
  size: number;
  axisAmm: number;
  axisBmm: number;
  minDiameterMm: number;
  maxDiameterMm: number;
  meanDiameterMm: number;
  growthFromPreviousMm: number | null;
};

// Medicoes fisicas feitas no paquimetro.
// Esta e a fonte da verdade do Medidor de Anel 2.0.
// Mantemos os dois eixos porque alguns aneis sao ovais.
const raw = [
  [11,15.4,15.4],
  [12,15.9,15.7],
  [13,16.2,16.1],
  [14,16.5,16.4],
  [15,16.7,16.8],
  [16,17.2,17.1],
  [17,17.5,17.4],
  [18,17.7,17.8],
  [19,18.2,18.2],
  [20,18.4,18.5],
  [21,18.7,18.9],
  [22,19.2,19.4],
  [23,19.4,19.7],
  [24,19.9,19.7],
  [25,20.3,20.1],
  [26,20.6,20.7],
  [27,20.8,20.9],
  [28,21.3,21.2],
  [29,21.4,21.7],
  [30,22.0,22.0],
  [31,22.0,22.5],
  [32,22.5,22.6],
  [33,23.2,22.7],
] as const;

export const PHYSICAL_RING_TABLE: PhysicalRing[] = raw.map((row,index) => {
  const [size,axisAmm,axisBmm] = row;
  const meanDiameterMm = (axisAmm + axisBmm) / 2;
  const previous = index > 0 ? raw[index - 1] : null;
  const previousMean = previous ? (previous[1] + previous[2]) / 2 : null;

  return {
    size,
    axisAmm,
    axisBmm,
    minDiameterMm: Math.min(axisAmm,axisBmm),
    maxDiameterMm: Math.max(axisAmm,axisBmm),
    meanDiameterMm,
    growthFromPreviousMm: previousMean === null
      ? null
      : Number((meanDiameterMm - previousMean).toFixed(3)),
  };
});

// Marco experimental inicial da V2.
// O valor do dedo correspondente ao aro 29 sera validado por repeticao;
// nao deve contaminar a tabela fisica dos aneis.
export const INITIAL_REFERENCE_RING = 29;

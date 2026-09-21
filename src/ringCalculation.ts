export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));


export type MeasurementCalibrationPoint = {
  rawMm: number;
  calibratedMm: number;
};

// Curva-base MA -> PQ medida em bancada com anelímetro + paquímetro.
// Entre os pontos usamos interpolação linear para evitar degraus.
// Fora da faixa medida mantemos a correção do ponto extremo até haver
// novos dados de calibração confiáveis.
export const MEASUREMENT_CALIBRATION_POINTS: MeasurementCalibrationPoint[] = [
  { rawMm: 15.5, calibratedMm: 15.4 },
  { rawMm: 16.2, calibratedMm: 16.5 },
  { rawMm: 16.9, calibratedMm: 17.4 },
  { rawMm: 17.7, calibratedMm: 18.2 },
  { rawMm: 18.4, calibratedMm: 19.0 },
  { rawMm: 19.1, calibratedMm: 19.8 },
  { rawMm: 19.6, calibratedMm: 20.6 },
  { rawMm: 20.1, calibratedMm: 21.4 },
  { rawMm: 20.8, calibratedMm: 22.0 },
  { rawMm: 21.7, calibratedMm: 22.7 },
];

export const calibrateMeasuredWidthMm = (rawMm: number) => {
  const points = MEASUREMENT_CALIBRATION_POINTS;
  if (!Number.isFinite(rawMm)) return rawMm;

  if (rawMm <= points[0].rawMm) {
    const correction = points[0].calibratedMm - points[0].rawMm;
    return rawMm + correction;
  }

  const last = points[points.length - 1];
  if (rawMm >= last.rawMm) {
    const correction = last.calibratedMm - last.rawMm;
    return rawMm + correction;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (rawMm < a.rawMm || rawMm > b.rawMm) continue;
    const t = (rawMm - a.rawMm) / (b.rawMm - a.rawMm);
    return a.calibratedMm + t * (b.calibratedMm - a.calibratedMm);
  }

  return rawMm;
};

// Tabela de diâmetro interno informada pelo anelímetro. Ela corresponde à
// numeração brasileira e evita aproximações que deslocariam aros altos.
export const RING_DIAMETER_TABLE = [
  { size: 1, diameterMm: 13.05 }, { size: 2, diameterMm: 13.37 },
  { size: 3, diameterMm: 13.68 }, { size: 4, diameterMm: 14.01 },
  { size: 5, diameterMm: 14.32 }, { size: 6, diameterMm: 14.64 },
  { size: 7, diameterMm: 14.95 }, { size: 8, diameterMm: 15.28 },
  { size: 9, diameterMm: 15.60 }, { size: 10, diameterMm: 15.92 },
  { size: 11, diameterMm: 16.24 }, { size: 12, diameterMm: 16.55 },
  { size: 13, diameterMm: 16.87 }, { size: 14, diameterMm: 17.19 },
  { size: 15, diameterMm: 17.50 }, { size: 16, diameterMm: 17.83 },
  { size: 17, diameterMm: 18.14 }, { size: 18, diameterMm: 18.46 },
  { size: 19, diameterMm: 18.76 }, { size: 20, diameterMm: 19.10 },
  { size: 21, diameterMm: 19.42 }, { size: 22, diameterMm: 19.77 },
  { size: 23, diameterMm: 20.05 }, { size: 24, diameterMm: 20.37 },
  { size: 25, diameterMm: 20.68 }, { size: 26, diameterMm: 21.04 },
  { size: 27, diameterMm: 21.37 }, { size: 28, diameterMm: 21.68 },
  { size: 29, diameterMm: 21.96 }, { size: 30, diameterMm: 22.28 },
  { size: 31, diameterMm: 22.60 }, { size: 32, diameterMm: 22.92 },
  { size: 33, diameterMm: 23.24 }, { size: 34, diameterMm: 23.55 },
  { size: 35, diameterMm: 23.87 }, { size: 36, diameterMm: 24.19 },
  { size: 37, diameterMm: 24.51 }, { size: 38, diameterMm: 24.83 },
  { size: 39, diameterMm: 25.15 }, { size: 40, diameterMm: 25.46 },
];

// Conversão 2D calibrada por medições reais de largura marcada e diâmetro
// interno confirmado do aro. Não usa estimativa de volume/formato do dedo.
export const INNER_DIAMETER_SLOPE = 0.873;
export const INNER_DIAMETER_OFFSET_MM = 1.73;
// Margem fixa de conforto: o aro técnico é elevado em um número para que a
// indicação final não fique apertada no dedo.
export const COMFORT_RING_OFFSET = 1;

// Curva provisória do modo dedo, obtida pela correlação dos pontos reais
// aro 17, 24 e 32. O objetivo desta fase é testar a matemática sem aplicar
// correções manuais por faixa nem regras aprendidas sobre o resultado do dedo.
export const FINGER_RING_SLOPE = 1.807461821;
export const FINGER_RING_INTERCEPT = -15.009085637;

// Zona morta em milímetros da largura do dedo. Próximo da fronteira entre
// dois aros, preferimos o aro maior para evitar oscilação por décimos de mm.
export const FINGER_RING_DEAD_ZONE_MM = 0.15;

export const estimateInnerDiameter = (measuredWidthMm: number) => (
  measuredWidthMm * INNER_DIAMETER_SLOPE + INNER_DIAMETER_OFFSET_MM
);

// Pontos confirmados manualmente em dedo real. Eles representam o ajuste de
// conforto: a aliança precisa ficar firme, sem risco de cair. Não usamos dados
// do anelímetro aqui — ele continua apenas como instrumento de validação.
export const REAL_FIT_REFERENCES = [
  // Dedo real confirmado: duas medições consecutivas em ~17,7 mm deram aro 15
  // pela fórmula, mas o aro correto é 17. Mantemos a correção localizada para
  // não deslocar toda a curva global.
  { minWidthMm: 17.50, maxWidthMm: 17.90, ringSize: 17 },
  { minWidthMm: 21.45, maxWidthMm: 21.75, ringSize: 24 },
  { minWidthMm: 25.80, maxWidthMm: 26.20, ringSize: 32 },
];

// Regra de correção aprendida a partir de testes reais registrados no painel
// de calibração (netlify/functions/calibration.mjs). `offset` é aplicado em
// número de aros sobre a leitura prevista para a mesma faixa de largura.
export type CalibrationRule = {
  key: string;
  minWidthMm: number;
  maxWidthMm: number;
  predictedRing: number;
  offset: number;
};

export type RingResult = {
  rawWidthMm: number;
  widthMm: number;
  measurementCorrectionMm: number;
  equivalentDiameterMm: number;
  fingerEquivalentMabMm: number | null;
  ringSize: number;
  calculationMode: "formula";
  appliedRuleOffset: number | null;
  continuousRing: number | null;
  nearBoundary: boolean;
  boundaryDistanceMm: number | null;
};

const findRingBySize = (size: number) => (
  RING_DIAMETER_TABLE.find((ring) => ring.size === size)
);

export const MAB_REFERENCE_CALIBRATION = 94;

// Limites obtidos pelos pontos médios das medições reais do anelímetro.
// Primeiro normalizamos o MA/MAB para 94% de calibração do cartão e só
// depois classificamos o aro. Isso compensa automaticamente capturas em
// 93%, 95%, 96% etc. sem somar/subtrair aros manualmente.
export const MAB_RING_THRESHOLDS = [
  { maxMm: 12.96, ringSize: 5 },
  { maxMm: 13.35, ringSize: 6 },
  { maxMm: 13.85, ringSize: 7 },
  { maxMm: 14.25, ringSize: 8 },
  { maxMm: 14.71, ringSize: 9 },
  { maxMm: 15.11, ringSize: 10 },
  { maxMm: 15.46, ringSize: 11 },
  { maxMm: 15.87, ringSize: 12 },
  { maxMm: 16.22, ringSize: 13 },
  { maxMm: 16.45, ringSize: 14 },
  { maxMm: 16.67, ringSize: 15 },
  { maxMm: 16.86, ringSize: 16 },
  { maxMm: 17.00, ringSize: 17 },
  { maxMm: 17.25, ringSize: 18 },
  { maxMm: 17.55, ringSize: 19 },
  { maxMm: 17.85, ringSize: 20 },
  { maxMm: 18.15, ringSize: 21 },
  { maxMm: 18.50, ringSize: 22 },
  { maxMm: 18.95, ringSize: 23 },
  { maxMm: 19.35, ringSize: 24 },
  { maxMm: 19.60, ringSize: 25 },
  { maxMm: 19.90, ringSize: 26 },
  { maxMm: 20.20, ringSize: 27 },
  { maxMm: 20.45, ringSize: 28 },
  { maxMm: 20.75, ringSize: 29 },
  { maxMm: 21.05, ringSize: 30 },
  { maxMm: 21.30, ringSize: 31 },
  { maxMm: 21.55, ringSize: 32 },
  { maxMm: 21.85, ringSize: 33 },
  { maxMm: 22.05, ringSize: 34 },
] as const;

export const normalizeMabTo94 = (rawWidthMm: number, calibrationConfidence: number) => {
  if (!Number.isFinite(rawWidthMm)) return rawWidthMm;
  if (!Number.isFinite(calibrationConfidence) || calibrationConfidence <= 0) return rawWidthMm;
  return rawWidthMm * (MAB_REFERENCE_CALIBRATION / calibrationConfidence);
};

export const ringSizeFromNormalizedMab = (normalizedMabMm: number) => {
  const match = MAB_RING_THRESHOLDS.find((threshold) => normalizedMabMm < threshold.maxMm);
  return match?.ringSize ?? 35;
};

// Correlação dedo -> anelímetro baseada nos testes reais confirmados.
// Em vez de uma curva rígida única, usamos uma transformação por trechos.
// Isso permite uma "faixa estável" para o mesmo aro quando o dedo varia
// alguns décimos entre capturas por posição, pressão e formato.
//
// Pontos confirmados:
// 19,19 -> aro 17 (~16,90 no anelímetro)
// 21,01 -> aro 25 (~19,50 no anelímetro)
// 21,67 -> aro 25 (~19,50 no anelímetro)
// 22,31 -> aro 30 (~20,90 no anelímetro)
// 23,06 -> aro 30 (~20,90 no anelímetro)
// 26,24 -> aro 33 (~21,70 no anelímetro)
//
// A faixa 21,01–21,67 fica estabilizada no equivalente do aro 25.
// A faixa 22,31–23,06 fica estabilizada no equivalente do aro 30.
// Entre as zonas estáveis, interpolamos suavemente.
export const fingerMabToGaugeEquivalent = (x: number) => {
  const lerp = (x0: number, y0: number, x1: number, y1: number, value: number) => (
    y0 + ((value - x0) / (x1 - x0)) * (y1 - y0)
  );

  if (x <= 19.19) {
    // Extrapola usando a inclinação do primeiro trecho conhecido.
    return lerp(19.19, 16.90, 21.01, 19.50, x);
  }

  if (x < 21.01) {
    return lerp(19.19, 16.90, 21.01, 19.50, x);
  }

  if (x <= 21.67) {
    // Zona estável confirmada para aro 25.
    return 19.50;
  }

  if (x < 22.31) {
    return lerp(21.67, 19.50, 22.31, 20.90, x);
  }

  if (x <= 23.06) {
    // Zona estável confirmada para aro 30.
    return 20.90;
  }

  if (x < 26.24) {
    return lerp(23.06, 20.90, 26.24, 21.70, x);
  }

  // Extrapola usando a inclinação do último trecho conhecido.
  return lerp(23.06, 20.90, 26.24, 21.70, x);
};

export const computeRingResult = (
  rawWidthMm: number,
  _rules: CalibrationRule[] = [],
  applyBenchCalibration = true,
  calibrationConfidence = MAB_REFERENCE_CALIBRATION,
): RingResult => {
  const widthMm = normalizeMabTo94(rawWidthMm, calibrationConfidence);
  const fingerEquivalentMabMm = applyBenchCalibration
    ? null
    : fingerMabToGaugeEquivalent(widthMm);
  const mabForRingLookup = fingerEquivalentMabMm ?? widthMm;
  const ringSize = ringSizeFromNormalizedMab(mabForRingLookup);
  const selectedRing = findRingBySize(ringSize) || RING_DIAMETER_TABLE[0];

  return {
    rawWidthMm,
    widthMm,
    measurementCorrectionMm: widthMm - rawWidthMm,
    equivalentDiameterMm: selectedRing.diameterMm,
    fingerEquivalentMabMm,
    ringSize: selectedRing.size,
    calculationMode: "formula",
    appliedRuleOffset: null,
    continuousRing: null,
    nearBoundary: false,
    boundaryDistanceMm: null,
  };
};

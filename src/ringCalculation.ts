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

export const computeRingResult = (
  rawWidthMm: number,
  rules: CalibrationRule[] = [],
  applyBenchCalibration = true,
): RingResult => {
  // MODO DEDO — teste matemático da curva provisória.
  // Não usa REAL_FIT_REFERENCES nem regras aprendidas: queremos observar
  // exatamente o comportamento da fórmula nos próximos testes reais.
  if (!applyBenchCalibration) {
    const continuousRing = FINGER_RING_SLOPE * rawWidthMm + FINGER_RING_INTERCEPT;
    const lowerRing = Math.floor(continuousRing);
    const boundaryRingValue = lowerRing + 0.5;
    const boundaryDistanceMm = Math.abs(continuousRing - boundaryRingValue) / FINGER_RING_SLOPE;
    const nearBoundary = boundaryDistanceMm <= FINGER_RING_DEAD_ZONE_MM;

    // Fora da zona morta: arredondamento matemático normal.
    // Dentro da zona: mantém o aro superior para evitar ficar alternando
    // entre dois números por pequenas variações da leitura.
    const provisionalSize = nearBoundary
      ? lowerRing + 1
      : Math.round(continuousRing);
    const ringSize = clamp(provisionalSize, 1, 40);
    const selectedRing = findRingBySize(ringSize) || RING_DIAMETER_TABLE[0];

    return {
      rawWidthMm,
      widthMm: rawWidthMm,
      measurementCorrectionMm: 0,
      equivalentDiameterMm: selectedRing.diameterMm,
      ringSize: selectedRing.size,
      calculationMode: "formula",
      appliedRuleOffset: null,
      continuousRing,
      nearBoundary,
      boundaryDistanceMm: nearBoundary ? boundaryDistanceMm : null,
    };
  }

  // MODO ANELÍMETRO — mantém a matemática existente nesta fase de teste.
  const widthMm = calibrateMeasuredWidthMm(rawWidthMm);
  const equivalentDiameterMm = estimateInnerDiameter(widthMm);

  const closestRing = RING_DIAMETER_TABLE.reduce((closest, candidate) =>
    Math.abs(candidate.diameterMm - equivalentDiameterMm) < Math.abs(closest.diameterMm - equivalentDiameterMm) ? candidate : closest
  );
  const confirmedFit = REAL_FIT_REFERENCES.find((reference) => (
    widthMm >= reference.minWidthMm && widthMm <= reference.maxWidthMm
  ));
  const baseRing = confirmedFit
    ? findRingBySize(confirmedFit.ringSize) || closestRing
    : findRingBySize(clamp(closestRing.size + COMFORT_RING_OFFSET, 1, 40)) || closestRing;

  const matchingRule = rules.find((rule) => (
    rule.predictedRing === baseRing.size && widthMm >= rule.minWidthMm && widthMm <= rule.maxWidthMm
  ));
  const selectedRing = matchingRule
    ? findRingBySize(clamp(baseRing.size + matchingRule.offset, 1, 40)) || baseRing
    : baseRing;

  return {
    rawWidthMm,
    widthMm,
    measurementCorrectionMm: widthMm - rawWidthMm,
    equivalentDiameterMm: selectedRing.diameterMm,
    ringSize: selectedRing.size,
    calculationMode: "formula",
    appliedRuleOffset: matchingRule?.offset ?? null,
    continuousRing: null,
    nearBoundary: false,
    boundaryDistanceMm: null,
  };
};

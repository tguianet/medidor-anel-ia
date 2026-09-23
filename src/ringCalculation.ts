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
  // Aros 1–12 mantêm a referência anterior até termos medições físicas reais.
  { size: 1, diameterMm: 13.05 }, { size: 2, diameterMm: 13.37 },
  { size: 3, diameterMm: 13.68 }, { size: 4, diameterMm: 14.01 },
  { size: 5, diameterMm: 14.32 }, { size: 6, diameterMm: 14.64 },
  { size: 7, diameterMm: 14.95 }, { size: 8, diameterMm: 15.28 },
  { size: 9, diameterMm: 15.60 }, { size: 10, diameterMm: 15.92 },
  { size: 11, diameterMm: 16.24 }, { size: 12, diameterMm: 16.55 },

  // Aros 13–33 medidos fisicamente no paquímetro.
  { size: 13, diameterMm: 16.05 }, { size: 14, diameterMm: 16.50 },
  { size: 15, diameterMm: 16.70 }, { size: 16, diameterMm: 17.00 },
  { size: 17, diameterMm: 17.40 }, { size: 18, diameterMm: 17.75 },
  { size: 19, diameterMm: 18.15 }, { size: 20, diameterMm: 18.40 },
  { size: 21, diameterMm: 18.95 }, { size: 22, diameterMm: 19.30 },
  { size: 23, diameterMm: 19.45 }, { size: 24, diameterMm: 19.85 },
  { size: 25, diameterMm: 20.15 }, { size: 26, diameterMm: 20.70 },
  { size: 27, diameterMm: 20.85 }, { size: 28, diameterMm: 21.25 },
  { size: 29, diameterMm: 21.45 }, { size: 30, diameterMm: 21.95 },
  { size: 31, diameterMm: 22.20 }, { size: 32, diameterMm: 22.55 },
  { size: 33, diameterMm: 22.80 },

  // Aros acima de 33 permanecem na referência anterior até nova medição física.
  { size: 34, diameterMm: 23.55 }, { size: 35, diameterMm: 23.87 },
  { size: 36, diameterMm: 24.19 }, { size: 37, diameterMm: 24.51 },
  { size: 38, diameterMm: 24.83 }, { size: 39, diameterMm: 25.15 },
  { size: 40, diameterMm: 25.46 },
];

// Curva híbrida do modo dedo baseada nas âncoras reais mais recentes.
//
// Âncoras confirmadas:
// aro 10 ~= 14,64 mm
// aro 17 ~= 16,93 mm
// aro 21 ~= 18,37 mm
// aro 22 ~= 18,65 mm
// aro 24 ~= 19,89 mm
// aro 25 ~= 20,34 mm
// aro 29 confirmado em faixa real de aproximadamente 20,96 a 21,15 mm
// aro 30 ~= 21,30 mm
//
// Entre as âncoras usamos interpolação linear. Isso mantém os pontos reais
// intactos e preenche apenas os aros ainda não validados diretamente.
export const FINGER_RING_HYBRID_CENTERS = [
  { ringSize: 10, widthMm: 14.64, confirmed: true },
  { ringSize: 11, widthMm: 14.97, confirmed: false },
  { ringSize: 12, widthMm: 15.29, confirmed: false },
  { ringSize: 13, widthMm: 15.62, confirmed: false },
  { ringSize: 14, widthMm: 15.95, confirmed: false },
  { ringSize: 15, widthMm: 16.28, confirmed: false },
  { ringSize: 16, widthMm: 16.60, confirmed: false },
  { ringSize: 17, widthMm: 16.93, confirmed: true },

  { ringSize: 18, widthMm: 17.29, confirmed: false },
  { ringSize: 19, widthMm: 17.65, confirmed: false },
  { ringSize: 20, widthMm: 18.01, confirmed: false },
  { ringSize: 21, widthMm: 18.37, confirmed: true },

  { ringSize: 22, widthMm: 18.65, confirmed: true },
  { ringSize: 23, widthMm: 19.27, confirmed: false },
  { ringSize: 24, widthMm: 19.89, confirmed: true },

  { ringSize: 25, widthMm: 20.34, confirmed: true },

  { ringSize: 26, widthMm: 20.54, confirmed: false },
  { ringSize: 27, widthMm: 20.75, confirmed: false },
  { ringSize: 28, widthMm: 20.95, confirmed: false },
  { ringSize: 29, widthMm: 21.15, confirmed: true },
  { ringSize: 30, widthMm: 21.30, confirmed: true },

  // Acima de 30 mantemos continuação provisória até existirem novas
  // âncoras reais nessa região.
  { ringSize: 31, widthMm: 21.52, confirmed: false },
  { ringSize: 32, widthMm: 21.69, confirmed: false },
  { ringSize: 33, widthMm: 21.92, confirmed: false },
] as const;

// Converte centros em fronteiras pelos pontos médios entre aros consecutivos.
// Para aros abaixo de 10, mantemos a referência antiga até existirem dados reais.
export const FINGER_RING_THRESHOLDS = [
  { minMm: Number.NEGATIVE_INFINITY, maxExclusiveMm: 13.37, ringSize: 1 },
  { minMm: 13.37, maxExclusiveMm: 13.68, ringSize: 2 },
  { minMm: 13.68, maxExclusiveMm: 14.01, ringSize: 3 },
  { minMm: 14.01, maxExclusiveMm: 14.32, ringSize: 4 },
  { minMm: 14.32, maxExclusiveMm: 14.64, ringSize: 5 },
  { minMm: 14.64, maxExclusiveMm: 14.805, ringSize: 10 },

  { minMm: 14.805, maxExclusiveMm: 15.13, ringSize: 11 },
  { minMm: 15.13, maxExclusiveMm: 15.455, ringSize: 12 },
  { minMm: 15.455, maxExclusiveMm: 15.785, ringSize: 13 },
  { minMm: 15.785, maxExclusiveMm: 16.115, ringSize: 14 },
  { minMm: 16.115, maxExclusiveMm: 16.44, ringSize: 15 },
  { minMm: 16.44, maxExclusiveMm: 16.765, ringSize: 16 },
  { minMm: 16.765, maxExclusiveMm: 17.11, ringSize: 17 },

  { minMm: 17.11, maxExclusiveMm: 17.47, ringSize: 18 },
  { minMm: 17.47, maxExclusiveMm: 17.83, ringSize: 19 },
  { minMm: 17.83, maxExclusiveMm: 18.19, ringSize: 20 },
  { minMm: 18.19, maxExclusiveMm: 18.51, ringSize: 21 },

  { minMm: 18.51, maxExclusiveMm: 18.96, ringSize: 22 },
  { minMm: 18.96, maxExclusiveMm: 19.58, ringSize: 23 },
  { minMm: 19.58, maxExclusiveMm: 20.115, ringSize: 24 },

  { minMm: 20.115, maxExclusiveMm: 20.44, ringSize: 25 },
  { minMm: 20.44, maxExclusiveMm: 20.645, ringSize: 26 },
  { minMm: 20.645, maxExclusiveMm: 20.85, ringSize: 27 },
  { minMm: 20.85, maxExclusiveMm: 20.95, ringSize: 28 },
  { minMm: 20.95, maxExclusiveMm: 21.225, ringSize: 29 },

  { minMm: 21.225, maxExclusiveMm: 21.410, ringSize: 30 },
  { minMm: 21.410, maxExclusiveMm: 21.605, ringSize: 31 },
  { minMm: 21.605, maxExclusiveMm: 21.805, ringSize: 32 },
  { minMm: 21.805, maxExclusiveMm: Number.POSITIVE_INFINITY, ringSize: 33 },
] as const;

export const ringSizeFromFingerMeasurement = (measuredMm: number) => {
  if (!Number.isFinite(measuredMm)) return 33;

  // Prioriza a curva híbrida a partir do aro 10.
  const hybridMatch = FINGER_RING_THRESHOLDS.find(
    (range) => measuredMm >= range.minMm && measuredMm < range.maxExclusiveMm,
  );
  return hybridMatch?.ringSize ?? 33;
};

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

// Novo ajuste experimental do modo dedo: considera 100% como a geometria
// ideal do cartão e aumenta proporcionalmente a medida quando a calibração
// observada fica abaixo de 100%.
export const normalizeMeasurementTo100 = (rawMm: number, calibrationConfidence: number) => {
  if (!Number.isFinite(rawMm)) return rawMm;
  if (!Number.isFinite(calibrationConfidence) || calibrationConfidence <= 0) return rawMm;
  return rawMm * (100 / calibrationConfidence);
};


export const adjustFingerMeasurementByCalibration = (
  rawMm: number,
  calibrationConfidence: number,
) => {
  if (!Number.isFinite(rawMm)) return rawMm;
  if (!Number.isFinite(calibrationConfidence)) return rawMm;

  // Neste teste a porcentagem não altera a escala. A medida física vem
  // diretamente da homografia criada pelas quatro bordas do cartão.
  // Mantemos a função para compatibilidade enquanto validamos a geometria.
  void calibrationConfidence;
  return rawMm;
};

export const ringSizeFromNormalizedMab = (normalizedMabMm: number) => {
  const match = MAB_RING_THRESHOLDS.find((threshold) => normalizedMabMm < threshold.maxMm);
  return match?.ringSize ?? 35;
};

export const ringFromInnerDiameter = (diameterMm: number) => {
  const ringSize = ringSizeFromFingerMeasurement(diameterMm);
  const selectedRing = findRingBySize(ringSize) || RING_DIAMETER_TABLE[0];
  return {
    selectedRing,
    nearBoundary: false,
    boundaryDistanceMm: Math.abs(diameterMm - selectedRing.diameterMm),
  };
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

export const computeDiameterOnlyTestResult = (
  rawDiameterMm: number,
  _calibrationConfidence = MAB_REFERENCE_CALIBRATION,
): RingResult => {
  const diameterMm = adjustFingerMeasurementByCalibration(rawDiameterMm, _calibrationConfidence);

  const { selectedRing, nearBoundary, boundaryDistanceMm } =
    ringFromInnerDiameter(diameterMm);

  return {
    rawWidthMm: rawDiameterMm,
    widthMm: diameterMm,
    measurementCorrectionMm: diameterMm - rawDiameterMm,
    equivalentDiameterMm: selectedRing.diameterMm,
    fingerEquivalentMabMm: null,
    ringSize: selectedRing.size,
    calculationMode: "formula",
    appliedRuleOffset: null,
    continuousRing: null,
    nearBoundary,
    boundaryDistanceMm: Number.isFinite(boundaryDistanceMm) ? boundaryDistanceMm : null,
  };
};

export const computeRingResult = (
  rawWidthMm: number,
  _rules: CalibrationRule[] = [],
  applyBenchCalibration = true,
  calibrationConfidence = MAB_REFERENCE_CALIBRATION,
): RingResult => {
  // No modo dedo, o percentual de calibração é apenas um indicador de confiança.
  // A escala física já vem do cartão/homografia e não deve alterar a medida em mm.
  // O modo anelímetro mantém a normalização histórica para não alterar a bancada.
  const widthMm = applyBenchCalibration
    ? normalizeMabTo94(rawWidthMm, calibrationConfidence)
    : adjustFingerMeasurementByCalibration(rawWidthMm, calibrationConfidence);

  // Modo anelímetro continua usando a curva MAB medida em bancada.
  if (applyBenchCalibration) {
    const ringSize = ringSizeFromNormalizedMab(widthMm);
    const selectedRing = findRingBySize(ringSize) || RING_DIAMETER_TABLE[0];

    return {
      rawWidthMm,
      widthMm,
      measurementCorrectionMm: widthMm - rawWidthMm,
      equivalentDiameterMm: selectedRing.diameterMm,
      fingerEquivalentMabMm: null,
      ringSize: selectedRing.size,
      calculationMode: "formula",
      appliedRuleOffset: null,
      continuousRing: null,
      nearBoundary: false,
      boundaryDistanceMm: null,
    };
  }

  // Modo principal do dedo:
  // a única conversão contínua acontece antes daqui: pixels -> mm pela escala do cartão.
  // A medida física do dedo em mm entra diretamente na tabela de limites do paquímetro.
  const ringSize = ringSizeFromFingerMeasurement(widthMm);
  const selectedRing = findRingBySize(ringSize) || RING_DIAMETER_TABLE[0];

  return {
    rawWidthMm,
    widthMm,
    measurementCorrectionMm: widthMm - rawWidthMm,
    equivalentDiameterMm: widthMm,
    fingerEquivalentMabMm: null,
    ringSize: selectedRing.size,
    calculationMode: "formula",
    appliedRuleOffset: null,
    continuousRing: null,
    nearBoundary: false,
    boundaryDistanceMm: null,
  };
};

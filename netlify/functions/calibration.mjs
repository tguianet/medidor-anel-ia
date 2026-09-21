import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const STORE_NAME = "ring-calibration-learning";

// Restaura a base histórica conhecida sem misturar versões diferentes na
// aprendizagem automática. Os registros recuperados ficam no banco para
// consulta, mas só entram nas curvas quando analysisEligible !== false.
const RECOVERED_DATA_VERSION = "2026-09-21-full-restore-v1";
const FINGER_DATA_RESET_VERSION = "2026-09-21-finger-reset-v1";

const RECOVERED_TESTS = [
  // Medições físicas do anelímetro recuperadas da documentação.
  { id: "recovered-gauge-14", createdAt: "2026-09-20T21:47:14.000Z", widthMm: 18.20, predictedRing: 14, actualRing: 14, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 18,20 / DI 17,09. Ponto fora da série; repetir antes de usar na curva.", measurementType: "anelimetro", actualDiameterMm: 17.09, source: "historical-recovered", analysisEligible: false },
  { id: "recovered-gauge-16", createdAt: "2026-09-20T21:47:16.000Z", widthMm: 18.40, predictedRing: 16, actualRing: 16, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 18,40 / DI 17,83.", measurementType: "anelimetro", actualDiameterMm: 17.83, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-20", createdAt: "2026-09-20T21:47:20.000Z", widthMm: 19.80, predictedRing: 20, actualRing: 20, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 19,80 / DI 19,10. Valor corrigido na documentação.", measurementType: "anelimetro", actualDiameterMm: 19.10, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-21a", createdAt: "2026-09-20T21:47:21.000Z", widthMm: 19.90, predictedRing: 21, actualRing: 21, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "Referência conflitante do aro 21: LM 19,90 / DI 19,42.", measurementType: "anelimetro", actualDiameterMm: 19.42, source: "historical-recovered", analysisEligible: false },
  { id: "recovered-gauge-21b", createdAt: "2026-09-20T21:47:22.000Z", widthMm: 20.50, predictedRing: 21, actualRing: 21, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "Referência conflitante do aro 21: LM 20,50 / DI 19,29.", measurementType: "anelimetro", actualDiameterMm: 19.29, source: "historical-recovered", analysisEligible: false },
  { id: "recovered-gauge-23", createdAt: "2026-09-20T21:47:23.000Z", widthMm: 21.00, predictedRing: 23, actualRing: 23, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 21,00 / DI 20,05.", measurementType: "anelimetro", actualDiameterMm: 20.05, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-25", createdAt: "2026-09-20T21:47:25.000Z", widthMm: 21.80, predictedRing: 25, actualRing: 25, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 21,80 / DI 20,68.", measurementType: "anelimetro", actualDiameterMm: 20.68, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-26", createdAt: "2026-09-20T21:47:26.000Z", widthMm: 22.00, predictedRing: 26, actualRing: 26, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 22,00 / DI 21,04.", measurementType: "anelimetro", actualDiameterMm: 21.04, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-27", createdAt: "2026-09-20T21:47:27.000Z", widthMm: 22.50, predictedRing: 27, actualRing: 27, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 22,50 / DI 21,37.", measurementType: "anelimetro", actualDiameterMm: 21.37, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-28", createdAt: "2026-09-20T21:47:28.000Z", widthMm: 22.90, predictedRing: 28, actualRing: 28, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 22,90 / DI 21,68. Faixa de DI também registrada como 21,68–21,96.", measurementType: "anelimetro", actualDiameterMm: 21.68, source: "historical-recovered", analysisEligible: true },
  { id: "recovered-gauge-31", createdAt: "2026-09-20T21:47:31.000Z", widthMm: 24.00, predictedRing: 31, actualRing: 31, error: 0, calibrationConfidence: 0, zoom: 1, finger: "anelímetro", hand: "n/a", note: "LM 24,00 / DI 22,60. Mantido como referência especial até nova confirmação.", measurementType: "anelimetro", actualDiameterMm: 22.60, source: "historical-recovered", analysisEligible: false },
];

const RECOVERED_REFERENCES = {
  version: RECOVERED_DATA_VERSION,
  anelimetroCurve: {
    slope: 0.853012552,
    intercept: 2.157198047,
    formula: "DI = 0.853012552 * LM + 2.157198047",
    note: "Curva provisória própria do modo anelímetro; converter DI diretamente pela tabela oficial sem +1 de conforto.",
  },
  fingerCurve: {
    slope: 1.807461821,
    intercept: -15.009085637,
    formula: "aro = 1.807461821 * largura_do_dedo_mm - 15.009085637",
    deadZoneMm: 0.15,
    note: "Curva provisória do modo dedo; manter separada do anelímetro.",
  },
  ring32: {
    ringSize: 32,
    internalDiameterMm: 22.92,
    lmMm: null,
    note: "DI conhecido; LM não confirmado.",
  },
  legacyBenchMaPq: [
    { ringSize: 14, maMm: 15.5, pqMm: 15.4 },
    { ringSize: 16, maMm: 16.2, pqMm: 16.5 },
    { ringSize: 18, maMm: 16.9, pqMm: 17.4 },
    { ringSize: 20, maMm: 17.7, pqMm: 18.2 },
    { ringSize: 22, maMm: 18.4, pqMm: 19.0 },
    { ringSize: 24, maMm: 19.1, pqMm: 19.8 },
    { ringSize: 26, maMm: 19.6, pqMm: 20.6 },
    { ringSize: 28, maMm: 20.1, pqMm: 21.4 },
    { ringSize: 30, maMm: 20.8, pqMm: 22.0 },
    { ringSize: 32, maMm: 21.7, pqMm: 22.7 },
  ],
};

const ensureRecoveredCalibrationData = async (store) => {
  const restoredVersion = await store.get("meta/recovered-data-version", { type: "text", consistency: "strong" });
  if (restoredVersion === RECOVERED_DATA_VERSION) return;

  for (const record of RECOVERED_TESTS) {
    await store.setJSON(`tests/recovered/${record.id}`, record, { onlyIfNew: true });
  }
  await store.setJSON("references/recovered-calibration", RECOVERED_REFERENCES);
  await store.set("meta/recovered-data-version", RECOVERED_DATA_VERSION);
};

// Limpeza única solicitada para recomeçar a calibração de dedo sem misturar
// testes antigos. Mantém intactos todos os registros do anelímetro e não
// altera a fórmula de correlação implementada em src/ringCalculation.ts.
// Também limpa regras antigas aprendidas a partir dos testes de dedo.
const ensureFreshFingerDataset = async (store) => {
  const resetVersion = await store.get("meta/finger-data-reset-version", { type: "text", consistency: "strong" });
  if (resetVersion === FINGER_DATA_RESET_VERSION) return;

  const { blobs } = await store.list({ prefix: "tests/" });
  for (const { key } of blobs) {
    const record = await store.get(key, { type: "json", consistency: "strong" });
    if (!record || record.measurementType === "anelimetro") continue;
    await store.delete(key);
  }

  await store.delete("rules/current");
  await store.set("meta/finger-data-reset-version", FINGER_DATA_RESET_VERSION);
};

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
});

const readTests = async (store) => {
  const { blobs } = await store.list({ prefix: "tests/" });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
  return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const readRules = async (store) => (await store.get("rules/current", { type: "json", consistency: "strong" })) || [];

const makeSuggestions = (tests, rules) => {
  const groups = new Map();
  for (const test of tests.filter((item) => item.measurementType !== "anelimetro" && item.analysisEligible !== false)) {
    const bucket = Math.round(test.widthMm * 2) / 2;
    const key = `${test.predictedRing}:${bucket.toFixed(1)}`;
    const group = groups.get(key) || { key, bucket, predictedRing: test.predictedRing, values: [] };
    group.values.push(test.actualRing - test.predictedRing);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const sorted = [...group.values].sort((a, b) => a - b);
    const average = group.values.reduce((sum, value) => sum + value, 0) / group.values.length;
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const applied = rules.find((rule) => rule.key === group.key);
    return {
      key: group.key,
      bucket: group.bucket,
      minWidthMm: group.bucket - 0.25,
      maxWidthMm: group.bucket + 0.25,
      predictedRing: group.predictedRing,
      samples: group.values.length,
      averageOffset: Number(average.toFixed(2)),
      medianOffset: Number(median.toFixed(2)),
      suggestedOffset: Math.round((average + median) / 2),
      confidence: Math.min(95, 35 + group.values.length * 10),
      appliedOffset: applied?.offset ?? null,
    };
  }).sort((a, b) => a.bucket - b.bucket);
};

// O anelímetro é um instrumento de conferência, não um dedo. Mantemos a
// curva dele separada para que seus testes nunca alterem a recomendação ao
// cliente. Cada ponto reúne as leituras feitas na mesma marca do anelímetro.
const makeGaugeCurve = (tests) => {
  const groups = new Map();
  for (const test of tests.filter((item) => item.measurementType === "anelimetro" && item.analysisEligible !== false)) {
    const key = String(test.actualRing);
    const group = groups.get(key) || { ringSize: test.actualRing, widths: [], predictions: [], diameters: [] };
    group.widths.push(test.widthMm);
    group.predictions.push(test.predictedRing);
    if (Number.isFinite(Number(test.actualDiameterMm))) group.diameters.push(Number(test.actualDiameterMm));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const averageWidthMm = group.widths.reduce((sum, value) => sum + value, 0) / group.widths.length;
    const averagePrediction = group.predictions.reduce((sum, value) => sum + value, 0) / group.predictions.length;
    return {
      ringSize: group.ringSize,
      samples: group.widths.length,
      averageWidthMm: Number(averageWidthMm.toFixed(2)),
      averagePrediction: Number(averagePrediction.toFixed(1)),
      averageError: Number((group.ringSize - averagePrediction).toFixed(1)),
      averageDiameterMm: group.diameters.length ? Number((group.diameters.reduce((sum, value) => sum + value, 0) / group.diameters.length).toFixed(2)) : null,
    };
  }).sort((a, b) => a.ringSize - b.ringSize);
};

const responseData = (tests, rules) => ({
  tests,
  rules,
  suggestions: makeSuggestions(tests, rules),
  gaugeCurve: makeGaugeCurve(tests),
});

export default async (request, context) => {
  const store = getStore(STORE_NAME);
  await ensureRecoveredCalibrationData(store);
  await ensureFreshFingerDataset(store);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const rules = await readRules(store);

    if (url.searchParams.get("summary") === "1") {
      const tests = await readTests(store);
      const liveTests = tests
        .filter((test) => test.source === "live-test")
        .map((test) => ({
          widthMm: test.widthMm,
          predictedRing: test.predictedRing,
          actualRing: test.actualRing,
          error: test.error,
          measurementType: test.measurementType,
          actualDiameterMm: test.actualDiameterMm ?? null,
          calibrationConfidence: test.calibrationConfidence,
          zoom: test.zoom,
          magnetWidthsMm: Array.isArray(test.magnetWidthsMm) ? test.magnetWidthsMm : [],
        }));

      return json({
        count: liveTests.length,
        tests: liveTests,
        gaugeCurve: makeGaugeCurve(tests),
        suggestions: makeSuggestions(tests, rules),
      });
    }

    return json({ rules });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = await request.json();
    if (body.action === "list") {
      const [tests, rules] = await Promise.all([readTests(store), readRules(store)]);
      return json(responseData(tests, rules));
    }
    if (body.action === "add-test") {
      const widthMm = Number(body.widthMm);
      const predictedRing = Number(body.predictedRing);
      const actualRing = Number(body.actualRing);
      const measurementType = body.measurementType === "anelimetro" ? "anelimetro" : "finger";
      const actualDiameterMm = body.actualDiameterMm == null || body.actualDiameterMm === "" ? null : Number(body.actualDiameterMm);
      const magnetWidthsMm = Array.isArray(body.magnetWidthsMm)
        ? body.magnetWidthsMm
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0 && value < 45)
            .slice(0, 4)
            .map((value) => Number(value.toFixed(2)))
        : [];
      if (!(widthMm >= 10 && widthMm <= 40) || !(predictedRing >= 1 && predictedRing <= 40) || !(actualRing >= 1 && actualRing <= 40)) {
        return json({ error: "Dados da medição inválidos." }, 400);
      }
      const record = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        widthMm: Number(widthMm.toFixed(2)),
        predictedRing: Math.round(predictedRing),
        actualRing: Math.round(actualRing),
        error: Math.round(actualRing) - Math.round(predictedRing),
        calibrationConfidence: Math.max(0, Math.min(100, Math.round(Number(body.calibrationConfidence) || 0))),
        zoom: Math.max(1, Math.min(4, Number(body.zoom) || 1)),
        finger: String(body.finger || "não informado").slice(0, 30),
        hand: String(body.hand || "não informada").slice(0, 20),
        note: String(body.note || "").slice(0, 180),
        measurementType,
        actualDiameterMm: Number.isFinite(actualDiameterMm) ? Number(actualDiameterMm.toFixed(2)) : null,
        magnetWidthsMm,
        source: "live-test",
        analysisEligible: true,
      };
      await store.setJSON(`tests/${record.createdAt}-${record.id}`, record, { onlyIfNew: true });
      const [tests, rules] = await Promise.all([readTests(store), readRules(store)]);
      return json({ record, ...responseData(tests, rules) }, 201);
    }
    if (body.action === "update-test-type") {
      const measurementType = body.measurementType === "anelimetro" ? "anelimetro" : "finger";
      const { blobs } = await store.list({ prefix: "tests/" });
      for (const { key } of blobs) {
        const record = await store.get(key, { type: "json", consistency: "strong" });
        if (record?.id !== body.id) continue;
        const updated = { ...record, measurementType, updatedAt: new Date().toISOString() };
        await store.setJSON(key, updated);
        const [tests, rules] = await Promise.all([readTests(store), readRules(store)]);
        return json({ record: updated, ...responseData(tests, rules) });
      }
      return json({ error: "Teste não encontrado." }, 404);
    }
    if (body.action === "apply-rule") {
      const tests = await readTests(store);
      const rules = await readRules(store);
      const suggestion = makeSuggestions(tests, rules).find((item) => item.key === body.key);
      if (!suggestion) return json({ error: "Sugestão não encontrada." }, 404);
      const nextRule = {
        key: suggestion.key,
        minWidthMm: suggestion.minWidthMm,
        maxWidthMm: suggestion.maxWidthMm,
        predictedRing: suggestion.predictedRing,
        offset: suggestion.suggestedOffset,
        samples: suggestion.samples,
        appliedAt: new Date().toISOString(),
      };
      const nextRules = [...rules.filter((rule) => rule.key !== nextRule.key), nextRule];
      await store.setJSON("rules/current", nextRules);
      await store.setJSON(`history/${nextRule.appliedAt}-${randomUUID()}`, { action: "apply", rule: nextRule });
      return json({ rules: nextRules, applied: nextRule, suggestions: makeSuggestions(tests, nextRules) });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível acessar o banco de calibração." }, 500);
  }
};

import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const STORE_NAME = "ring-calibration-learning";
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
  for (const test of tests.filter((item) => item.measurementType !== "anelimetro")) {
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
  for (const test of tests.filter((item) => item.measurementType === "anelimetro")) {
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
  if (request.method === "GET") {
    const rules = await readRules(store);
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

import { getStore } from "@netlify/blobs";
import { randomUUID, timingSafeEqual } from "node:crypto";

const STORE_NAME = "ring-calibration-learning";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const authorized = (request) => {
  const expected = process.env.CALIBRATION_ADMIN_PIN || "";
  const received = request.headers.get("x-admin-pin") || "";
  if (!expected || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
};

const readTests = async (store) => {
  const { blobs } = await store.list({ prefix: "tests/" });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
  return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const readRules = async (store) => (await store.get("rules/current", { type: "json", consistency: "strong" })) || [];

const makeSuggestions = (tests, rules) => {
  const groups = new Map();
  for (const test of tests) {
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

export default async (request) => {
  const store = getStore(STORE_NAME);
  if (request.method === "GET") {
    const rules = await readRules(store);
    return json({ rules });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!process.env.CALIBRATION_ADMIN_PIN) return json({ error: "Defina CALIBRATION_ADMIN_PIN no Netlify antes de usar o modo administrador." }, 503);
  if (!authorized(request)) return json({ error: "PIN administrativo incorreto." }, 401);

  try {
    const body = await request.json();
    if (body.action === "list") {
      const [tests, rules] = await Promise.all([readTests(store), readRules(store)]);
      return json({ tests, rules, suggestions: makeSuggestions(tests, rules) });
    }
    if (body.action === "add-test") {
      const widthMm = Number(body.widthMm);
      const predictedRing = Number(body.predictedRing);
      const actualRing = Number(body.actualRing);
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
      };
      await store.setJSON(`tests/${record.createdAt}-${record.id}`, record, { onlyIfNew: true });
      const [tests, rules] = await Promise.all([readTests(store), readRules(store)]);
      return json({ record, tests, rules, suggestions: makeSuggestions(tests, rules) }, 201);
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

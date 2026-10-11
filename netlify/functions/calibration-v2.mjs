import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

// Banco de calibracao V2 — comeca VAZIO e e totalmente separado do banco
// antigo ("ring-calibration-learning"). Guarda medicoes da v2 (borda fisica)
// junto com o aro REAL informado, para montar uma curva nova e comparar
// depois com a antiga. Nada aqui altera o aro mostrado ao cliente.
const STORE_NAME = "ring-calibration-v2";
const PREFIX = "tests/";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const num = (value, min, max, digits = 3) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Number(n.toFixed(digits));
};
const int = (value, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (value, max, fallback = "") => String(value ?? "").trim().slice(0, max) || fallback;

export const sanitizeRecord = (body) => {
  const realRing = int(body.realRing, 1, 40);
  const usedWidthMm = num(body.usedWidthMm, 10, 40);
  const predictedRing = int(body.predictedRing, 1, 40);
  if (realRing === null || usedWidthMm === null || predictedRing === null) return null;
  const reasons = Array.isArray(body.gateReasons)
    ? body.gateReasons.slice(0, 12).map((item) => text(item, 80)).filter(Boolean)
    : [];
  return {
    realRing,
    predictedRing,
    error: realRing - predictedRing,
    usedWidthMm,
    widthSource: body.widthSource === "borda-fisica" ? "borda-fisica" : "metodo-anterior",
    physicalRawMm: num(body.physicalRawMm, 10, 40),
    offsetMm: num(body.offsetMm, -2, 2),
    oldMethodMm: num(body.oldMethodMm, 10, 40),
    oldMethodRing: int(body.oldMethodRing, 1, 40),
    cardPx: num(body.cardPx, 50, 10000, 1),
    mmPerPx: num(body.mmPerPx, 0.001, 10, 5),
    physicalRatio: num(body.physicalRatio, 0, 2, 4),
    physicalSupport: int(body.physicalSupport, 0, 100),
    fingerAngleDeg: num(body.fingerAngleDeg, -90, 90, 2),
    pitch: num(body.pitch, -180, 180, 1),
    roll: num(body.roll, -180, 180, 1),
    stability: int(body.stability, 0, 100),
    perspective: int(body.perspective, 0, 100),
    gateAccepted: body.gateAccepted === true,
    gateReasons: reasons,
    person: text(body.person, 40, "não informado"),
    finger: text(body.finger, 20, "não informado"),
    hand: text(body.hand, 12, "não informada"),
    note: text(body.note, 180),
    appVersion: text(body.appVersion, 60, "v2"),
    shotWidthsMm: Array.isArray(body.shotWidthsMm)
      ? body.shotWidthsMm.slice(0, 8).map((value) => (value === null ? null : num(value, 10, 40)))
      : [],
    shotSpreadMm: num(body.shotSpreadMm, 0, 5),
    shotValid: int(body.shotValid, 0, 8),
    shotOutlierIndex: int(body.shotOutlierIndex, 0, 7),
    cardSeriesPx: Array.isArray(body.cardSeriesPx)
      ? body.cardSeriesPx.slice(0, 8).map((value) => (value === null ? null : num(value, 50, 10000, 1)))
      : [],
    cardSeriesSpreadPct: num(body.cardSeriesSpreadPct, 0, 100),
  };
};

const readAll = async (store) => {
  const { blobs } = await store.list({ prefix: PREFIX });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
  return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const CSV_COLUMNS = [
  "createdAt", "person", "finger", "hand", "realRing", "predictedRing", "error",
  "usedWidthMm", "widthSource", "physicalRawMm", "offsetMm", "oldMethodMm", "oldMethodRing",
  "cardPx", "mmPerPx", "physicalRatio", "physicalSupport", "fingerAngleDeg", "pitch", "roll",
  "stability", "perspective", "gateAccepted", "gateReasons", "shotWidthsMm", "shotSpreadMm", "shotValid", "shotOutlierIndex", "cardSeriesPx", "cardSeriesSpreadPct",
  "note", "appVersion", "id",
];
const csvCell = (value) => {
  const raw = Array.isArray(value) ? value.join(" | ") : value ?? "";
  const s = String(raw);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (records) =>
  [CSV_COLUMNS.join(";"), ...records.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(";"))].join("\n");

export default async (request) => {
  const store = getStore(STORE_NAME);
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const records = await readAll(store);
      if (url.searchParams.get("csv") === "1") {
        return new Response("﻿" + toCsv(records), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="calibracao-v2-${new Date().toISOString().slice(0, 10)}.csv"`,
            "cache-control": "no-store",
          },
        });
      }
      return json({ count: records.length, records });
    }
    if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

    const body = await request.json();
    if (body.action === "list") {
      const records = await readAll(store);
      return json({ count: records.length, records });
    }
    if (body.action === "add") {
      const clean = sanitizeRecord(body);
      if (!clean) return json({ error: "Informe o aro real (1–40) e faça uma medição válida antes de salvar." }, 400);
      const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...clean };
      await store.setJSON(`${PREFIX}${record.createdAt}-${record.id}`, record, { onlyIfNew: true });
      const records = await readAll(store);
      return json({ record, count: records.length, records }, 201);
    }
    if (body.action === "delete") {
      const id = String(body.id || "");
      if (!id) return json({ error: "Registro não informado." }, 400);
      const { blobs } = await store.list({ prefix: PREFIX });
      const match = blobs.find(({ key }) => key.endsWith(`-${id}`));
      if (!match) return json({ error: "Registro não encontrado." }, 404);
      await store.delete(match.key);
      const records = await readAll(store);
      return json({ deleted: id, count: records.length, records });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível acessar o banco de calibração v2." }, 500);
  }
};

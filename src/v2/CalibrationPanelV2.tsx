import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MANUAL_FINGER_CURVE, classifyFingerWidthMm } from "./ringClassifier";

// Painel de calibracao V2 (modo de teste).
// Banco proprio e separado do antigo: /.netlify/functions/calibration-v2.
// Serve para juntar medicoes da borda fisica com o ARO REAL de cada pessoa
// e, depois, montar e comparar uma curva nova. Nao altera o aro do cliente.

export type CalibrationV2Snapshot = {
  usedWidthMm: number;
  predictedRing: number;
  widthSource: "borda-fisica" | "metodo-anterior";
  physicalRawMm: number | null;
  offsetMm: number;
  oldMethodMm: number | null;
  oldMethodRing: number | null;
  cardPx: number | null;
  mmPerPx: number | null;
  physicalRatio: number | null;
  physicalSupport: number | null;
  fingerAngleDeg: number | null;
  pitch: number | null;
  roll: number | null;
  stability: number | null;
  perspective: number | null;
  gateAccepted: boolean;
  gateReasons: string[];
  appVersion: string;
  /** Serie de fotos: medida de cada foto (null = reprovada). */
  shotWidthsMm?: (number | null)[];
  shotSpreadMm?: number | null;
  shotValid?: number | null;
  shotOutlierIndex?: number | null;
  cardSeriesPx?: (number | null)[];
  cardSeriesSpreadPct?: number | null;
};

type RecordV2 = CalibrationV2Snapshot & {
  id: string;
  createdAt: string;
  realRing: number;
  error: number;
  person: string;
  finger: string;
  hand: string;
  note: string;
};

const ENDPOINT = "/.netlify/functions/calibration-v2";

const call = async (body: Record<string, unknown>) => {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data as { count: number; records: RecordV2[]; record?: RecordV2 };
};

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? "–" : value.toFixed(digits).replace(".", ",");

const FINGERS = ["anelar", "médio", "indicador", "mínimo", "polegar"];
const HANDS = ["direita", "esquerda"];

const box: CSSProperties = {
  border: "1px solid rgba(126,196,255,.55)",
  borderRadius: 14,
  padding: 14,
  margin: "12px 0",
  background: "rgba(10,18,26,.72)",
  display: "grid",
  gap: 10,
};
const input: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(0,0,0,.35)",
  color: "inherit",
  font: "inherit",
};
const row: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 };

export default function CalibrationPanelV2({ snapshot }: { snapshot: CalibrationV2Snapshot | null }) {
  const [records, setRecords] = useState<RecordV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [realRing, setRealRing] = useState("");
  const [person, setPerson] = useState(() => {
    try { return localStorage.getItem("calibV2.person") ?? ""; } catch { return ""; }
  });
  const [finger, setFinger] = useState("anelar");
  const [hand, setHand] = useState("direita");
  const [note, setNote] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    call({ action: "list" })
      .then((data) => { if (!cancelled) setRecords(data.records); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!snapshot) return;
    const ring = Number(realRing);
    if (!Number.isInteger(ring) || ring < 1 || ring > 40) {
      setError("Digite o aro real (número inteiro de 1 a 40).");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      try { localStorage.setItem("calibV2.person", person); } catch { /* opcional */ }
      const data = await call({ action: "add", ...snapshot, realRing: ring, person, finger, hand, note });
      setRecords(data.records);
      const hit = data.record && data.record.realRing === data.record.predictedRing;
      setMessage(`Salvo (${data.count} no total) · app disse ${snapshot.predictedRing}, real ${ring} ${hit ? "✓" : "✗"}`);
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (pendingDelete !== id) { setPendingDelete(id); return; }
    setPendingDelete(null);
    try {
      const data = await call({ action: "delete", id });
      setRecords(data.records);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Estatisticas apenas com capturas aceitas pela validacao.
  const stats = useMemo(() => {
    const accepted = records.filter((r) => r.gateAccepted);
    const people = new Set(accepted.map((r) => `${r.person}|${r.finger}|${r.hand}`)).size;
    const exact = accepted.filter((r) => r.predictedRing === r.realRing).length;
    const withinOne = accepted.filter((r) => Math.abs(r.predictedRing - r.realRing) <= 1).length;
    const oldComparable = accepted.filter((r) => r.oldMethodRing !== null);
    const oldExact = oldComparable.filter((r) => r.oldMethodRing === r.realRing).length;
    const rawComparable = accepted.filter((r) => r.physicalRawMm !== null);
    const rawExact = rawComparable.filter((r) => classifyFingerWidthMm(r.physicalRawMm as number).exactRingSize === r.realRing).length;

    const byRing = new Map<number, number[]>();
    for (const r of accepted) {
      if (r.physicalRawMm === null) continue;
      const list = byRing.get(r.realRing) ?? [];
      list.push(r.physicalRawMm);
      byRing.set(r.realRing, list);
    }
    const perRing = [...byRing.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ring, values]) => {
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const spread = Math.max(...values) - Math.min(...values);
        const center = MANUAL_FINGER_CURVE[ring] ?? null;
        return { ring, n: values.length, mean, spread, center, bias: center === null ? null : mean - center };
      });

    return {
      total: records.length,
      accepted: accepted.length,
      people,
      exact,
      withinOne,
      oldExact,
      oldTotal: oldComparable.length,
      rawExact,
      rawTotal: rawComparable.length,
      perRing,
    };
  }, [records]);

  const pct = (a: number, b: number) => (b ? ` (${Math.round((a / b) * 100)}%)` : "");
  const visible = showAll ? records : records.slice(0, 8);

  return (
    <section style={box} aria-label="Painel de calibração V2">
      <strong style={{ color: "#9ed2ff", letterSpacing: ".04em" }}>CALIBRAÇÃO V2 · BANCO NOVO</strong>

      {snapshot ? (
        <span>
          Esta foto: <b>{fmt(snapshot.usedWidthMm)} mm</b> ({snapshot.widthSource === "borda-fisica" ? "borda física" : "método anterior"}) → app diz <b>aro {snapshot.predictedRing}</b>
          {snapshot.gateAccepted ? " · validação ✓" : " · validação ✕ (salva, mas fica fora das estatísticas)"}
        </span>
      ) : (
        <span>Faça uma medição para poder salvar.</span>
      )}

      <div style={row}>
        <label>
          Aro real*
          <input style={input} type="number" inputMode="numeric" min={1} max={40} value={realRing}
            onChange={(e) => setRealRing(e.target.value)} placeholder="ex.: 25" />
        </label>
        <label>
          Pessoa
          <input style={input} value={person} maxLength={40}
            onChange={(e) => setPerson(e.target.value)} placeholder="nome ou apelido" />
        </label>
      </div>
      <div style={row}>
        <label>
          Dedo
          <select style={input} value={finger} onChange={(e) => setFinger(e.target.value)}>
            {FINGERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Mão
          <select style={input} value={hand} onChange={(e) => setHand(e.target.value)}>
            {HANDS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>
      <label>
        Observação
        <input style={input} value={note} maxLength={180} onChange={(e) => setNote(e.target.value)}
          placeholder="ex.: cartão preto, mesa de madeira" />
      </label>

      <button type="button" onClick={save} disabled={!snapshot || saving || !realRing}>
        {saving ? "Salvando…" : "Salvar esta medição"}
      </button>
      {message && <span style={{ color: "#52e0a3" }}>{message}</span>}
      {error && <span style={{ color: "#ff9f8a" }}>{error}</span>}

      <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 10, display: "grid", gap: 4 }}>
        <strong>Resumo {loading ? "· carregando…" : ""}</strong>
        <span>Medições: {stats.total} · aceitas: {stats.accepted} · pessoas/dedos: {stats.people}</span>
        <span>App (borda física + correção): exato {stats.exact}/{stats.accepted}{pct(stats.exact, stats.accepted)} · ±1 aro {stats.withinOne}/{stats.accepted}{pct(stats.withinOne, stats.accepted)}</span>
        <span>Borda física sem correção: {stats.rawExact}/{stats.rawTotal}{pct(stats.rawExact, stats.rawTotal)}</span>
        <span>Método anterior: {stats.oldExact}/{stats.oldTotal}{pct(stats.oldExact, stats.oldTotal)}</span>
        {stats.perRing.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.8 }}>
                  <th>Aro real</th><th>n</th><th>Borda média</th><th>Variação</th><th>Centro curva</th><th>Desvio</th>
                </tr>
              </thead>
              <tbody>
                {stats.perRing.map((p) => (
                  <tr key={p.ring}>
                    <td>{p.ring}</td><td>{p.n}</td><td>{fmt(p.mean)}</td><td>{fmt(p.spread)}</td>
                    <td>{fmt(p.center, 3)}</td>
                    <td style={{ color: p.bias !== null && Math.abs(p.bias) > 0.1 ? "#f5d477" : undefined }}>
                      {p.bias === null ? "–" : (p.bias > 0 ? "+" : "") + fmt(p.bias)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <small>Desvio = borda física média (sem correção) − centro do aro na curva atual.</small>
          </div>
        )}
      </div>

      {records.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 10, display: "grid", gap: 6 }}>
          <strong>Últimas medições</strong>
          {visible.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: r.gateAccepted ? 1 : 0.55 }}>
              <span style={{ flex: 1 }}>
                {r.realRing === r.predictedRing ? "✓" : "✗"} {r.person} · {r.finger} {r.hand} · real {r.realRing} · app {r.predictedRing} · borda {fmt(r.physicalRawMm)} mm
                {!r.gateAccepted && " · reprovada"}
                {r.note && ` · ${r.note}`}
              </span>
              <button type="button" onClick={() => remove(r.id)}
                style={{ padding: "4px 8px", fontSize: 11, minHeight: 0 }}>
                {pendingDelete === r.id ? "Confirmar?" : "Apagar"}
              </button>
            </div>
          ))}
          {records.length > 8 && (
            <button type="button" className="secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Mostrar menos" : `Mostrar todas (${records.length})`}
            </button>
          )}
          <a href={`${ENDPOINT}?csv=1`} download style={{ color: "#9ed2ff" }}>Baixar tudo em CSV (abre no Excel)</a>
        </div>
      )}
    </section>
  );
}

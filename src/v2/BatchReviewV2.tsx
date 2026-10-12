import { useEffect, useState } from "react";

// Ferramenta experimental isolada: nao altera captura, calibracao ou classificador.
type BatchEntry = {
  id: string;
  capturedAt: string;
  ringSize: number;
  actualRing: number | null;
  widthMm: number;
  calibrationConfidence: number;
  version: string;
};
type Props = {
  ringSize: number | null;
  widthMm: number | null;
  calibrationConfidence: number;
  ready: boolean;
};
const STORAGE_KEY = "medidor-anel-v2-batch-review-v1";
const VERSION = "v2-batch-2026-10-12";
const isEntry = (value: unknown): value is BatchEntry => {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<BatchEntry>;
  return typeof row.id === "string" && typeof row.capturedAt === "string"
    && typeof row.ringSize === "number" && Number.isFinite(row.ringSize)
    && typeof row.widthMm === "number" && Number.isFinite(row.widthMm)
    && (row.actualRing === null || (typeof row.actualRing === "number" && Number.isFinite(row.actualRing)))
    && typeof row.calibrationConfidence === "number";
};
const loadBatch = (): BatchEntry[] => {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data.filter(isEntry) : [];
  } catch { return []; }
};
const csvValue = (value: string | number | null) =>
  '"' + String(value ?? "").replace(/"/g, '""') + '"';
const csvFromEntries = (entries: BatchEntry[]) => [
  ["id", "data", "aro_estimado", "aro_real", "diferenca_aros", "largura_mm", "confianca_cartao", "versao"].join(","),
  ...entries.map(row => [
    row.id, row.capturedAt, row.ringSize, row.actualRing,
    row.actualRing === null ? null : row.ringSize - row.actualRing,
    row.widthMm.toFixed(3), row.calibrationConfidence, row.version
  ].map(csvValue).join(","))
].join("\r\n");
const download = (content: string, filename: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
};
export default function BatchReviewV2({ ringSize, widthMm, calibrationConfidence, ready }: Props) {
  const [entries, setEntries] = useState<BatchEntry[]>(loadBatch);
  const [actualRing, setActualRing] = useState("");
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
    catch { setMessage("Armazenamento indisponivel. Exporte o lote antes de fechar."); }
  }, [entries]);

  const save = () => {
    if (!ready || ringSize === null || widthMm === null || !Number.isFinite(widthMm) || !Number.isFinite(ringSize)) {
      setMessage("Finalize a medicao antes de adicionar ao lote.");
      return;
    }
    const real = actualRing.trim() === "" ? null : Number(actualRing);
    if (real !== null && (!Number.isInteger(real) || real < 1 || real > 40)) {
      setMessage("O aro real deve ser um numero inteiro entre 1 e 40.");
      return;
    }
    const item: BatchEntry = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
      capturedAt: new Date().toISOString(),
      ringSize, actualRing: real, widthMm, calibrationConfidence, version: VERSION
    };
    setEntries(current => [...current, item]);
    setMessage("Teste registrado. Use Tirar outra para a proxima medicao.");
    setActualRing("");
    setConfirmClear(false);
  };
  const exportCsv = () => {
    if (!entries.length) return;
    download("\ufeff" + csvFromEntries(entries), "medidor-anel-v2-lote.csv", "text/csv;charset=utf-8");
  };
  const shareBatch = async () => {
    if (!entries.length) return;
    const csv = "\ufeff" + csvFromEntries(entries);
    const file = new File([csv], "medidor-anel-v2-lote.csv", { type: "text/csv" });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: "Conferencia em lote - Medidor de Anel V2" });
      } else {
        exportCsv();
        setMessage("Arquivo CSV gerado. Envie pelo WhatsApp, email ou outro aplicativo.");
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        exportCsv();
        setMessage("Compartilhamento nao disponivel. Arquivo CSV gerado.");
      }
    }
  };
  return (
    <section className="panel" style={{ marginTop: 16, padding: 16, border: "1px solid rgba(82,224,163,.45)", borderRadius: 14 }}>
      <strong style={{ display: "block", marginBottom: 8 }}>CONFERENCIA EM LOTE - V2</strong>
      <p style={{ margin: "0 0 12px", opacity: .8 }}>
        Registre varias medicoes e envie todas juntas. O lote fica neste navegador; fotos e dados pessoais nao sao salvos.
      </p>
      <label style={{ display: "grid", gap: 5, marginBottom: 10 }}>
        Aro real (opcional, para conferir o erro)
        <input type="number" min="1" max="40" step="1" value={actualRing}
          onChange={event => setActualRing(event.target.value)}
          placeholder="Ex.: 25" style={{ padding: 10, maxWidth: 180 }} />
      </label>
      <button type="button" className="primary" onClick={save} disabled={!ready || ringSize === null || widthMm === null}>
        Adicionar este teste ao lote
      </button>
      <p aria-live="polite" style={{ margin: "10px 0" }}>{message}</p>
      <strong>{entries.length} teste(s) acumulado(s)</strong>
      {entries.length > 0 && (
        <>
          <div style={{ overflowX: "auto", maxHeight: 230, margin: "10px 0" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr><th>Teste</th><th>Previsto</th><th>Real</th><th>Erro</th><th></th></tr></thead>
              <tbody>{entries.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td><td>{item.ringSize}</td><td>{item.actualRing ?? "-"}</td>
                  <td>{item.actualRing === null ? "-" : item.ringSize - item.actualRing}</td>
                  <td><button type="button" className="secondary" onClick={() => setEntries(current => current.filter(row => row.id !== item.id))} aria-label={`Excluir teste ${index + 1}`}>Excluir</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="primary" onClick={() => void shareBatch()}>Enviar lote completo</button>
            <button type="button" className="secondary" onClick={exportCsv}>Baixar CSV</button>
            <button type="button" className="secondary" onClick={() => download(JSON.stringify({ version: VERSION, exportedAt: new Date().toISOString(), entries }, null, 2), "medidor-anel-v2-lote.json", "application/json")}>Baixar JSON</button>
            {!confirmClear
              ? <button type="button" className="secondary" onClick={() => setConfirmClear(true)}>Limpar lote</button>
              : <button type="button" className="secondary" onClick={() => { setEntries([]); setConfirmClear(false); setMessage("Lote apagado."); }}>Confirmar limpeza</button>}
          </div>
        </>
      )}
    </section>
  );
}

import { useState } from "react";

type Suggestion = {
  key: string;
  bucket: number;
  predictedRing: number;
  samples: number;
  averageOffset: number;
  medianOffset: number;
  suggestedOffset: number;
  confidence: number;
  appliedOffset: number | null;
};

type Props = {
  measurement: { widthMm: number; ringSize: number };
  calibrationConfidence: number;
  zoom: number;
  onRulesChanged: () => Promise<void>;
};

const endpoint = "/.netlify/functions/calibration";

export default function AdminCalibration({ measurement, calibrationConfidence, zoom, onRulesChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [actualRing, setActualRing] = useState(measurement.ringSize);
  const [finger, setFinger] = useState("anelar");
  const [hand, setHand] = useState("direita");
  const [note, setNote] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [testsCount, setTestsCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const request = async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível acessar o banco.");
    return data;
  };

  const login = async () => {
    setBusy(true); setMessage("");
    try {
      const data = await request({ action: "list" });
      setAuthenticated(true);
      setSuggestions(data.suggestions || []);
      setTestsCount(data.tests?.length || 0);
      setMessage("Modo administrador liberado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha no acesso."); }
    finally { setBusy(false); }
  };

  const saveTest = async () => {
    setBusy(true); setMessage("");
    try {
      const data = await request({
        action: "add-test",
        widthMm: measurement.widthMm,
        predictedRing: measurement.ringSize,
        actualRing,
        calibrationConfidence,
        zoom,
        finger,
        hand,
        note,
      });
      setSuggestions(data.suggestions || []);
      setTestsCount(data.tests?.length || 0);
      setNote("");
      setMessage(`Teste armazenado: previsto ${measurement.ringSize}, confirmado ${actualRing}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao armazenar."); }
    finally { setBusy(false); }
  };

  const applyRule = async (key: string) => {
    setBusy(true); setMessage("");
    try {
      const data = await request({ action: "apply-rule", key });
      setSuggestions(data.suggestions || []);
      await onRulesChanged();
      setMessage("Correção aprovada e aplicada ao cálculo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao aplicar."); }
    finally { setBusy(false); }
  };

  if (!open) return <button className="admin-entry" type="button" onClick={() => setOpen(true)}>Área de calibração</button>;

  return (
    <section className="admin-calibration">
      <div className="admin-title"><div><span>ACESSO RESTRITO</span><strong>Calibração inteligente</strong></div><button type="button" onClick={() => setOpen(false)}>×</button></div>
      {!authenticated ? (
        <div className="admin-login">
          <label>PIN do administrador</label>
          <input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" placeholder="Digite seu PIN" />
          <button className="primary" type="button" disabled={busy || !pin} onClick={() => void login()}>{busy ? "Entrando..." : "Entrar"}</button>
        </div>
      ) : (
        <>
          <div className="admin-current"><span>Leitura atual</span><strong>{measurement.widthMm.toFixed(1)} mm · aro {measurement.ringSize}</strong></div>
          <div className="admin-fields">
            <label>Aro real confirmado<input type="number" min="1" max="40" value={actualRing} onChange={(event) => setActualRing(Number(event.target.value))} /></label>
            <label>Dedo<select value={finger} onChange={(event) => setFinger(event.target.value)}><option>anelar</option><option>médio</option><option>indicador</option><option>mínimo</option><option>polegar</option></select></label>
            <label>Mão<select value={hand} onChange={(event) => setHand(event.target.value)}><option>direita</option><option>esquerda</option></select></label>
            <label className="wide">Observação opcional<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: medido com aneleira" /></label>
          </div>
          <button className="primary" type="button" disabled={busy || actualRing < 1 || actualRing > 40} onClick={() => void saveTest()}>{busy ? "Armazenando..." : "Armazenar teste"}</button>
          <div className="learning-summary"><strong>{testsCount} testes armazenados</strong><span>As sugestões ficam separadas por aro calculado e faixa de 0,5 mm.</span></div>
          {suggestions.length > 0 && <div className="suggestion-list">{suggestions.map((item) => (
            <article key={item.key} className={item.appliedOffset !== null ? "applied" : ""}>
              <div><strong>{item.bucket.toFixed(1)} mm · aro atual {item.predictedRing}</strong><span>{item.samples} teste(s) · média {item.averageOffset >= 0 ? "+" : ""}{item.averageOffset} · confiança {item.confidence}%</span></div>
              <b>Sugestão: {item.suggestedOffset >= 0 ? "+" : ""}{item.suggestedOffset} aro(s)</b>
              {item.appliedOffset === item.suggestedOffset ? <em>Aplicada</em> : <button type="button" disabled={busy} onClick={() => void applyRule(item.key)}>Aplicar</button>}
            </article>
          ))}</div>}
        </>
      )}
      {message && <p className="admin-message">{message}</p>}
    </section>
  );
}

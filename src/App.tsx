import { useEffect, useRef, useState } from "react";
import { detectCard, type CardAnalysis } from "./vision";

type Stage = "intro" | "camera" | "review";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CardAnalysis | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (stage !== "camera" || !videoRef.current || !streamRef.current) return;

    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {
      setError("A câmera abriu, mas o vídeo não iniciou. Toque novamente em Abrir câmera.");
    });
  }, [stage]);

  const openCamera = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite acesso à câmera.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setStage("camera");
    } catch {
      setError("Não foi possível abrir a câmera. Autorize o acesso e tente novamente.");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1200;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const targetRatio = canvas.width / canvas.height;
    const sourceRatio = sourceWidth / sourceHeight;
    let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.92));
    stopCamera();
    setStage("review");
  };

  const analyze = async () => {
    setAnalyzing(true);
    setError("");
    setAnalysis(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const result = await detectCard(photo);
      setAnalysis(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || "Erro desconhecido");
      setError(`Não foi possível analisar: ${message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <main className="app">
      <header className="brand">
        <span className="mark">◇</span>
        <div><strong>Medidor de Anel</strong><small>Visão computacional</small></div>
      </header>

      {stage === "intro" && (
        <section className="panel intro">
          <span className="step">PASSO 1 DE 2</span>
          <h1>Descubra seu aro usando a câmera</h1>
          <p className="lead">Vire a palma para cima e deixe o cartão inteiro ao lado da mão, sem cobrir a palma. O sistema identificará automaticamente o dedo anelar.</p>
          <div className="example" aria-label="Exemplo de posicionamento">
            <div className="hand-example"><span className="ex-index">INDICADOR</span><span className="ex-middle" /><span className="ex-ring">ANELAR</span><span className="ex-pinky" /></div>
            <div className="card vertical"><span className="chip" /><small>CARTÃO</small></div>
          </div>
          <ul className="tips">
            <li>Use boa iluminação e evite sombras.</li>
            <li>Mantenha a palma aberta e os dedos esticados.</li>
            <li>Coloque o cartão ao lado da mão, sem cobrir a palma ou os dedos.</li>
            <li>Deixe os quatro cantos do cartão visíveis.</li>
            <li>Fotografe completamente de cima.</li>
          </ul>
          <button className="primary" onClick={openCamera}>Abrir câmera</button>
          {error && <p className="error">{error}</p>}
          <p className="privacy">A fotografia é processada no seu aparelho.</p>
        </section>
      )}

      {stage === "camera" && (
        <section className="camera-screen">
          <div className="camera-top">
            <button className="icon-button" onClick={() => { stopCamera(); setStage("intro"); }}>×</button>
            <span>Enquadre a mão e o cartão</span>
          </div>
          <div className="viewport">
            <video ref={videoRef} playsInline muted />
            <div className="live-hint">Palma livre • cartão inteiro ao lado da mão</div>
          </div>
          <p>Palma completamente livre • cartão inteiro ao lado</p>
          <button className="shutter" onClick={capture} aria-label="Tirar fotografia"><span /></button>
        </section>
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">PASSO 2 DE 2</span>
          <h1>A foto ficou nítida?</h1>
          <div className="preview">{photo && <img src={analysis?.annotatedPhoto || photo} alt="Fotografia capturada" />}</div>
          {analysis && <div className="analysis-result">
            <strong>Aro provável: {analysis.ringSize}</strong>
            <span>Faixa inicial: aro {analysis.ringRange[0]} a {analysis.ringRange[1]}</span>
            <span>Largura detectada do dedo: {analysis.fingerWidthMm.toFixed(1)} mm</span>
            <span>Circunferência estimada: {analysis.circumferenceMm.toFixed(1)} mm</span>
            <span>Escala: {analysis.pixelsPerMm.toFixed(2)} pixels/mm • confiança do cartão: {analysis.confidence}%</span>
          </div>}
          <div className="review-actions">
            <button className="secondary" onClick={() => { setPhoto(""); setAnalysis(null); setError(""); void openCamera(); }}>Tirar outra</button>
            <button type="button" className="primary" disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "Analisando, aguarde..." : analysis ? "Analisar novamente" : "Usar esta foto"}</button>
          </div>
          {analyzing && <p className="analysis-loading">Carregando visão computacional e procurando o cartão…</p>}
          {error && <p className="error">{error}</p>}
          <p className="pending">{analysis ? "Estimativa experimental: confirme o resultado com uma aneleira para calibrarmos a precisão." : "O sistema reconhecerá o cartão, a mão e o dedo anelar automaticamente."}</p>
        </section>
      )}
    </main>
  );
}

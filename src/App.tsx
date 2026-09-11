import { useEffect, useMemo, useRef, useState } from "react";
import { calibratePhoto, type CardCalibration } from "./vision";

type Stage = "intro" | "camera" | "review";
type DragTarget = "left" | "right" | "height" | null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [calibration, setCalibration] = useState<CardCalibration | null>(null);
  const [leftLine, setLeftLine] = useState(25);
  const [rightLine, setRightLine] = useState(38);
  const [measureY, setMeasureY] = useState(50);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (stage !== "camera" || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError("A câmera não iniciou. Toque novamente em Abrir câmera."));
  }, [stage]);

  const openCamera = async () => {
    setError("");
    setCalibration(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite acesso à câmera.");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
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
    const targetRatio = canvas.width / canvas.height;
    const sourceRatio = video.videoWidth / video.videoHeight;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) {
      sw = video.videoHeight * targetRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / targetRatio;
      sy = (video.videoHeight - sh) / 2;
    }
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.94));
    stopCamera();
    setStage("review");
  };

  const prepareMeasurement = async () => {
    setAnalyzing(true);
    setError("");
    try {
      const result = await calibratePhoto(photo);
      setCalibration(result);
      setLeftLine(25);
      setRightLine(38);
      setMeasureY(50);
    } catch (err) {
      setError(`Não foi possível calibrar: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !measureRef.current) return;
    const rect = measureRef.current.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 2, 98);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 92);
    if (draggingRef.current === "left") setLeftLine(Math.min(x, rightLine - 3));
    if (draggingRef.current === "right") setRightLine(Math.max(x, leftLine + 3));
    if (draggingRef.current === "height") setMeasureY(y);
  };

  const startDrag = (target: DragTarget, event: React.PointerEvent) => {
    draggingRef.current = target;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDrag(event.clientX, event.clientY);
  };

  const result = useMemo(() => {
    if (!calibration) return null;
    const widthPx = Math.abs(rightLine - leftLine) / 100 * 900;
    const widthMm = widthPx / calibration.pixelsPerMm;
    const circumferenceMm = Math.PI * (widthMm + 0.4);
    const ringSize = clamp(Math.round(circumferenceMm - 40), 5, 40);
    return { widthMm, circumferenceMm, ringSize };
  }, [calibration, leftLine, rightLine]);

  const resetPhoto = () => {
    setPhoto("");
    setCalibration(null);
    setError("");
    void openCamera();
  };

  return (
    <main className="app">
      <header className="brand">
        <span className="mark">◇</span>
        <div><strong>Medidor de Anel</strong><small>Paquímetro digital</small></div>
      </header>

      {stage === "intro" && (
        <section className="panel intro">
          <span className="step">MEDIÇÃO MANUAL ASSISTIDA</span>
          <h1>Marque as bordas do dedo</h1>
          <p className="lead">Fotografe o dedo e um cartão sobre a mesma superfície. Depois, arraste duas linhas até as laterais do dedo no local da aliança.</p>
          <div className="manual-example" aria-label="Duas linhas marcando as laterais do dedo">
            <div className="example-finger" />
            <i className="example-line example-left" />
            <i className="example-line example-right" />
            <i className="example-cross" />
          </div>
          <ul className="tips">
            <li>Cartão e dedo devem estar apoiados na mesma superfície.</li>
            <li>Fotografe de cima e deixe o cartão inteiro visível.</li>
            <li>Você escolherá exatamente o ponto e as bordas da medição.</li>
          </ul>
          <button className="primary" onClick={openCamera}>Abrir câmera</button>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {stage === "camera" && (
        <section className="camera-screen">
          <div className="camera-top">
            <button className="icon-button" onClick={() => { stopCamera(); setStage("intro"); }}>×</button>
            <span>Fotografe de cima</span>
          </div>
          <div className="viewport"><video ref={videoRef} playsInline muted /></div>
          <p>Cartão inteiro ao lado do dedo • ambos apoiados</p>
          <button className="shutter" onClick={capture} aria-label="Tirar fotografia"><span /></button>
        </section>
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">AJUSTE DA MEDIDA</span>
          <h1>{calibration ? "Encaixe as linhas no dedo" : "A foto ficou nítida?"}</h1>
          <div
            ref={measureRef}
            className={`measurement-stage${calibration ? " is-active" : ""}`}
            onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
            onPointerUp={() => { draggingRef.current = null; }}
            onPointerCancel={() => { draggingRef.current = null; }}
          >
            {photo && <img src={photo} alt="Fotografia para medição" draggable={false} />}
            {calibration && (
              <>
                <div className="card-detected" style={{ left: `${calibration.cardBox.x * 100}%`, top: `${calibration.cardBox.y * 100}%`, width: `${calibration.cardBox.width * 100}%`, height: `${calibration.cardBox.height * 100}%` }}><span>CARTÃO</span></div>
                <button className="caliper-line left" style={{ left: `${leftLine}%`, top: `${measureY - 10}%` }} onPointerDown={(event) => startDrag("left", event)} aria-label="Mover linha esquerda"><span /></button>
                <button className="caliper-line right" style={{ left: `${rightLine}%`, top: `${measureY - 10}%` }} onPointerDown={(event) => startDrag("right", event)} aria-label="Mover linha direita"><span /></button>
                <button className="measure-cross" style={{ left: `${leftLine}%`, top: `${measureY}%`, width: `${rightLine - leftLine}%` }} onPointerDown={(event) => startDrag("height", event)} aria-label="Mover altura da medição"><span>ARRASTE</span></button>
              </>
            )}
          </div>

          {calibration && result && (
            <div className="analysis-result">
              <strong>Aro provável: {result.ringSize}</strong>
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 5, 40)} a {clamp(result.ringSize + 1, 5, 40)}</span>
              <span>Largura marcada: {result.widthMm.toFixed(1)} mm</span>
              <span>Circunferência estimada: {result.circumferenceMm.toFixed(1)} mm</span>
              <span>Calibração do cartão: {calibration.confidence}%</span>
            </div>
          )}

          <div className="review-actions">
            <button className="secondary" onClick={resetPhoto}>Tirar outra</button>
            <button className="primary" disabled={analyzing} onClick={() => void prepareMeasurement()}>{analyzing ? "Calibrando..." : calibration ? "Recalibrar cartão" : "Usar esta foto"}</button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="pending">{calibration ? "Arraste as duas linhas para as bordas do dedo e a linha horizontal para a altura exata da aliança." : "O cartão será usado somente para transformar a distância entre as linhas em milímetros."}</p>
        </section>
      )}
    </main>
  );
}

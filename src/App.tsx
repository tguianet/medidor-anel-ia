import { useEffect, useMemo, useRef, useState } from "react";

type Stage = "intro" | "camera" | "review";
type MeasurePhase = "card" | "finger";
type DragTarget = "left" | "right" | "height" | "card-tl" | "card-tr" | "card-bl" | "card-br" | "card-move" | "pan" | null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<MeasurePhase>("card");
  const [pixelsPerMm, setPixelsPerMm] = useState<number | null>(null);
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [cardLeft, setCardLeft] = useState(15);
  const [cardTop, setCardTop] = useState(35);
  const [cardRight, setCardRight] = useState(85);
  const [cardBottom, setCardBottom] = useState(58);
  const [leftLine, setLeftLine] = useState(25);
  const [rightLine, setRightLine] = useState(38);
  const [measureY, setMeasureY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

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
    setPixelsPerMm(null);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
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
    setCardLeft(15);
    setCardTop(35);
    setCardRight(85);
    setCardBottom(58);
    setPixelsPerMm(null);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
    stopCamera();
    setStage("review");
  };

  const confirmCard = () => {
    const widthPx = (cardRight - cardLeft) / 100 * 900;
    const heightPx = (cardBottom - cardTop) / 100 * 1200;
    const longPx = Math.max(widthPx, heightPx);
    const shortPx = Math.min(widthPx, heightPx);
    const ratio = longPx / shortPx;
    if (ratio < 1.38 || ratio > 1.82) {
      setError("O retângulo ainda não está encaixado no cartão. Ajuste os quatro cantos amarelos exatamente nas bordas.");
      return;
    }
    const longScale = longPx / 85.6;
    const shortScale = shortPx / 53.98;
    const disagreement = Math.abs(longScale - shortScale) / ((longScale + shortScale) / 2);
    setPixelsPerMm((longScale + shortScale) / 2);
    setCalibrationConfidence(clamp(Math.round(100 - disagreement * 180), 60, 99));
    setLeftLine(25);
    setRightLine(38);
    setMeasureY(64);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setError("");
    setPhase("finger");
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !measureRef.current) return;
    const rect = measureRef.current.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 2, 98);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 92);
    const target = draggingRef.current;
    if (target === "left") setLeftLine(Math.min(x, rightLine - 3));
    if (target === "right") setRightLine(Math.max(x, leftLine + 3));
    if (target === "height") setMeasureY(y);
    if (target === "card-tl") { setCardLeft(Math.min(x, cardRight - 5)); setCardTop(Math.min(y, cardBottom - 4)); }
    if (target === "card-tr") { setCardRight(Math.max(x, cardLeft + 5)); setCardTop(Math.min(y, cardBottom - 4)); }
    if (target === "card-bl") { setCardLeft(Math.min(x, cardRight - 5)); setCardBottom(Math.max(y, cardTop + 4)); }
    if (target === "card-br") { setCardRight(Math.max(x, cardLeft + 5)); setCardBottom(Math.max(y, cardTop + 4)); }
    if (target === "card-move") {
      const dx = ((clientX - dragStartRef.current.x) / rect.width) * 100;
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      const width = dragStartRef.current.right - dragStartRef.current.left;
      const height = dragStartRef.current.bottom - dragStartRef.current.top;
      const nextLeft = clamp(dragStartRef.current.left + dx, 1, 99 - width);
      const nextTop = clamp(dragStartRef.current.top + dy, 1, 99 - height);
      setCardLeft(nextLeft); setCardRight(nextLeft + width);
      setCardTop(nextTop); setCardBottom(nextTop + height);
    }
    if (target === "pan") {
      const maxX = (zoom - 1) * rect.width / 2;
      const maxY = (zoom - 1) * rect.height / 2;
      setPanX(clamp(dragStartRef.current.left + clientX - dragStartRef.current.x, -maxX, maxX));
      setPanY(clamp(dragStartRef.current.top + clientY - dragStartRef.current.y, -maxY, maxY));
    }
  };

  const startDrag = (target: DragTarget, event: React.PointerEvent) => {
    event.stopPropagation();
    draggingRef.current = target;
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: cardLeft, top: cardTop, right: cardRight, bottom: cardBottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDrag(event.clientX, event.clientY);
  };

  const startPan = (event: React.PointerEvent) => {
    if (phase !== "finger" || zoom <= 1) return;
    draggingRef.current = "pan";
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: panX, top: panY, right: 0, bottom: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const changeZoom = (nextZoom: number) => {
    const value = clamp(nextZoom, 1, 4);
    setZoom(value);
    if (value === 1) { setPanX(0); setPanY(0); }
  };

  const result = useMemo(() => {
    if (!pixelsPerMm) return null;
    const widthPx = Math.abs(rightLine - leftLine) / 100 * 900 / zoom;
    const widthMm = widthPx / pixelsPerMm;
    const circumferenceMm = Math.PI * (widthMm + 0.4);
    const ringSize = clamp(Math.round(circumferenceMm - 40), 5, 40);
    return { widthMm, circumferenceMm, ringSize };
  }, [pixelsPerMm, leftLine, rightLine, zoom]);

  const resetPhoto = () => {
    setPhoto("");
    setPixelsPerMm(null);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
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
          <p className="lead">Coloque o cartão atravessado sobre os dedos e fotografe de cima. Primeiro encaixe o retângulo no cartão; depois ajuste as linhas no dedo.</p>
          <div className="manual-example" aria-label="Duas linhas marcando as laterais do dedo">
            <div className="example-finger" />
            <i className="example-line example-left" />
            <i className="example-line example-right" />
            <i className="example-cross" />
          </div>
          <ul className="tips">
            <li>Coloque o cartão sobre os dedos para ficar na mesma distância da câmera.</li>
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
          <p>Cartão inteiro sobre os dedos • câmera paralela</p>
          <button className="shutter" onClick={capture} aria-label="Tirar fotografia"><span /></button>
        </section>
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">{phase === "card" ? "1. CALIBRE O CARTÃO" : "2. MEÇA O DEDO"}</span>
          <h1>{phase === "card" ? "Encaixe o retângulo no cartão" : "Encaixe as linhas no dedo"}</h1>
          <div
            ref={measureRef}
            className="measurement-stage is-active"
            onPointerDown={startPan}
            onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
            onPointerUp={() => { draggingRef.current = null; }}
            onPointerCancel={() => { draggingRef.current = null; }}
          >
            {photo && <img className={phase === "finger" ? "zoomable-photo" : ""} style={phase === "finger" ? { transform: `translate(${panX}px, ${panY}px) scale(${zoom})` } : undefined} src={photo} alt="Fotografia para medição" draggable={false} />}
            {phase === "card" && (
              <div className="card-calibrator" style={{ left: `${cardLeft}%`, top: `${cardTop}%`, width: `${cardRight - cardLeft}%`, height: `${cardBottom - cardTop}%` }}>
                <button className="card-move" onPointerDown={(event) => startDrag("card-move", event)} aria-label="Mover retângulo do cartão">CARTÃO</button>
                <button className="card-corner tl" onPointerDown={(event) => startDrag("card-tl", event)} aria-label="Ajustar canto superior esquerdo" />
                <button className="card-corner tr" onPointerDown={(event) => startDrag("card-tr", event)} aria-label="Ajustar canto superior direito" />
                <button className="card-corner bl" onPointerDown={(event) => startDrag("card-bl", event)} aria-label="Ajustar canto inferior esquerdo" />
                <button className="card-corner br" onPointerDown={(event) => startDrag("card-br", event)} aria-label="Ajustar canto inferior direito" />
              </div>
            )}
            {phase === "finger" && pixelsPerMm && (
              <>
                <button className="caliper-line left" style={{ left: `${leftLine}%`, top: `${measureY - 10}%` }} onPointerDown={(event) => startDrag("left", event)} aria-label="Mover linha esquerda"><span /></button>
                <button className="caliper-line right" style={{ left: `${rightLine}%`, top: `${measureY - 10}%` }} onPointerDown={(event) => startDrag("right", event)} aria-label="Mover linha direita"><span /></button>
                <button className="measure-cross" style={{ left: `${leftLine}%`, top: `${measureY}%`, width: `${rightLine - leftLine}%` }} onPointerDown={(event) => startDrag("height", event)} aria-label="Mover altura da medição"><span>ARRASTE</span></button>
              </>
            )}
          </div>

          {phase === "finger" && (
            <div className="zoom-controls" aria-label="Controles de zoom">
              <button onClick={() => changeZoom(zoom - 0.5)} disabled={zoom <= 1} aria-label="Diminuir zoom">−</button>
              <strong>{zoom.toFixed(1)}×</strong>
              <button onClick={() => changeZoom(zoom + 0.5)} disabled={zoom >= 4} aria-label="Aumentar zoom">+</button>
              <button className="zoom-reset" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}>Redefinir</button>
            </div>
          )}

          {phase === "finger" && result && (
            <div className="analysis-result">
              <strong>Aro provável: {result.ringSize}</strong>
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 5, 40)} a {clamp(result.ringSize + 1, 5, 40)}</span>
              <span>Largura marcada: {result.widthMm.toFixed(1)} mm</span>
              <span>Circunferência estimada: {result.circumferenceMm.toFixed(1)} mm</span>
              <span>Calibração do cartão: {calibrationConfidence}%</span>
            </div>
          )}

          <div className="review-actions">
            <button className="secondary" onClick={resetPhoto}>Tirar outra</button>
            {phase === "card" ? <button className="primary" onClick={confirmCard}>Confirmar cartão</button> : <button className="primary" onClick={() => { setPhase("card"); setPixelsPerMm(null); }}>Recalibrar cartão</button>}
          </div>
          {error && <p className="error">{error}</p>}
          <p className="pending">{phase === "card" ? "Arraste os quatro cantos amarelos até coincidirem com as quatro bordas reais do cartão." : "Use + para ampliar, arraste a foto para centralizar e depois encaixe as linhas nas bordas do dedo."}</p>
        </section>
      )}
    </main>
  );
}

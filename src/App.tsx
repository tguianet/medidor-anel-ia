import { useEffect, useMemo, useRef, useState } from "react";
import { calibratePhoto } from "./vision";

type Stage = "intro" | "camera" | "review";
type MeasurePhase = "card" | "finger";
type DragTarget = "left" | "right" | "height" | "card-tl" | "card-tr" | "card-bl" | "card-br" | "card-move" | "pan" | null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const RING_DIAMETER_TABLE = [
  { size: 10, diameterMm: 15.0 }, { size: 11, diameterMm: 15.1 },
  { size: 12, diameterMm: 15.2 }, { size: 13, diameterMm: 16.0 },
  { size: 14, diameterMm: 16.1 }, { size: 15, diameterMm: 17.0 },
  { size: 16, diameterMm: 17.1 }, { size: 17, diameterMm: 17.2 },
  { size: 18, diameterMm: 17.5 }, { size: 19, diameterMm: 18.0 },
  { size: 20, diameterMm: 18.5 }, { size: 21, diameterMm: 18.8 },
  { size: 22, diameterMm: 19.0 }, { size: 23, diameterMm: 19.2 },
  { size: 24, diameterMm: 19.9 }, { size: 25, diameterMm: 20.0 },
  { size: 26, diameterMm: 20.5 }, { size: 27, diameterMm: 20.8 },
  { size: 28, diameterMm: 21.1 }, { size: 29, diameterMm: 21.2 },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const photoPixelsRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
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
  const [leftLocked, setLeftLocked] = useState(false);
  const [rightLocked, setRightLocked] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [analyzingCard, setAnalyzingCard] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!photo) { photoPixelsRef.current = null; return; }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(image, 0, 0);
      const imageData = context?.getImageData(0, 0, canvas.width, canvas.height);
      if (imageData) photoPixelsRef.current = { data: imageData.data, width: canvas.width, height: canvas.height };
    };
    image.src = photo;
  }, [photo]);
  useEffect(() => {
    if (stage !== "camera" || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError("A câmera não iniciou. Toque novamente em Abrir câmera."));
  }, [stage]);

  const openCamera = async () => {
    setError("");
    setPixelsPerMm(null);
    setCalibrationConfidence(0);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite acesso à câmera.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(Boolean(capabilities?.torch));
      setStage("camera");
    } catch {
      setError("Não foi possível abrir a câmera. Autorize o acesso e tente novamente.");
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }] });
      setTorchOn(next);
      setError("");
    } catch {
      setError("A lanterna não pôde ser ativada neste navegador.");
      setTorchSupported(false);
    }
  };

  const capture = async () => {
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
    const capturedPhoto = canvas.toDataURL("image/jpeg", 0.94);
    setPhoto(capturedPhoto);
    setPixelsPerMm(null);
    setCalibrationConfidence(0);
    setPhase("finger");
    setLeftLine(37);
    setRightLine(63);
    setMeasureY(64);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    stopCamera();
    setStage("review");
    setError("");
    setAnalyzingCard(true);
    try {
      const calibration = await calibratePhoto(capturedPhoto);
      const cardCenterX = calibration.cardBox.x + calibration.cardBox.width / 2;
      const cardCenterY = calibration.cardBox.y + calibration.cardBox.height / 2;
      const cardIsInsideGuide =
        Math.abs(cardCenterX - 0.5) <= 0.1 &&
        Math.abs(cardCenterY - 0.285) <= 0.11 &&
        calibration.cardBox.width >= 0.6 &&
        calibration.cardBox.width <= 0.94 &&
        calibration.cardBox.height >= 0.25 &&
        calibration.cardBox.height <= 0.5 &&
        calibration.pixelsPerMm >= 6.2 &&
        calibration.pixelsPerMm <= 10.5;
      if (!cardIsInsideGuide) {
        throw new Error("O cartão não está encaixado corretamente na moldura. Centralize as quatro bordas do cartão e tire outra foto.");
      }
      setPixelsPerMm(calibration.pixelsPerMm);
      setCalibrationConfidence(calibration.confidence);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível reconhecer o cartão automaticamente.");
    } finally {
      setAnalyzingCard(false);
    }
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
    setLeftLocked(false);
    setRightLocked(false);
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !measureRef.current) return;
    const rect = measureRef.current.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 2, 98);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 92);
    const target = draggingRef.current;
    if (target === "left") { setLeftLocked(false); setLeftLine(Math.min(x, rightLine - 3)); }
    if (target === "right") { setRightLocked(false); setRightLine(Math.max(x, leftLine + 3)); }
    if (target === "height") {
      setLeftLocked(false);
      setRightLocked(false);
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      setMeasureY(clamp(dragStartRef.current.right + dy, 18, 76));
    }
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
      setLeftLocked(false);
      setRightLocked(false);
      const maxX = (zoom - 1) * rect.width / 2;
      const maxY = (zoom - 1) * rect.height / 2;
      setPanX(clamp(dragStartRef.current.left + clientX - dragStartRef.current.x, -maxX, maxX));
      setPanY(clamp(dragStartRef.current.top + clientY - dragStartRef.current.y, -maxY, maxY));
    }
  };

  const startDrag = (target: DragTarget, event: React.PointerEvent) => {
    event.stopPropagation();
    draggingRef.current = target;
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: cardLeft, top: cardTop, right: target === "height" ? measureY : cardRight, bottom: cardBottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target !== "height" && target !== "card-move") updateDrag(event.clientX, event.clientY);
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
    setLeftLocked(false);
    setRightLocked(false);
    if (value === 1) { setPanX(0); setPanY(0); }
  };

  const snapBoundary = (side: "left" | "right", clientX: number) => {
    const stage = measureRef.current;
    const source = photoPixelsRef.current;
    if (!stage || !source) return;
    const rect = stage.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = measureY / 100 * rect.height;
    const imageX = ((screenX - rect.width / 2 - panX) / zoom + rect.width / 2) / rect.width * source.width;
    const imageY = ((screenY - rect.height / 2 - panY) / zoom + rect.height / 2) / rect.height * source.height;
    const radius = Math.max(8, Math.round(18 / zoom));
    let bestX = Math.round(imageX);
    let bestScore = 0;
    const colorAt = (x: number, y: number) => {
      const offset = (y * source.width + x) * 4;
      return [source.data[offset], source.data[offset + 1], source.data[offset + 2]];
    };
    for (let candidate = Math.round(imageX) - radius; candidate <= Math.round(imageX) + radius; candidate++) {
      if (candidate < 3 || candidate >= source.width - 3) continue;
      let score = 0;
      let samples = 0;
      for (let y = Math.round(imageY) - 7; y <= Math.round(imageY) + 7; y += 2) {
        if (y < 0 || y >= source.height) continue;
        const before = colorAt(candidate - 2, y);
        const after = colorAt(candidate + 2, y);
        score += Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) + Math.abs(before[2] - after[2]);
        samples++;
      }
      score /= Math.max(samples, 1);
      const distancePenalty = Math.abs(candidate - imageX) * 1.2;
      if (score - distancePenalty > bestScore) { bestScore = score - distancePenalty; bestX = candidate; }
    }
    if (bestScore < 24) {
      if (side === "left") setLeftLocked(false); else setRightLocked(false);
      return;
    }
    const snappedScreenX = rect.width / 2 + (bestX / source.width * rect.width - rect.width / 2) * zoom + panX;
    const snappedPercent = clamp(snappedScreenX / rect.width * 100, 2, 98);
    if (side === "left") { setLeftLine(Math.min(snappedPercent, rightLine - 3)); setLeftLocked(true); }
    else { setRightLine(Math.max(snappedPercent, leftLine + 3)); setRightLocked(true); }
  };

  const finishDrag = (event: React.PointerEvent) => {
    const target = draggingRef.current;
    if (target === "left" || target === "right") snapBoundary(target, event.clientX);
    draggingRef.current = null;
  };

  const result = useMemo(() => {
    if (!pixelsPerMm) return null;
    const widthPx = Math.abs(rightLine - leftLine) / 100 * 900 / zoom;
    const widthMm = widthPx / pixelsPerMm;
    const circumferenceMm = Math.PI * widthMm;
    const closestRing = RING_DIAMETER_TABLE.reduce((closest, candidate) =>
      Math.abs(candidate.diameterMm - widthMm) < Math.abs(closest.diameterMm - widthMm) ? candidate : closest
    );
    const ringSize = clamp(closestRing.size - 1, 10, 29);
    return { widthMm, circumferenceMm, ringSize };
  }, [pixelsPerMm, leftLine, rightLine, zoom]);

  const resetPhoto = () => {
    setPhoto("");
    setAnalyzingCard(false);
    setPixelsPerMm(null);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
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
          <h1>Como medir corretamente</h1>
          <p className="lead">Antes de abrir a câmera, coloque um cartão bancário sobre o dedo. O sistema reconhecerá o cartão automaticamente e depois você ajustará as linhas magnéticas nas bordas do dedo.</p>
          <img className="tutorial-image" src="/tutorial-medidor.svg" alt="Passo a passo ilustrado para medir o tamanho do anel" />
          <ul className="tips">
            <li>Use um cartão padrão de 85,60 × 53,98 mm.</li>
            <li>Deixe o cartão inteiro visível na foto, sem cobrir o ponto do anel.</li>
            <li>Mantenha cartão, dedos e câmera paralelos.</li>
            <li>Na câmera, mantenha o dedo reto sobre a linha vertical.</li>
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
          <div className="viewport">
            <video ref={videoRef} playsInline muted />
            {torchSupported && <button type="button" className={`torch-button${torchOn ? " is-on" : ""}`} onClick={() => void toggleTorch()}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>}
            <div className="card-alignment" aria-hidden="true"><span>ENCAIXE O CARTÃO AQUI</span></div>
            <div className="finger-vertical-line" aria-hidden="true"><span>ALINHE O DEDO</span></div>
          </div>
          <p>{torchOn ? "Luz ligada • evite reflexo no cartão" : "Encaixe o cartão na moldura e deixe o dedo reto na linha vertical"}</p>
          <button className="shutter" onClick={() => void capture()} aria-label="Tirar fotografia"><span /></button>
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
            onPointerUp={finishDrag}
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
                <button className={`caliper-line left${leftLocked ? " locked" : ""}`} style={{ left: `${leftLine}%`, top: `${measureY - 16}%` }} onPointerDown={(event) => startDrag("left", event)} aria-label="Mover linha esquerda"><span /></button>
                <button className={`caliper-line right${rightLocked ? " locked" : ""}`} style={{ left: `${rightLine}%`, top: `${measureY - 16}%` }} onPointerDown={(event) => startDrag("right", event)} aria-label="Mover linha direita"><span /></button>
                <button className="measure-cross" style={{ left: `${leftLine}%`, top: `${measureY}%`, width: `${rightLine - leftLine}%` }} onPointerDown={(event) => startDrag("height", event)} aria-label="Mover altura da medição" />
                <button className="measure-height-handle" style={{ left: `${(leftLine + rightLine) / 2}%`, top: `${Math.min(measureY + 19, 95)}%` }} onPointerDown={(event) => startDrag("height", event)}>ARRASTE</button>
              </>
            )}
          </div>

          {analyzingCard && <p className="analysis-loading">Reconhecendo e calibrando o cartão automaticamente...</p>}

          {phase === "finger" && (
            <div className="zoom-controls" aria-label="Controles de zoom">
              <button onClick={() => changeZoom(zoom - 0.5)} disabled={zoom <= 1} aria-label="Diminuir zoom">−</button>
              <strong>{zoom.toFixed(1)}×</strong>
              <button onClick={() => changeZoom(zoom + 0.5)} disabled={zoom >= 4} aria-label="Aumentar zoom">+</button>
              <button className="zoom-reset" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}>Redefinir</button>
            </div>
          )}

          {phase === "finger" && result && leftLocked && rightLocked && (
            <div className="analysis-result">
              <strong>Aro provável: {result.ringSize}</strong>
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 5, 40)} a {clamp(result.ringSize + 1, 5, 40)}</span>
              <span>Largura marcada: {result.widthMm.toFixed(1)} mm</span>
              <span>Circunferência estimada: {result.circumferenceMm.toFixed(1)} mm</span>
              <span>Calibração do cartão: {calibrationConfidence}%</span>
            </div>
          )}
          {phase === "finger" && (!leftLocked || !rightLocked) && <div className="edge-status"><strong>Aproxime e solte cada linha na borda</strong><span>{leftLocked ? "✓ Esquerda travada" : "○ Falta a esquerda"} · {rightLocked ? "✓ Direita travada" : "○ Falta a direita"}</span></div>}

          <div className="review-actions">
            <button className="secondary" onClick={resetPhoto}>Tirar outra</button>
            <button className="primary" type="button" disabled>{analyzingCard ? "Calibrando cartão..." : pixelsPerMm ? "Cartão calibrado" : "Cartão não reconhecido"}</button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="pending">Use + para ampliar, arraste a foto para centralizar e depois encaixe as linhas nas bordas do dedo.</p>
        </section>
      )}
    </main>
  );
}

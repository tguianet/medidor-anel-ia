import { useEffect, useMemo, useRef, useState } from "react";
import { calibratePhoto } from "./vision";
import AdminCalibration from "./AdminCalibration";

type Stage = "intro" | "camera" | "review" | "hand-camera" | "hand-review";
type MeasurePhase = "card" | "finger";
type DragTarget = "left" | "right" | "height" | "card-base-left" | "card-base-right" | "card-base-y" | "pan" | "showcase-ring" | "showcase-left" | "showcase-right" | null;
type RingMetal = "gold" | "silver" | "rose" | "black";
type RingStyle = "classic" | "textured" | "matte" | "grooved" | "stone" | "solitaire";
type MeasurementMode = "finger" | "anelimetro";

const RING_MODELS: { id: RingStyle; label: string }[] = [
  { id: "classic", label: "Lisa" },
  { id: "textured", label: "Diamantada" },
  { id: "matte", label: "Fosca" },
  { id: "grooved", label: "Com friso" },
  { id: "stone", label: "Com pedra" },
  { id: "solitaire", label: "Solitária" },
];
const ringImage = (style: RingStyle) => `/rings/${style}.svg?v=20260913-2`;
const wearableRingImage = (style: RingStyle) => `/rings-wear/${style}.svg?v=20260913-2`;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cardMatchesLiveGuide = (video: HTMLVideoElement) => {
  if (!video.videoWidth || !video.videoHeight) return false;
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 400;
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
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const grayAt = (x: number, y: number) => {
    const offset = (Math.round(y) * canvas.width + Math.round(x)) * 4;
    return pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
  };
  const left = canvas.width * 0.11;
  const right = canvas.width * 0.89;
  const top = canvas.height * 0.1;
  const bottom = top + (canvas.width * 0.78) / 1.586;
  const verticalScore = (x: number, insideDirection: number) => {
    let total = 0;
    let count = 0;
    let continuous = 0;
    for (let y = top + 12; y <= bottom - 12; y += 5) {
      const difference = Math.abs(grayAt(x + insideDirection * 4, y) - grayAt(x - insideDirection * 4, y));
      total += difference;
      if (difference >= 12) continuous++;
      count++;
    }
    const average = total / Math.max(1, count);
    const coverage = continuous / Math.max(1, count);
    return average * (0.35 + coverage * 0.65);
  };
  const horizontalScore = (y: number, insideDirection: number) => {
    let total = 0;
    let count = 0;
    let continuous = 0;
    for (let x = left + 14; x <= right - 14; x += 5) {
      const difference = Math.abs(grayAt(x, y + insideDirection * 4) - grayAt(x, y - insideDirection * 4));
      total += difference;
      if (difference >= 12) continuous++;
      count++;
    }
    const average = total / Math.max(1, count);
    const coverage = continuous / Math.max(1, count);
    return average * (0.35 + coverage * 0.65);
  };
  const bestNear = (position: number, score: (value: number) => number) => {
    let best = 0;
    for (let shift = -9; shift <= 9; shift += 3) best = Math.max(best, score(position + shift));
    return best;
  };
  const scores = [
    bestNear(left, (value) => verticalScore(value, 1)),
    bestNear(right, (value) => verticalScore(value, -1)),
    bestNear(bottom, (value) => horizontalScore(value, -1)),
  ];
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return scores.every((score) => score >= 14) && average >= 17;
};
// Tabela de diâmetro interno informada pelo anelímetro. Ela corresponde à
// numeração brasileira e evita aproximações que deslocariam aros altos.
const RING_DIAMETER_TABLE = [
  { size: 1, diameterMm: 13.05 }, { size: 2, diameterMm: 13.37 },
  { size: 3, diameterMm: 13.68 }, { size: 4, diameterMm: 14.01 },
  { size: 5, diameterMm: 14.32 }, { size: 6, diameterMm: 14.64 },
  { size: 7, diameterMm: 14.95 }, { size: 8, diameterMm: 15.28 },
  { size: 9, diameterMm: 15.60 }, { size: 10, diameterMm: 15.92 },
  { size: 11, diameterMm: 16.24 }, { size: 12, diameterMm: 16.55 },
  { size: 13, diameterMm: 16.87 }, { size: 14, diameterMm: 17.19 },
  { size: 15, diameterMm: 17.50 }, { size: 16, diameterMm: 17.83 },
  { size: 17, diameterMm: 18.14 }, { size: 18, diameterMm: 18.46 },
  { size: 19, diameterMm: 18.76 }, { size: 20, diameterMm: 19.10 },
  { size: 21, diameterMm: 19.42 }, { size: 22, diameterMm: 19.77 },
  { size: 23, diameterMm: 20.05 }, { size: 24, diameterMm: 20.37 },
  { size: 25, diameterMm: 20.68 }, { size: 26, diameterMm: 21.04 },
  { size: 27, diameterMm: 21.37 }, { size: 28, diameterMm: 21.68 },
  { size: 29, diameterMm: 21.96 }, { size: 30, diameterMm: 22.28 },
  { size: 31, diameterMm: 22.60 }, { size: 32, diameterMm: 22.92 },
  { size: 33, diameterMm: 23.24 }, { size: 34, diameterMm: 23.55 },
  { size: 35, diameterMm: 23.87 }, { size: 36, diameterMm: 24.19 },
  { size: 37, diameterMm: 24.51 }, { size: 38, diameterMm: 24.83 },
  { size: 39, diameterMm: 25.15 }, { size: 40, diameterMm: 25.46 },
];
// Conversão 2D calibrada por medições reais de largura marcada e diâmetro
// interno confirmado do aro. Não usa estimativa de volume/formato do dedo.
const INNER_DIAMETER_SLOPE = 0.873;
const INNER_DIAMETER_OFFSET_MM = 1.73;
// Margem fixa de conforto: o aro técnico é elevado em um número para que a
// indicação final não fique apertada no dedo.
const COMFORT_RING_OFFSET = 1;
const estimateInnerDiameter = (measuredWidthMm: number) => (
  measuredWidthMm * INNER_DIAMETER_SLOPE + INNER_DIAMETER_OFFSET_MM
);

// Pontos confirmados manualmente em dedo real. Eles representam o ajuste de
// conforto: a aliança precisa ficar firme, sem risco de cair. Não usamos dados
// do anelímetro aqui — ele continua apenas como instrumento de validação.
const REAL_FIT_REFERENCES = [
  { minWidthMm: 21.45, maxWidthMm: 21.75, ringSize: 24 },
  { minWidthMm: 25.80, maxWidthMm: 26.20, ringSize: 32 },
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
  const [cardRight, setCardRight] = useState(85);
  const [cardBottom, setCardBottom] = useState(58);
  const [cardLeftLocked, setCardLeftLocked] = useState(false);
  const [cardRightLocked, setCardRightLocked] = useState(false);
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
  const [cameraOpening, setCameraOpening] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [analyzingCard, setAnalyzingCard] = useState(false);
  const [tryOn, setTryOn] = useState(false);
  const [ringMetal, setRingMetal] = useState<RingMetal>("gold");
  const [ringBandWidth, setRingBandWidth] = useState(4);
  const [ringStyle, setRingStyle] = useState<RingStyle>("classic");
  const [handPhoto, setHandPhoto] = useState("");
  const [showcaseX, setShowcaseX] = useState(50);
  const [showcaseY, setShowcaseY] = useState(55);
  const [showcaseWidth, setShowcaseWidth] = useState(24);
  const [showcaseAngle, setShowcaseAngle] = useState(0);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("finger");

  const stopCamera = () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpening(false);
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
    if ((stage !== "camera" && stage !== "hand-camera") || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError("A imagem não iniciou. Toque em Tentar novamente."));
  }, [stage]);
  useEffect(() => {
    if (stage !== "camera" || cameraOpening) {
      setCardReady(false);
      return;
    }
    let running = false;
    const checkAlignment = () => {
      if (running || !videoRef.current) return;
      running = true;
      try { setCardReady(cardMatchesLiveGuide(videoRef.current)); }
      finally { running = false; }
    };
    checkAlignment();
    const interval = window.setInterval(checkAlignment, 450);
    return () => window.clearInterval(interval);
  }, [stage, cameraOpening]);

  const startCameraStream = async (targetStage: "camera" | "hand-camera") => {
    stopCamera();
    setError("");
    setCameraOpening(true);
    setStage(targetStage);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOpening(false);
      setError("Este navegador não permite acesso à câmera. Abra o site no Chrome ou Safari atualizado.");
      return;
    }

    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: true, audio: false },
    ];
    let lastFailure: unknown;

    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(Boolean(capabilities?.torch));
        const video = videoRef.current;
        if (!video) throw new Error("A tela da câmera não ficou pronta.");
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "true");
        await video.play();
        setCameraOpening(false);
        setError("");
        return;
      } catch (reason) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        lastFailure = reason;
      }
    }

    setCameraOpening(false);
    const failureName = lastFailure instanceof DOMException ? lastFailure.name : "";
    if (failureName === "NotAllowedError" || failureName === "SecurityError") {
      setError("A câmera está bloqueada. Libere a permissão nas configurações do navegador e tente novamente.");
    } else if (failureName === "NotReadableError" || failureName === "TrackStartError") {
      setError("A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.");
    } else {
      setError("Não foi possível iniciar a câmera. Toque em Tentar novamente.");
    }
  };

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
    setCardReady(false);
    await startCameraStream("camera");
  };

  const openHandCamera = async () => {
    await startCameraStream("hand-camera");
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      setError("A câmera ainda não está pronta. Aguarde um instante e tente novamente.");
      return;
    }
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }] });
      setTorchOn(next);
      setTorchSupported(true);
      setError("");
    } catch {
      setError("Este celular ou navegador não permite controlar a lanterna pela câmera. Use uma boa iluminação externa.");
      setTorchSupported(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    if (!cardReady) {
      setError("Alinhe a base e as laterais do cartão até a régua ficar verde antes de tirar a foto.");
      return;
    }
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
    setPhase("card");
    setCardLeft(11);
    setCardRight(89);
    setCardBottom(47);
    setCardLeftLocked(false);
    setCardRightLocked(false);
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
      const detectedLeft = clamp(calibration.cardBox.x * 100, 2, 94);
      const detectedRight = clamp((calibration.cardBox.x + calibration.cardBox.width) * 100, 6, 98);
      const finalLeft = Math.min(detectedLeft, detectedRight - 5);
      const finalRight = Math.max(detectedRight, detectedLeft + 5);
      const finalBottom = clamp((calibration.cardBox.y + calibration.cardBox.height) * 100, 10, 78);
      setCardLeft(finalLeft);
      setCardRight(finalRight);
      setCardBottom(finalBottom);
      setCardLeftLocked(true);
      setCardRightLocked(true);
      activateFingerMeasurement(finalLeft, finalRight, finalBottom, calibration.confidence);
      setError("");
    } catch {
      setError("Não consegui travar a base automaticamente. Arraste as duas linhas para os cantos inferiores do cartão.");
    } finally {
      setAnalyzingCard(false);
    }
  };

  const activateFingerMeasurement = (baseLeft: number, baseRight: number, baseBottom: number, confidence = 92) => {
    const widthPx = (baseRight - baseLeft) / 100 * 900;
    setPixelsPerMm(widthPx / 85.6);
    setCalibrationConfidence((current) => Math.max(current, confidence));
    setLeftLine(38);
    setRightLine(62);
    setMeasureY(clamp(baseBottom + 17, 42, 76));
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setError("");
    setPhase("finger");
    setLeftLocked(false);
    setRightLocked(false);
  };

  const captureHand = () => {
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
    setHandPhoto(canvas.toDataURL("image/jpeg", 0.94));
    setShowcaseX(50);
    setShowcaseY(55);
    setShowcaseWidth(24);
    setShowcaseAngle(0);
    stopCamera();
    setStage("hand-review");
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !measureRef.current) return;
    const rect = measureRef.current.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 2, 98);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 92);
    const target = draggingRef.current;
    if (target === "showcase-ring") {
      const dx = ((clientX - dragStartRef.current.x) / rect.width) * 100;
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      setShowcaseX(clamp(dragStartRef.current.left + dx, 5, 95));
      setShowcaseY(clamp(dragStartRef.current.top + dy, 5, 95));
      return;
    }
    if (target === "showcase-left") {
      const fixedRight = showcaseX + showcaseWidth / 2;
      const nextLeft = Math.min(x, fixedRight - 4);
      setShowcaseX((nextLeft + fixedRight) / 2);
      setShowcaseWidth(fixedRight - nextLeft);
      return;
    }
    if (target === "showcase-right") {
      const fixedLeft = showcaseX - showcaseWidth / 2;
      const nextRight = Math.max(x, fixedLeft + 4);
      setShowcaseX((fixedLeft + nextRight) / 2);
      setShowcaseWidth(nextRight - fixedLeft);
      return;
    }
    if (target === "left") { setLeftLocked(false); setLeftLine(Math.min(x, rightLine - 3)); }
    if (target === "right") { setRightLocked(false); setRightLine(Math.max(x, leftLine + 3)); }
    if (target === "height") {
      setLeftLocked(false);
      setRightLocked(false);
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      setMeasureY(clamp(dragStartRef.current.right + dy, 18, 76));
    }
    if (target === "card-base-left") { setCardLeftLocked(false); setCardLeft(Math.min(x, cardRight - 5)); }
    if (target === "card-base-right") { setCardRightLocked(false); setCardRight(Math.max(x, cardLeft + 5)); }
    if (target === "card-base-y") {
      setCardLeftLocked(false);
      setCardRightLocked(false);
      setCardBottom(y);
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
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: cardLeft, top: cardBottom, right: target === "height" ? measureY : cardRight, bottom: cardBottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target !== "height" && target !== "card-base-y") updateDrag(event.clientX, event.clientY);
  };

  const startPan = (event: React.PointerEvent) => {
    if (phase !== "finger" || zoom <= 1 || tryOn) return;
    draggingRef.current = "pan";
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: panX, top: panY, right: 0, bottom: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startShowcaseDrag = (event: React.PointerEvent) => {
    event.stopPropagation();
    draggingRef.current = "showcase-ring";
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: showcaseX, top: showcaseY, right: 0, bottom: 0 };
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
      for (let y = Math.round(imageY) - 16; y <= Math.round(imageY) + 16; y += 4) {
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

  const snapCardBaseEndpoint = (side: "left" | "right", clientX: number) => {
    const stage = measureRef.current;
    const source = photoPixelsRef.current;
    if (!stage || !source) return;
    const rect = stage.getBoundingClientRect();
    const imageX = (clientX - rect.left) / rect.width * source.width;
    const imageY = cardBottom / 100 * source.height;
    const radius = Math.max(12, Math.round(source.width * 0.035));
    let bestX = Math.round(imageX);
    let bestScore = 0;
    const grayAt = (x: number, y: number) => {
      const offset = (y * source.width + x) * 4;
      return source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
    };
    for (let candidate = Math.round(imageX) - radius; candidate <= Math.round(imageX) + radius; candidate++) {
      if (candidate < 3 || candidate >= source.width - 3) continue;
      let score = 0;
      let samples = 0;
      for (let y = Math.round(imageY) - 12; y <= Math.round(imageY) + 4; y += 2) {
        if (y < 0 || y >= source.height) continue;
        score += Math.abs(grayAt(candidate - 2, y) - grayAt(candidate + 2, y));
        samples++;
      }
      score = score / Math.max(samples, 1) - Math.abs(candidate - imageX) * 0.35;
      if (score > bestScore) { bestScore = score; bestX = candidate; }
    }
    if (bestScore < 10) return;
    const snappedPercent = clamp(bestX / source.width * 100, 2, 98);
    if (side === "left") {
      const nextLeft = Math.min(snappedPercent, cardRight - 5);
      setCardLeft(nextLeft);
      setCardLeftLocked(true);
      if (cardRightLocked) activateFingerMeasurement(nextLeft, cardRight, cardBottom);
    } else {
      const nextRight = Math.max(snappedPercent, cardLeft + 5);
      setCardRight(nextRight);
      setCardRightLocked(true);
      if (cardLeftLocked) activateFingerMeasurement(cardLeft, nextRight, cardBottom);
    }
    setError("");
  };

  const snapCardBaseY = (clientY: number) => {
    const stage = measureRef.current;
    const source = photoPixelsRef.current;
    if (!stage || !source) return;
    const rect = stage.getBoundingClientRect();
    const imageY = (clientY - rect.top) / rect.height * source.height;
    const startX = Math.round(cardLeft / 100 * source.width);
    const endX = Math.round(cardRight / 100 * source.width);
    const radius = Math.max(10, Math.round(source.height * 0.025));
    let bestY = Math.round(imageY);
    let bestScore = 0;
    const grayAt = (x: number, y: number) => {
      const offset = (y * source.width + x) * 4;
      return source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
    };
    for (let candidate = Math.round(imageY) - radius; candidate <= Math.round(imageY) + radius; candidate++) {
      if (candidate < 3 || candidate >= source.height - 3) continue;
      let score = 0;
      let samples = 0;
      const step = Math.max(4, Math.round((endX - startX) / 36));
      for (let x = startX + 8; x <= endX - 8; x += step) {
        score += Math.abs(grayAt(x, candidate - 2) - grayAt(x, candidate + 2));
        samples++;
      }
      score = score / Math.max(samples, 1) - Math.abs(candidate - imageY) * 0.25;
      if (score > bestScore) { bestScore = score; bestY = candidate; }
    }
    if (bestScore < 8) return;
    setCardBottom(clamp(bestY / source.height * 100, 8, 92));
    setError("");
  };

  const finishDrag = (event: React.PointerEvent) => {
    const target = draggingRef.current;
    if (target === "left" || target === "right") snapBoundary(target, event.clientX);
    if (target === "card-base-left") snapCardBaseEndpoint("left", event.clientX);
    if (target === "card-base-right") snapCardBaseEndpoint("right", event.clientX);
    if (target === "card-base-y") snapCardBaseY(event.clientY);
    draggingRef.current = null;
  };

  const fingerBandWidthPx = () => {
    const stage = measureRef.current;
    const source = photoPixelsRef.current;
    if (!stage || !source || !leftLocked || !rightLocked) return null;
    const rect = stage.getBoundingClientRect();
    const toImageX = (percent: number) => (
      (((percent / 100 * rect.width) - rect.width / 2 - panX) / zoom + rect.width / 2) / rect.width * source.width
    );
    const imageY = (((measureY / 100 * rect.height) - rect.height / 2 - panY) / zoom + rect.height / 2) / rect.height * source.height;
    const leftCenter = toImageX(leftLine);
    const rightCenter = toImageX(rightLine);
    const searchRadius = Math.max(7, Math.round(18 / zoom));
    const grayscale = (x: number, y: number) => {
      const offset = (y * source.width + x) * 4;
      return source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
    };
    const findEdge = (center: number, y: number) => {
      let bestX = Math.round(center);
      let bestScore = -Infinity;
      for (let x = Math.round(center) - searchRadius; x <= Math.round(center) + searchRadius; x++) {
        if (x < 3 || x >= source.width - 3) continue;
        const contrast = Math.abs(grayscale(x - 2, y) - grayscale(x + 2, y));
        const score = contrast - Math.abs(x - center) * 0.7;
        if (score > bestScore) { bestScore = score; bestX = x; }
      }
      return { x: bestX, score: bestScore };
    };
    const widths: number[] = [];
    for (const offset of [-18, -12, -6, 0, 6, 12, 18]) {
      const y = Math.round(imageY + offset);
      if (y < 3 || y >= source.height - 3) continue;
      const leftEdge = findEdge(leftCenter, y);
      const rightEdge = findEdge(rightCenter, y);
      if (leftEdge.score < 10 || rightEdge.score < 10 || rightEdge.x <= leftEdge.x) continue;
      widths.push(rightEdge.x - leftEdge.x);
    }
    if (widths.length < 4) return null;
    widths.sort((a, b) => a - b);
    return widths[Math.round((widths.length - 1) * 0.65)];
  };

  const result = useMemo(() => {
    if (!pixelsPerMm) return null;
    const widthPx = fingerBandWidthPx() ?? Math.abs(rightLine - leftLine) / 100 * 900 / zoom;
    const widthMm = widthPx / pixelsPerMm;
    const equivalentDiameterMm = estimateInnerDiameter(widthMm);
    const closestRing = RING_DIAMETER_TABLE.reduce((closest, candidate) =>
      Math.abs(candidate.diameterMm - equivalentDiameterMm) < Math.abs(closest.diameterMm - equivalentDiameterMm) ? candidate : closest
    );
    const confirmedFit = REAL_FIT_REFERENCES.find((reference) => (
      widthMm >= reference.minWidthMm && widthMm <= reference.maxWidthMm
    ));
    const technicalRing = confirmedFit
      ? RING_DIAMETER_TABLE.find((ring) => ring.size === confirmedFit.ringSize) || closestRing
      : closestRing;
    const selectedRing = RING_DIAMETER_TABLE.find((ring) => (
      ring.size === clamp(technicalRing.size + COMFORT_RING_OFFSET, 1, 40)
    )) || technicalRing;
    return {
      widthMm,
      equivalentDiameterMm: selectedRing.diameterMm,
      ringSize: selectedRing.size,
      calculationMode: "formula",
    };
  }, [pixelsPerMm, leftLine, rightLine, measureY, zoom, panX, panY, leftLocked, rightLocked]);

  const resetPhoto = () => {
    setPhoto("");
    setTryOn(false);
    setAnalyzingCard(false);
    setPixelsPerMm(null);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    setError("");
    setHandPhoto("");
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
          <p className="lead">Antes de abrir a câmera, coloque um cartão bancário deitado sobre o dedo. O sistema usará a base de 85,60 mm para calibrar e depois você ajustará as linhas magnéticas nas bordas do dedo.</p>
          <img className="tutorial-image" src="/tutorial-medidor.svg" alt="Passo a passo ilustrado para medir o tamanho do anel" />
          <ul className="tips">
            <li>Use um cartão padrão de 85,60 × 53,98 mm.</li>
            <li>Deixe o cartão inteiro visível na foto, sem cobrir o ponto do anel.</li>
            <li>Mantenha cartão, dedos e câmera paralelos.</li>
            <li>Na câmera, mantenha o dedo reto sobre a linha vertical.</li>
          </ul>
          <button className="primary" onClick={() => { setMeasurementMode("finger"); void openCamera(); }}>Medir meu dedo</button>
          <button className="secondary" onClick={() => { setMeasurementMode("anelimetro"); void openCamera(); }}>Testar no anelímetro</button>
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
            <video ref={videoRef} playsInline muted autoPlay />
            <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} onClick={() => void toggleTorch()}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
            <div className={`card-alignment${cardReady ? " ready" : ""}`} aria-hidden="true">
              <span>{cardReady ? "✓ BASE ALINHADA" : "ALINHE O CARTÃO"}</span>
              <i className="live-base-left" />
              <i className="live-base-right" />
              <i className="finger-target-left" />
              <i className="finger-target-right" />
            </div>
            <div className="finger-vertical-line" aria-hidden="true"><span>DEDO ESCOLHIDO</span></div>
            {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
          </div>
          <p>{cardReady ? "Base verde: cartão horizontal e dedo escolhido entre as duas marcas" : torchOn ? "Luz ligada • alinhe o cartão na horizontal e centralize o dedo" : "Alinhe a base do cartão e deixe o dedo escolhido entre as duas marcas"}</p>
          <button className={`shutter${cardReady ? " ready" : ""}`} onClick={() => void capture()} aria-label="Tirar fotografia"><span /></button>
          {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={() => void openCamera()}>Tentar novamente</button></>}
        </section>
      )}

      {stage === "hand-camera" && (
        <section className="camera-screen">
          <div className="camera-top">
            <button className="icon-button" onClick={() => { stopCamera(); setStage("review"); }}>×</button>
            <span>Fotografe a mão inteira</span>
          </div>
          <div className="viewport hand-camera-viewport">
            <video ref={videoRef} playsInline muted autoPlay />
            <button type="button" className={`torch-button${torchOn ? " is-on" : ""}${!torchSupported ? " support-unknown" : ""}`} onClick={() => void toggleTorch()}>{torchOn ? "⚡ Luz ligada" : "⚡ Ligar luz"}</button>
            <div className="full-hand-guide" aria-hidden="true"><span>MÃO INTEIRA</span><i>ANELAR AQUI</i></div>
            {cameraOpening && <div className="camera-opening">Abrindo câmera...</div>}
          </div>
          <p>Abra a mão, mostre todos os dedos e deixe o anelar sobre a marca.</p>
          <button className="shutter" onClick={captureHand} aria-label="Fotografar a mão inteira"><span /></button>
          {error && <><p className="error">{error}</p><button className="secondary camera-retry" type="button" onClick={() => void openHandCamera()}>Tentar novamente</button></>}
        </section>
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">{phase === "card" ? "1. CALIBRE O CARTÃO" : measurementMode === "anelimetro" ? "2. TESTE O ANELÍMETRO" : "2. MEÇA O DEDO"}</span>
          <h1>{phase === "card" ? "Confirme a base do cartão" : measurementMode === "anelimetro" ? "Encaixe as linhas no anelímetro" : "Encaixe as linhas no dedo"}</h1>
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
              <>
                <button
                  className={`card-base-line${cardLeftLocked && cardRightLocked ? " locked" : ""}`}
                  style={{ left: `${cardLeft}%`, top: `${cardBottom}%`, width: `${cardRight - cardLeft}%` }}
                  onPointerDown={(event) => startDrag("card-base-y", event)}
                  aria-label="Mover linha para a base do cartão"
                ><span>BASE 85,60 mm</span></button>
                <button className={`card-base-endpoint left${cardLeftLocked ? " locked" : ""}`} style={{ left: `${cardLeft}%`, top: `${cardBottom}%` }} onPointerDown={(event) => startDrag("card-base-left", event)} aria-label="Ajustar canto inferior esquerdo" />
                <button className={`card-base-endpoint right${cardRightLocked ? " locked" : ""}`} style={{ left: `${cardRight}%`, top: `${cardBottom}%` }} onPointerDown={(event) => startDrag("card-base-right", event)} aria-label="Ajustar canto inferior direito" />
              </>
            )}
            {phase === "finger" && pixelsPerMm && (
              <div className="card-base-reference" style={{ left: `${cardLeft}%`, top: `${cardBottom}%`, width: `${cardRight - cardLeft}%` }} aria-hidden="true"><span>BASE FIXA · 85,60 mm</span><i className="left" /><i className="right" /></div>
            )}
            {phase === "finger" && pixelsPerMm && (
              <>
                <button className={`caliper-line left${leftLocked ? " locked" : ""}${tryOn ? " ring-adjust" : ""}`} style={{ left: `${leftLine}%`, top: `${measureY - 16}%` }} onPointerDown={(event) => startDrag("left", event)} aria-label="Mover linha esquerda"><span /></button>
                <button className={`caliper-line right${rightLocked ? " locked" : ""}${tryOn ? " ring-adjust" : ""}`} style={{ left: `${rightLine}%`, top: `${measureY - 16}%` }} onPointerDown={(event) => startDrag("right", event)} aria-label="Mover linha direita"><span /></button>
                <div className="measurement-band" style={{ left: `${leftLine}%`, top: `${measureY}%`, width: `${rightLine - leftLine}%` }} aria-hidden="true" />
                <button className={`measure-cross${tryOn ? " ring-adjust" : ""}`} style={{ left: `${leftLine}%`, top: `${measureY}%`, width: `${rightLine - leftLine}%` }} onPointerDown={(event) => startDrag("height", event)} aria-label="Mover altura da medição" />
                <button className={`measure-height-handle${tryOn ? " ring-adjust" : ""}`} style={{ left: `${(leftLine + rightLine) / 2}%`, top: `${Math.min(measureY + 19, 95)}%` }} onPointerDown={(event) => startDrag("height", event)}>{tryOn ? "AJUSTAR" : "ARRASTE"}</button>
              </>
            )}
            {phase === "finger" && result && leftLocked && rightLocked && !tryOn && (
              <div className="ring-size-badge" style={{ left: `${(leftLine + rightLine) / 2}%` }} aria-live="polite">
                <span>ARO PROVÁVEL:</span>
                <strong>{result.ringSize}</strong>
              </div>
            )}
            {phase === "finger" && pixelsPerMm && tryOn && (
              <div
                className={`virtual-ring metal-${ringMetal} style-${ringStyle}`}
                style={{
                  left: `${(leftLine + rightLine) / 2}%`,
                  top: `${measureY}%`,
                  width: `${Math.min(100, rightLine - leftLine)}%`,
                  height: `${clamp(ringBandWidth * pixelsPerMm * zoom / 12, 0.8, 7)}%`,
                }}
                aria-label="Aliança virtual aplicada ao dedo"
              >
                <img src={wearableRingImage(ringStyle)} alt="" />
              </div>
            )}
          </div>

          {analyzingCard && <p className="analysis-loading">Localizando a base e os cantos inferiores do cartão...</p>}
          {phase === "card" && !analyzingCard && (
            <div className={`card-base-status${cardLeftLocked && cardRightLocked ? " ready" : ""}`}>
              <strong>{cardLeftLocked && cardRightLocked ? "✓ Confira a base antes de continuar" : "Ajuste os dois cantos inferiores"}</strong>
              <span>{cardLeftLocked ? "✓ Esquerdo" : "○ Esquerdo"} · {cardRightLocked ? "✓ Direito" : "○ Direito"}</span>
              {cardLeftLocked && cardRightLocked && <small>As pontas verdes precisam ficar exatamente nos dois cantos da base do cartão.</small>}
            </div>
          )}

          {phase === "finger" && !tryOn && (
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
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 1, 40)} a {clamp(result.ringSize + 1, 1, 40)}</span>
              <span>Largura marcada: {result.widthMm.toFixed(1)} mm</span>
              <span>Diâmetro interno equivalente: {result.equivalentDiameterMm.toFixed(2)} mm</span>
              <span>Calibração do cartão: {calibrationConfidence}%</span>
              {!tryOn && <button className="try-on-button" type="button" onClick={() => setTryOn(true)}>Experimentar no meu dedo</button>}
            </div>
          )}
          {phase === "finger" && result && leftLocked && rightLocked && !tryOn && (
            <AdminCalibration
              measurement={{ widthMm: result.widthMm, ringSize: result.ringSize }}
              calibrationConfidence={calibrationConfidence}
              zoom={zoom}
              defaultMeasurementType={measurementMode}
            />
          )}
          {phase === "finger" && !tryOn && (!leftLocked || !rightLocked) && <div className="edge-status"><strong>Aproxime e solte cada linha na borda</strong><span>{leftLocked ? "✓ Esquerda travada" : "○ Falta a esquerda"} · {rightLocked ? "✓ Direita travada" : "○ Falta a direita"}</span></div>}

          {tryOn && result && (
            <section className="try-on-panel">
              <div className="try-on-heading"><div><span>PROVADOR VIRTUAL</span><strong>Aro {result.ringSize} no seu dedo</strong></div><button type="button" onClick={() => setTryOn(false)}>×</button></div>
              <label>Cor do metal</label>
              <div className="choice-row metal-choices">
                {(["gold", "silver", "rose", "black"] as RingMetal[]).map((metal) => <button key={metal} type="button" className={`${metal}${ringMetal === metal ? " selected" : ""}`} onClick={() => setRingMetal(metal)} aria-label={`Selecionar ${metal}`} />)}
              </div>
              <label>Largura da aliança</label>
              <div className="choice-row width-choices">
                {[2, 4, 6, 8].map((width) => <button key={width} type="button" className={ringBandWidth === width ? "selected" : ""} onClick={() => setRingBandWidth(width)}>{width} mm</button>)}
              </div>
              <label>Modelo</label>
              <div className="choice-row style-choices">
                {RING_MODELS.map((model) => (
                  <button key={model.id} type="button" className={ringStyle === model.id ? "selected" : ""} onClick={() => setRingStyle(model.id)}>
                    <img src={ringImage(model.id)} alt="" />
                    <span>{model.label}</span>
                  </button>
                ))}
              </div>
              <button className="secondary back-to-measure" type="button" onClick={() => setTryOn(false)}>Voltar ao ajuste</button>
              <div className="full-hand-question">
                <strong>Quer ver este anel em uma foto da mão inteira?</strong>
                <span>Vamos manter o modelo, a cor, a largura e o aro escolhidos.</span>
                <button className="primary" type="button" onClick={() => void openHandCamera()}>Sim, tirar foto da mão</button>
              </div>
            </section>
          )}

          <div className="review-actions">
            <button className="secondary" onClick={resetPhoto}>Tirar outra</button>
            {phase === "finger" && (
              <button className="primary" type="button" disabled>{leftLocked && rightLocked ? "Aro calculado" : "Ajuste as linhas no dedo"}</button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <p className="pending">{tryOn ? "Escolha o acabamento e a largura para comparar os modelos no seu dedo." : "Use + para ampliar, arraste a foto para centralizar e depois encaixe as linhas nas bordas do dedo."}</p>
        </section>
      )}

      {stage === "hand-review" && (
        <section className="panel hand-result">
          <span className="step">PROVADOR NA MÃO INTEIRA</span>
          <h1>Ajuste o anel no dedo</h1>
          <p className="lead">Arraste o anel até o dedo e encaixe as linhas magnéticas nas duas bordas. O anel será centralizado automaticamente.</p>
          <div
            ref={measureRef}
            className="measurement-stage hand-showcase"
            onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
            onPointerUp={finishDrag}
            onPointerCancel={() => { draggingRef.current = null; }}
          >
            {handPhoto && <img src={handPhoto} alt="Foto da mão inteira com anel virtual" draggable={false} />}
            <button className="showcase-caliper left" style={{ left: `${showcaseX - showcaseWidth / 2}%`, top: `${showcaseY - 10}%` }} onPointerDown={(event) => startDrag("showcase-left", event)} aria-label="Ajustar borda esquerda do dedo"><span /></button>
            <button className="showcase-caliper right" style={{ left: `${showcaseX + showcaseWidth / 2}%`, top: `${showcaseY - 10}%` }} onPointerDown={(event) => startDrag("showcase-right", event)} aria-label="Ajustar borda direita do dedo"><span /></button>
            <div className="showcase-magnetic-line" style={{ left: `${showcaseX - showcaseWidth / 2}%`, top: `${showcaseY}%`, width: `${showcaseWidth}%` }} aria-hidden="true" />
            <button
              type="button"
              className={`virtual-ring showcase-ring metal-${ringMetal} style-${ringStyle}`}
              style={{
                left: `${showcaseX}%`,
                top: `${showcaseY}%`,
                width: `${showcaseWidth}%`,
                height: `${clamp(showcaseWidth * ringBandWidth / 15, 2.4, 11)}%`,
                transform: `translate(-50%, -50%) rotate(${showcaseAngle}deg)`,
              }}
              onPointerDown={startShowcaseDrag}
              aria-label="Arraste o anel para posicionar"
            >
              <img src={wearableRingImage(ringStyle)} alt="" />
            </button>
          </div>
          <div className="showcase-controls">
            <div><span>Tamanho</span><button type="button" onClick={() => setShowcaseWidth((value) => clamp(value - 2, 10, 50))}>−</button><strong>{showcaseWidth}%</strong><button type="button" onClick={() => setShowcaseWidth((value) => clamp(value + 2, 10, 50))}>+</button></div>
            <div><span>Inclinação</span><button type="button" onClick={() => setShowcaseAngle((value) => value - 3)}>↶</button><strong>{showcaseAngle}°</strong><button type="button" onClick={() => setShowcaseAngle((value) => value + 3)}>↷</button></div>
          </div>
          <div className="hand-result-summary"><strong>{RING_MODELS.find((model) => model.id === ringStyle)?.label} · {ringBandWidth} mm</strong><span>{result ? `Aro ${result.ringSize}` : "Modelo selecionado"}</span></div>
          <div className="review-actions">
            <button className="secondary" type="button" onClick={() => void openHandCamera()}>Tirar outra foto</button>
            <button className="primary" type="button" onClick={() => setStage("review")}>Voltar aos modelos</button>
          </div>
        </section>
      )}
    </main>
  );
}

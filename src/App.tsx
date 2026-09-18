import { useEffect, useMemo, useRef, useState } from "react";
import { calibratePhoto, cardMatchesLiveGuide } from "./vision";
import AdminCalibration from "./AdminCalibration";
import { clamp, computeRingResult, type CalibrationRule } from "./ringCalculation";
import { homographyFromQuad, distance, type Point } from "./perspective";
import { useCameraStream } from "./useCameraStream";
import type { DragTarget, FingerMeasureStep, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "./types";
import { wearableRingImage } from "./types";
import IntroScreen from "./components/IntroScreen";
import CameraScreen from "./components/CameraScreen";
import HandCameraScreen from "./components/HandCameraScreen";
import HandReviewScreen from "./components/HandReviewScreen";
import TryOnPanel from "./components/TryOnPanel";

export default function App() {
  const camera = useCameraStream();
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const photoPixelsRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [phase, setPhase] = useState<MeasurePhase>("card");
  const [pixelsPerMm, setPixelsPerMm] = useState<number | null>(null);
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [cardLeft, setCardLeft] = useState(15);
  const [cardRight, setCardRight] = useState(85);
  const [cardBottom, setCardBottom] = useState(58);
  const [cardCorners, setCardCorners] = useState<[Point, Point, Point, Point]>([{x:15,y:28},{x:85,y:28},{x:85,y:58},{x:15,y:58}]);
  const [perspectiveReady, setPerspectiveReady] = useState(false);
  const [cardCornerLocked, setCardCornerLocked] = useState<[boolean, boolean, boolean, boolean]>([false,false,false,false]);
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
  const [fingerMeasureStep, setFingerMeasureStep] = useState<FingerMeasureStep>("rest");
  const [restWidthMm, setRestWidthMm] = useState<number | null>(null);
  const [jointWidthMm, setJointWidthMm] = useState<number | null>(null);
  const [calibrationRules, setCalibrationRules] = useState<CalibrationRule[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/.netlify/functions/calibration")
      .then((response) => (response.ok ? response.json() : { rules: [] }))
      .then((data) => { if (!cancelled) setCalibrationRules(data.rules || []); })
      .catch(() => { if (!cancelled) setCalibrationRules([]); });
    return () => { cancelled = true; };
  }, []);

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
    if ((stage !== "camera" && stage !== "hand-camera") || !camera.videoRef.current || !camera.streamRef.current) return;
    camera.videoRef.current.srcObject = camera.streamRef.current;
    void camera.videoRef.current.play().catch(() => camera.setError("A imagem não iniciou. Toque em Tentar novamente."));
  }, [stage]);
  useEffect(() => {
    if (stage !== "camera" || camera.cameraOpening) {
      setCardReady(false);
      return;
    }
    let running = false;
    const checkAlignment = () => {
      if (running || !camera.videoRef.current) return;
      running = true;
      try { setCardReady(cardMatchesLiveGuide(camera.videoRef.current)); }
      finally { running = false; }
    };
    checkAlignment();
    const interval = window.setInterval(checkAlignment, 450);
    return () => window.clearInterval(interval);
  }, [stage, camera.cameraOpening]);

  const openCamera = async () => {
    setPixelsPerMm(null);
    setCalibrationConfidence(0);
    setPhase("card");
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    setCardReady(false);
    setStage("camera");
    await camera.startCameraStream();
  };

  const openHandCamera = async () => {
    setStage("hand-camera");
    await camera.startCameraStream();
  };

  const capture = async () => {
    const video = camera.videoRef.current;
    if (!video?.videoWidth) return;
    if (!cardReady) {
      camera.setError("Alinhe a base e as laterais do cartão até a régua ficar verde antes de tirar a foto.");
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
    camera.stopCamera();
    setStage("review");
    camera.setError("");
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
      const top = clamp(finalBottom - (finalRight - finalLeft) * (53.98 / 85.6) * 0.75, 4, finalBottom - 5);
      setCardCorners([{x:finalLeft,y:top},{x:finalRight,y:top},{x:finalRight,y:finalBottom},{x:finalLeft,y:finalBottom}]);
      setPerspectiveReady(false);
      setCardCornerLocked([false,false,false,false]);
      setCardLeftLocked(true);
      setCardRightLocked(true);
      camera.setError("Confira as quatro bordas do cartão e toque em Confirmar perspectiva.");
    } catch {
      camera.setError("Não consegui travar a base automaticamente. Arraste as duas linhas para os cantos inferiores do cartão.");
    } finally {
      setAnalyzingCard(false);
    }
  };

  const confirmPerspective = () => {
    try {
      const source = photoPixelsRef.current;
      if (!source) return;
      const quad = cardCorners.map((p) => ({ x: p.x / 100 * source.width, y: p.y / 100 * source.height })) as [Point, Point, Point, Point];
      const map = homographyFromQuad(quad);
      const measured = distance(map(quad[0]), map(quad[1]));
      if (Math.abs(measured - 85.6) > 0.15) throw new Error("perspectiva");
      setPerspectiveReady(true);
      activateFingerMeasurement(cardCorners[3].x, cardCorners[2].x, (cardCorners[2].y + cardCorners[3].y) / 2, calibrationConfidence || 92);
    } catch { camera.setError("As quatro bordas não formam um cartão válido. Ajuste os cantos e tente novamente."); }
  };

  const activateFingerMeasurement = (baseLeft: number, baseRight: number, baseBottom: number, confidence = 92) => {
    const source = photoPixelsRef.current;
    if (source) {
      const quad = cardCorners.map((p) => ({ x: p.x / 100 * source.width, y: p.y / 100 * source.height })) as [Point, Point, Point, Point];
      const map = homographyFromQuad(quad);
      const centerY = ((cardCorners[2].y + cardCorners[3].y) / 2) / 100 * source.height;
      const a = map({x: cardCorners[3].x / 100 * source.width, y:centerY});
      const b = map({x: cardCorners[2].x / 100 * source.width, y:centerY});
      const px = Math.abs(cardCorners[2].x-cardCorners[3].x)/100*source.width;
      setPixelsPerMm(px / Math.max(distance(a,b), 0.01));
    } else setPixelsPerMm(((baseRight - baseLeft) / 100 * 900) / 85.6);
    setCalibrationConfidence((current) => Math.max(current, confidence));
    setLeftLine(38);
    setRightLine(62);
    setMeasureY(clamp(baseBottom + 17, 42, 76));
    setZoom(1);
    setPanX(0);
    setPanY(0);
    camera.setError("");
    setPhase("finger");
    setFingerMeasureStep("rest");
    setRestWidthMm(null);
    setJointWidthMm(null);
    setLeftLocked(false);
    setRightLocked(false);
  };

  const captureHand = () => {
    const video = camera.videoRef.current;
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
    camera.stopCamera();
    setStage("hand-review");
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !measureRef.current) return;
    const rect = measureRef.current.getBoundingClientRect();
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 2, 98);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 92);
    const target = draggingRef.current;
    if (typeof target === "string" && target.startsWith("card-corner-")) {
      const index = Number(target.slice(-1));
      setPerspectiveReady(false);
      setCardCorners((current) => current.map((p,i) => i === index ? {x,y} : p) as [Point,Point,Point,Point]);
      return;
    }
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
    if (zoom <= 1 || tryOn) return;
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
    const value = clamp(nextZoom, 1, phase === "card" ? 8 : 4);
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
    camera.setError("");
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
    camera.setError("");
  };

  const snapCardCorner = (index: number) => {
    const source = photoPixelsRef.current;
    if (!source) return;
    const current = cardCorners[index];
    const cx = Math.round(current.x / 100 * source.width);
    const cy = Math.round(current.y / 100 * source.height);
    const radius = Math.max(8, Math.round(Math.min(source.width, source.height) * 0.018));
    const gray = (x:number,y:number) => { const o=(y*source.width+x)*4; return source.data[o]*.299+source.data[o+1]*.587+source.data[o+2]*.114; };
    let best={x:cx,y:cy,score:0};
    for(let y=cy-radius;y<=cy+radius;y+=2) for(let x=cx-radius;x<=cx+radius;x+=2){
      if(x<3||y<3||x>=source.width-3||y>=source.height-3) continue;
      const gx=Math.abs(gray(x+2,y)-gray(x-2,y));
      const gy=Math.abs(gray(x,y+2)-gray(x,y-2));
      const corner=Math.min(gx,gy)+0.35*Math.max(gx,gy)-Math.hypot(x-cx,y-cy)*.22;
      if(corner>best.score) best={x,y,score:corner};
    }
    if(best.score<12){ setCardCornerLocked(v=>v.map((b,i)=>i===index?false:b) as [boolean,boolean,boolean,boolean]); return; }
    setCardCorners(v=>v.map((p,i)=>i===index?{x:best.x/source.width*100,y:best.y/source.height*100}:p) as [Point,Point,Point,Point]);
    setCardCornerLocked(v=>v.map((b,i)=>i===index?true:b) as [boolean,boolean,boolean,boolean]);
  };

  const finishDrag = (event: React.PointerEvent) => {
    const target = draggingRef.current;
    if (target === "left" || target === "right") snapBoundary(target, event.clientX);
    if (target === "card-base-left") snapCardBaseEndpoint("left", event.clientX);
    if (target === "card-base-right") snapCardBaseEndpoint("right", event.clientX);
    if (target === "card-base-y") snapCardBaseY(event.clientY);
    if (typeof target === "string" && target.startsWith("card-corner-")) snapCardCorner(Number(target.slice(-1)));
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

  const liveWidthMm = useMemo(() => {
    if (!pixelsPerMm || !leftLocked || !rightLocked) return null;
    const widthPx = fingerBandWidthPx() ?? Math.abs(rightLine - leftLine) / 100 * 900 / zoom;
    return widthPx / pixelsPerMm;
  }, [pixelsPerMm, leftLine, rightLine, measureY, zoom, panX, panY, leftLocked, rightLocked]);

  const confirmRestMeasurement = () => {
    if (liveWidthMm === null) return;
    setRestWidthMm(liveWidthMm);
    setFingerMeasureStep("joint");
    setLeftLocked(false);
    setRightLocked(false);
  };

  const confirmJointMeasurement = () => {
    if (liveWidthMm === null) return;
    setJointWidthMm(liveWidthMm);
    setFingerMeasureStep("complete");
  };

  const result = useMemo(() => {
    const widthMm = measurementMode === "finger"
      ? restWidthMm !== null && jointWidthMm !== null ? Math.max(restWidthMm, jointWidthMm) : null
      : liveWidthMm;
    if (widthMm === null) return null;
    return computeRingResult(widthMm, calibrationRules);
  }, [liveWidthMm, measurementMode, restWidthMm, jointWidthMm, calibrationRules]);

  const resetPhoto = () => {
    setPhoto("");
    setTryOn(false);
    setAnalyzingCard(false);
    setPixelsPerMm(null);
    setPhase("card");
    setFingerMeasureStep("rest");
    setRestWidthMm(null);
    setJointWidthMm(null);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    camera.setError("");
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
        <IntroScreen
          error={camera.error}
          onMeasureFinger={() => { setMeasurementMode("finger"); void openCamera(); }}
          onTestGauge={() => { setMeasurementMode("anelimetro"); void openCamera(); }}
        />
      )}

      {stage === "camera" && (
        <CameraScreen
          videoRef={camera.videoRef}
          torchOn={camera.torchOn}
          torchSupported={camera.torchSupported}
          onToggleTorch={() => void camera.toggleTorch()}
          cardReady={cardReady}
          cameraOpening={camera.cameraOpening}
          error={camera.error}
          onClose={() => { camera.stopCamera(); setStage("intro"); }}
          onCapture={() => void capture()}
          onRetry={() => void openCamera()}
        />
      )}

      {stage === "hand-camera" && (
        <HandCameraScreen
          videoRef={camera.videoRef}
          torchOn={camera.torchOn}
          torchSupported={camera.torchSupported}
          onToggleTorch={() => void camera.toggleTorch()}
          cameraOpening={camera.cameraOpening}
          error={camera.error}
          onClose={() => { camera.stopCamera(); setStage("review"); }}
          onCapture={captureHand}
          onRetry={() => void openHandCamera()}
        />
      )}

      {stage === "review" && (
        <section className="panel review">
          <span className="step">{phase === "card" ? "1. CALIBRE O CARTÃO" : measurementMode === "anelimetro" ? "2. TESTE O ANELÍMETRO" : fingerMeasureStep === "rest" ? "2. MEÇA ONDE O ANEL FICA" : fingerMeasureStep === "joint" ? "3. MEÇA A JUNTA" : "MEDIÇÃO CONCLUÍDA"}</span>
          <h1>{phase === "card" ? "Ajuste as quatro bordas do cartão" : measurementMode === "anelimetro" ? "Encaixe as linhas no anelímetro" : fingerMeasureStep === "rest" ? "Meça onde o anel vai ficar" : fingerMeasureStep === "joint" ? "Agora meça a junta mais grossa" : "Usamos a maior medida do dedo"}</h1>
          <div
            ref={measureRef}
            className="measurement-stage is-active"
            onPointerDown={startPan}
            onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
            onPointerUp={finishDrag}
            onPointerCancel={() => { draggingRef.current = null; }}
          >
            {photo && <img className="zoomable-photo" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }} src={photo} alt="Fotografia para medição" draggable={false} />}
            {phase === "card" && (
              <>
                <svg className="card-perspective-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Quatro bordas do cartão">
                  <polygon points={cardCorners.map(p => `${p.x},${p.y}`).join(" ")} />
                  {cardCorners.map((p,i) => <circle className={cardCornerLocked[i] ? "locked" : ""} key={i} cx={p.x} cy={p.y} r="1.6" onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = (`card-corner-${i}` as DragTarget); e.currentTarget.setPointerCapture(e.pointerId); }} />)}
                </svg>
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
          {phase === "card" && !analyzingCard && <div className="card-corner-status">{cardCornerLocked.map((v,i)=><span key={i} className={v ? "locked" : ""}>{v ? "✓" : "○"} Canto {i+1}</span>)}</div>}
          {phase === "card" && !analyzingCard && <button className="primary confirm-perspective" type="button" onClick={confirmPerspective}>Confirmar perspectiva do cartão</button>}
          {phase === "card" && !analyzingCard && (
            <div className={`card-base-status${cardLeftLocked && cardRightLocked ? " ready" : ""}`}>
              <strong>{cardLeftLocked && cardRightLocked ? "✓ Confira a base antes de continuar" : "Ajuste os dois cantos inferiores"}</strong>
              <span>{cardLeftLocked ? "✓ Esquerdo" : "○ Esquerdo"} · {cardRightLocked ? "✓ Direito" : "○ Direito"}</span>
              {cardLeftLocked && cardRightLocked && <small>As pontas verdes precisam ficar exatamente nos dois cantos da base do cartão.</small>}
            </div>
          )}

          {(phase === "card" || phase === "finger") && !tryOn && (
            <div className="zoom-controls" aria-label="Controles de zoom">
              <button onClick={() => changeZoom(zoom - 0.5)} disabled={zoom <= 1} aria-label="Diminuir zoom">−</button>
              <strong>{zoom.toFixed(1)}×</strong>
              <button onClick={() => changeZoom(zoom + 0.5)} disabled={zoom >= (phase === "card" ? 8 : 4)} aria-label="Aumentar zoom">+</button>
              <button className="zoom-reset" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}>Redefinir</button>
            </div>
          )}

          {phase === "finger" && measurementMode === "finger" && liveWidthMm !== null && leftLocked && rightLocked && !result && (
            <section className="measurement-step">
              {fingerMeasureStep === "rest" ? (
                <>
                  <strong>Medida onde o anel vai ficar: {liveWidthMm.toFixed(1)} mm</strong>
                  <span>Confirme e depois arraste a faixa até a junta mais grossa do mesmo dedo.</span>
                  <button className="primary" type="button" onClick={confirmRestMeasurement}>Confirmar esta medida</button>
                </>
              ) : (
                <>
                  <strong>Medida da junta: {liveWidthMm.toFixed(1)} mm</strong>
                  <span>O sistema escolherá a maior medida para o anel passar sem apertar.</span>
                  <button className="primary" type="button" onClick={confirmJointMeasurement}>Calcular usando a maior medida</button>
                </>
              )}
            </section>
          )}

          {phase === "finger" && result && leftLocked && rightLocked && (
            <div className="analysis-result">
              <strong>Aro provável: {result.ringSize}</strong>
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 1, 40)} a {clamp(result.ringSize + 1, 1, 40)}</span>
              <span>Largura marcada: {result.widthMm.toFixed(1)} mm</span>
              {measurementMode === "finger" && restWidthMm !== null && jointWidthMm !== null && <span>Encaixe: {restWidthMm.toFixed(1)} mm · Junta: {jointWidthMm.toFixed(1)} mm</span>}
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
            <TryOnPanel
              ringSize={result.ringSize}
              ringMetal={ringMetal}
              ringBandWidth={ringBandWidth}
              ringStyle={ringStyle}
              onSelectMetal={setRingMetal}
              onSelectBandWidth={setRingBandWidth}
              onSelectStyle={setRingStyle}
              onClose={() => setTryOn(false)}
              onGoHandCamera={() => void openHandCamera()}
            />
          )}

          <div className="review-actions">
            <button className="secondary" onClick={resetPhoto}>Tirar outra</button>
            {phase === "finger" && (
              <button className="primary" type="button" disabled>{leftLocked && rightLocked ? "Aro calculado" : "Ajuste as linhas no dedo"}</button>
            )}
          </div>
          {camera.error && <p className="error">{camera.error}</p>}
          <p className="pending">{tryOn ? "Escolha o acabamento e a largura para comparar os modelos no seu dedo." : "Use + para ampliar, arraste a foto para centralizar e depois encaixe as linhas nas bordas do dedo."}</p>
        </section>
      )}

      {stage === "hand-review" && (
        <HandReviewScreen
          measureRef={measureRef}
          handPhoto={handPhoto}
          showcaseX={showcaseX}
          showcaseY={showcaseY}
          showcaseWidth={showcaseWidth}
          showcaseAngle={showcaseAngle}
          ringMetal={ringMetal}
          ringStyle={ringStyle}
          ringBandWidth={ringBandWidth}
          ringSize={result?.ringSize ?? null}
          setShowcaseWidth={setShowcaseWidth}
          setShowcaseAngle={setShowcaseAngle}
          onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
          onPointerUp={finishDrag}
          onPointerCancel={() => { draggingRef.current = null; }}
          onStartDrag={startDrag}
          onStartShowcaseDrag={startShowcaseDrag}
          onRetakePhoto={() => void openHandCamera()}
          onBackToReview={() => setStage("review")}
        />
      )}
    </main>
  );
}

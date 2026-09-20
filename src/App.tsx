Warning: truncated output (original token count: 15016)
Total output lines: 1324

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeLiveCardGuide, calibratePhoto } from "./vision";
import AdminCalibration from "./AdminCalibration";
import { clamp, computeRingResult, type CalibrationRule } from "./ringCalculation";
import { assessCardQuadGeometry, homographyFromQuad, quadFromLines, distance, type Line, type Point } from "./perspective";
import { useCameraStream } from "./useCameraStream";
import type { CardEdge, DragTarget, FingerMeasureStep, FingerSide, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "./types";
import { wearableRingImage } from "./types";
import IntroScreen from "./components/IntroScreen";
import CameraScreen from "./components/CameraScreen";
import HandCameraScreen from "./components/HandCameraScreen";
import HandReviewScreen from "./components/HandReviewScreen";
import TryOnPanel from "./components/TryOnPanel";

const MIN_CARD_CALIBRATION_CONFIDENCE = 90;
const HIGH_CARD_CALIBRATION_CONFIDENCE = 92;

export default function App() {
  const camera = useCameraStream();
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const cardLineDragStartRef = useRef<{ pointer: Point; line: Line } | null>(null);
  const photoPixelsRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  const [phase, setPhase] = useState<MeasurePhase>("card");
  const [pixelsPerMm, setPixelsPerMm] = useState<number | null>(null);
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [cardLeft, setCardLeft] = useState(15);
  const [cardRight, setCardRight] = useState(85);
  const [cardBottom, setCardBottom] = useState(58);
  const [cardLines, setCardLines] = useState<Record<CardEdge, Line>>({
    top: { a:{x:10,y:28}, b:{x:90,y:28} },
    right: { a:{x:85,y:22}, b:{x:85,y:64} },
    bottom: { a:{x:10,y:58}, b:{x:90,y:58} },
    left: { a:{x:15,y:22}, b:{x:15,y:64} },
  });
  const [cardQuad, setCardQuad] = useState<[Point,Point,Point,Point]>([{x:15,y:28},{x:85,y:28},{x:85,y:58},{x:15,y:58}]);
  const [cardLineLocked, setCardLineLocked] = useState<Record<CardEdge, boolean>>({top:false,right:false,bottom:false,left:false});
  const [selectedCardLine, setSelectedCardLine] = useState<CardEdge | null>(null);
  const [perspectiveReady, setPerspectiveReady] = useState(false);
  const [leftLine, setLeftLine] = useState(25);
  const [rightLine, setRightLine] = useState(38);
  const [measureY, setMeasureY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [leftLocked, setLeftLocked] = useState(false);
  const [rightLocked, setRightLocked] = useState(false);
  const [leftFingerTilt, setLeftFingerTilt] = useState(0);
  const [rightFingerTilt, setRightFingerTilt] = useState(0);
  const [leftMagnetConfidence, setLeftMagnetConfidence] = useState(0);
  const [rightMagnetConfidence, setRightMagnetConfidence] = useState(0);
  const [leftManualRefined, setLeftManualRefined] = useState(false);
  const [rightManualRefined, setRightManualRefined] = useState(false);
  const fingerRefineDragRef = useRef<"left" | "right" | null>(null);
  const fingerLineDragStartRef = useRef<{ pointer: Point; line: Line } | null>(null);
  const [fingerLines, setFingerLines] = useState<Record<FingerSide, Line>>({
    left: { a:{x:25,y:34}, b:{x:25,y:66} },
    right: { a:{x:38,y:34}, b:{x:38,y:66} },
  });
  const [cardReady, setCardReady] = useState(false);
  const [cameraAngleGuide, setCameraAngleGuide] = useState<"forward" | "backward" | "aligned" | "unknown">("unknown");
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
      setCameraAngleGuide("unknown");
      return;
    }
    let running = false;
    const checkAlignment = () => {
      if (running || !camera.videoRef.current) return;
      running = true;
      try {
        const liveGuide = analyzeLiveCardGuide(camera.videoRef.current);
        setCardReady(liveGuide.ready);
        setCameraAngleGuide(liveGuide.angle);
      } finally { running = false; }
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
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
    setCardReady(false);
    setCameraAngleGuide("unknown");
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
    setCardLines({
      top:{a:{x:7,y:22},b:{x:93,y:22}}, right:{a:{x:89,y:16},b:{x:89,y:58}},
      bottom:{a:{x:7,y:47},b:{x:93,y:47}}, left:{a:{x:11,y:16},b:{x:11,y:58}},
    });
    setCardLineLocked({top:false,right:false,bottom:false,left:false});
    setSelectedCardLine(null);
    setLeftLine(37);
    setRightLine(63);
    setMeasureY(64);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLeftLocked(false);
    setRightLocked(false);
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
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
      const padX = Math.min(8, Math.max(3, (finalRight-finalLeft)*0.08));
      const padY = Math.min(7, Math.max(3, (finalBottom-top)*0.15));
      setCardLines({
        top:{a:{x:clamp(finalLeft-padX,1,99),y:top},b:{x:clamp(finalRight+padX,1,99),y:top}},
        right:{a:{x:finalRight,y:clamp(top-padY,1,99)},b:{x:finalRight,y:clamp(finalBottom+padY,1,99)}},
        bottom:{a:{x:clamp(finalLeft-padX,1,99),y:finalBottom},b:{x:clamp(finalRight+padX,1,99),y:finalBottom}},
        left:{a:{x:finalLeft,y:clamp(top-padY,1,99)},b:{x:finalLeft,y:clamp(finalBottom+padY,1,99)}},
      });
      setCardLineLocked({top:false,right:false,bottom:false,left:false});
      setSelectedCardLine(null);
      setPerspectiveReady(false);
      setCalibrationConfidence(calibration.confidence);
      camera.setError("Ajuste as quatro linhas nas bordas retas do cartão. Elas podem inclinar independentemente.");
    } catch {
      camera.setError("Não consegui localizar o cartão automaticamente. Ajuste manualmente as 4 linhas nas bordas retas.");
    } finally {
      setAnalyzingCard(false);
    }
  };

  const cardQuadFromCurrentLines = () => {
    const source = photoPixelsRef.current;
    if (!source) throw new Error("foto");
    const pxLines = Object.fromEntries((["top","right","bottom","left"] as CardEdge[]).map((edge) => {
      const line = cardLines[edge];
      return [edge, {
        a:{x:line.a.x/100*source.width,y:line.a.y/100*source.height},
        b:{x:line.b.x/100*source.width,y:line.b.y/100*source.height},
      }];
    })) as Record<CardEdge, Line>;
    const quadPx = quadFromLines(pxLines);
    const area = Math.abs(quadPx.reduce((sum,p,i) => {
      const q=quadPx[(i+1)%4];
      return sum + p.x*q.y-q.x*p.y;
    },0))/2;
    if (!quadPx.every((p)=>Number.isFinite(p.x)&&Number.isFinite(p.y)) || area < source.width*source.height*0.015) {
      throw new Error("quadrilatero");
    }
    return {
      px: quadPx,
      percent: quadPx.map((p)=>({x:p.x/source.width*100,y:p.y/source.height*100})) as [Point,Point,Point,Point],
    };
  };

  const confirmPerspective = () => {
    try {
      const quad = cardQuadFromCurrentLines();
      homographyFromQuad(quad.px);
      const geometry = assessCardQuadGeometry(quad.px);
      if (!geometry.valid) {
        camera.setError(geometry.reason || "A calibração do cartão ficou instável. Ajuste as quatro bordas e confirme novamente.");
        return;
      }
      if (geometry.confidence < MIN_CARD_CALIBRATION_CONFIDENCE) {
        setCalibrationConfidence(geometry.confidence);
        camera.setError(`Calibração do cartão insuficiente (${geometry.confidence}%). Ajuste novamente as 4 bordas. É necessário pelo menos ${MIN_CARD_CALIBRATION_CONFIDENCE}% para medir o dedo.`);
        return;
      }
      setCardQuad(quad.percent);
      setPerspectiveReady(true);
      setCalibrationConfidence(geometry.confidence);
      const bottomY=(quad.percent[2].y+quad.percent[3].y)/2;
      setCardLeft(quad.percent[3].x);
      setCardRight(quad.percent[2].x);
      setCardBottom(bottomY);
      activateFingerMeasurement(quad.percent[3].x,quad.percent[2].x,bottomY,geometry.confidence,quad.percent);
    } catch {
      camera.setError("As linhas não formam um cartão válido. Ajuste cada borda e confirme novamente.");
    }
  };

  const activateFingerMeasurement = (
    baseLeft:number, baseRight:number, baseBottom:number, confidence=92,
    quadPercent:[Point,Point,Point,Point]=cardQuad,
  ) => {
    const source=photoPixelsRef.current;
    if(source){
      // UI scale only. The actual MA calculation below uses the card itself as
      // the metric reference and never the full photo/canvas width.
      const bottomWidthPx=Math.hypot(
        (quadPercent[2].x-quadPercent[3].x)/100*source.width,
        (quadPercent[2].y-quadPercent[3].y)/100*source.height,
      );
      setPixelsPerMm(bottomWidthPx/85.6);
    } else {
      setPixelsPerMm(1);
    }
    setCalibrationConfidence(confidence);
    setLeftLine(38);
    setRightLine(62);
    const nextMeasureY=clamp(baseBottom+17,42,76);
    setMeasureY(nextMeasureY);
    setFingerLines({
      left:{a:{x:38,y:clamp(nextMeasureY-16,4,96)},b:{x:38,y:clamp(nextMeasureY+16,4,96)}},
      right:{a:{x:62,y:clamp(nextMeasureY-16,4,96)},b:{x:62,y:clamp(nextMeasureY+16,4,96)}},
    });
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
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
  };

  const setFingerLineFromCenterTilt = (side:FingerSide, centerX:number, tiltDeg:number) => {
    const half=16;
    const slope=Math.tan(tiltDeg*Math.PI/180);
    const line:Line={
      a:{x:clamp(centerX-slope*half,2,98),y:clamp(measureY-half,4,96)},
      b:{x:clamp(centerX+slope*half,2,98),y:clamp(measureY+half,4,96)},
    };
    setFingerLines((current)=>({...current,[side]:line}));
  };

  const syncFingerLineState = (side:FingerSide, line:Line) => {
    const dy=line.b.y-line.a.y;
    const dx=line.b.x-line.a.x;
    const yTarget=measureY;
    const t=Math.abs(dy)<1e-6 ? 0.5 : clamp((yTarget-line.a.y)/dy,0,1);
    const centerX=line.a.x+dx*t;
    const tiltDeg=clamp(Math.atan2(dx,dy)*180/Math.PI,-18,18);
    if(side==="left"){
      setLeftLine(Math.min(centerX,rightLine-3));
      setLeftFingerTilt(tiltDeg);
      setLeftLocked(true);
      setLeftManualRefined(true);
    }else{
      setRightLine(Math.max(centerX,leftLine+3));
      setRightFingerTilt(tiltDeg);
      setRightLocked(true);
      setRightManualRefined(true);
    }
  };

  const startFingerLineDrag = (side:FingerSide, endpoint:"a"|"b"|null, event:React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const stage=measureRef.current;
    if(!stage) return;
    const rect=stage.getBoundingClientRect();
    // O ajuste fino do dedo é desenhado no espaço visual da tela.
    // Guardamos o ponto inicial nesse mesmo espaço para evitar salto e atraso.
    const screenX=(event.clientX-rect.left)/rect.width*100;
    const screenY=(event.clientY-rect.top)/rect.height*100;
    const line=fingerLines[side];
    draggingRef.current=(endpoint ? `finger-line-${side}-${endpoint}` : `finger-line-${side}`) as DragTarget;
    fingerLineDragStartRef.current={pointer:{x:screenX,y:screenY},line:{a:{...line.a},b:{...line.b}}};
    event.currentTarget.setPointerCapture(event.pointerId);
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
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    const imageX = (((clientX - rect.left) - rect.width / 2 - panX) / zoom + rect.width / 2) / rect.width * 100;
    const imageY = (((clientY - rect.top) - rect.height / 2 - panY) / zoom + rect.height / 2) / rect.height * 100;
    const x = clamp(rawX, 2, 98);
    const y = clamp(rawY, 8, 92);
    const target = draggingRef.current;
    if (typeof target === "string" && target.startsWith("card-line-")) {
      const match=/^card-line-(top|right|bottom|left)(?:-(a|b))?$/.exec(target);
      if(match){
        const edge=match[1] as CardEdge;
        const endpoint=match[2] as "a"|"b"|undefined;
        setSelectedCardLine(edge);
        setPerspectiveReady(false);
        setCardLineLocked((current)=>({...current,[edge]:false}));
        if(endpoint){
          setCardLines((current)=>({...current,[edge]:{...current[edge],[endpoint]:{x:clamp(imageX,1,99),y:clamp(imageY,1,99)}}}));
        } else {
          const start=cardLineDragStartRef.current;
          if(start){
            const dx=imageX-start.pointer.x, dy=imageY-start.pointer.y;
            setCardLines((current)=>({...current,[edge]:{
              a:{x:clamp(start.line.a.x+dx,1,99),y:clamp(start.line.a.y+dy,1,99)},
              b:{x:clamp(start.line.b.x+dx,1,99),y:clamp(start.line.b.y+dy,1,99)},
            }}));
          }
        }
        return;
      }
    }
    if (typeof target === "string" && target.startsWith("finger-line-")) {
      const match=/^finger-line-(left|right)(?:-(a|b))?$/.exec(target);
      if(match){
        const side=match[1] as FingerSide;
        const endpoint=match[2] as "a"|"b"|undefined;
        const start=fingerLineDragStartRef.current;
        if(start){
          let next:Line;
          const dx=rawX-start.pointer.x;
          const dy=rawY-start.pointer.y;
          if(endpoint){
            // Move pela diferença do gesto, não pela posição absoluta do dedo.
            // Assim a bolinha não pula para onde o usuário encostou dentro da
            // área de toque maior; ela continua exatamente de onde estava.
            const startPoint=start.line[endpoint];
            next={
              ...start.line,
              [endpoint]:{
                x:clamp(startPoint.x+dx,2,98),
       …5016 tokens truncated…  if(cardBottomPx<=0) return null;
    return fallbackSample.width/cardBottomPx*85.6;
  },[pixelsPerMm,leftLine,rightLine,measureY,zoom,panX,panY,leftLocked,rightLocked,leftFingerTilt,rightFingerTilt,leftManualRefined,rightManualRefined,fingerLines,cardQuad,cardLines]);

  const confirmRestMeasurement = () => {
    if (liveWidthMm === null) return;
    setRestWidthMm(liveWidthMm);
    setFingerMeasureStep("joint");
    setLeftLocked(false);
    setRightLocked(false);
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
  };

  const confirmJointMeasurement = () => {
    if (liveWidthMm === null) return;
    setJointWidthMm(liveWidthMm);
    setFingerMeasureStep("complete");
  };

  const finalMeasurementConfidence = useMemo(() => {
    const edgeConfidence = leftLocked && rightLocked
      ? Math.round((leftMagnetConfidence + rightMagnetConfidence) / 2)
      : 0;
    if (!edgeConfidence) return calibrationConfidence;
    return Math.min(
      calibrationConfidence,
      Math.round(calibrationConfidence * 0.75 + edgeConfidence * 0.25),
    );
  }, [calibrationConfidence, leftLocked, rightLocked, leftMagnetConfidence, rightMagnetConfidence]);

  const calibrationQualityLabel =
    finalMeasurementConfidence >= HIGH_CARD_CALIBRATION_CONFIDENCE ? "alta" :
    finalMeasurementConfidence >= MIN_CARD_CALIBRATION_CONFIDENCE ? "aceitável" :
    "baixa";

  const recalibrateCard = () => {
    setPhase("card");
    setPerspectiveReady(false);
    setFingerMeasureStep("rest");
    setRestWidthMm(null);
    setJointWidthMm(null);
    setLeftLocked(false);
    setRightLocked(false);
    setLeftManualRefined(false);
    setRightManualRefined(false);
    setTryOn(false);
    camera.setError("Reajuste as quatro linhas do cartão. A medição só será liberada com calibração de 90% ou mais.");
  };

  const result = useMemo(() => {
    const widthMm = measurementMode === "finger"
      ? restWidthMm !== null && jointWidthMm !== null ? Math.max(restWidthMm, jointWidthMm) : null
      : liveWidthMm;
    if (widthMm === null || calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE) return null;
    return computeRingResult(widthMm, calibrationRules, measurementMode === "anelimetro");
  }, [liveWidthMm, measurementMode, restWidthMm, jointWidthMm, calibrationRules, calibrationConfidence]);

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
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
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
          cameraAngleGuide={cameraAngleGuide}
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
              <svg
                className="card-lines-overlay"
                style={{transform:`translate(${panX}px, ${panY}px) scale(${zoom})`}}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Quatro linhas independentes do cartão"
              >
                {(Object.keys(cardLines) as CardEdge[]).map((edge)=>{
                  const line=cardLines[edge];
                  const locked=cardLineLocked[edge];
                  const selected=selectedCardLine===edge;
                  return <g key={edge} className={`card-edge${locked?" locked":""}${selected?" selected":""}`}>
                    <line className="card-line-hit" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y}
                      onPointerDown={(e)=>startCardLineDrag(edge,null,e)} />
                    <line className="card-line-visible" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />
                    {(["a","b"] as const).map((point)=><g key={point}>
                      <circle className="card-line-handle-hit" cx={line[point].x} cy={line[point].y} r="4.6"
                        onPointerDown={(e)=>startCardLineDrag(edge,point,e)} />
                      <circle className="card-line-handle" cx={line[point].x} cy={line[point].y} r="1.45" />
                    </g>)}
                  </g>;
                })}
                {(()=>{try{
                  const q=quadFromLines(cardLines);
                  return q.map((p,i)=><g key={i} className="virtual-corner">
                    <circle cx={p.x} cy={p.y} r="1.05" />
                    <line x1={p.x-1.8} y1={p.y} x2={p.x+1.8} y2={p.y} />
                    <line x1={p.x} y1={p.y-1.8} x2={p.x} y2={p.y+1.8} />
                  </g>);
                }catch{return null;}})()}
              </svg>
            )}
            {phase === "finger" && pixelsPerMm && (
              <>
                {(["left","right"] as FingerSide[]).map((side)=>{
                  const locked=side==="left"?leftLocked:rightLocked;
                  const bothLocked=leftLocked&&rightLocked;
                  const center=side==="left"?leftLine:rightLine;
                  const tilt=side==="left"?leftFingerTilt:rightFingerTilt;

                  // Etapa 1: enquanto as DUAS bordas ainda não estiverem verdes,
                  // mostramos somente a linha magnética simples, sem bolinhas.
                  if(!bothLocked){
                    return <button
                      key={side}
                      className={`caliper-line ${side}${locked ? " locked" : ""}${tryOn ? " ring-adjust" : ""}`}
                      style={{ left: `${center}%`, top: `${measureY - 16}%`, transform: `translateX(-50%) rotate(${tilt.toFixed(2)}deg)` }}
                      onPointerDown={(event)=>startDrag(side,event)}
                      aria-label={side==="left"?"Alinhar linha esquerda com o ímã":"Alinhar linha direita com o ímã"}
                    ><span /></button>;
                  }

                  // Etapa 2: somente depois das duas bordas magnéticas estarem
                  // travadas em verde aparecem as duas bolinhas para refinamento.
                  const line=fingerLines[side];
                  return <svg
                    key={side}
                    className={`finger-line-overlay ${side} locked${tryOn?" ring-adjust":""}`}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-label={side==="left"?"Refinar linha esquerda do dedo":"Refinar linha direita do dedo"}
                  >
                    <line className="finger-line-hit" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y}
                      onPointerDown={(e)=>startFingerLineDrag(side,null,e)} />
                    <line className="finger-line-visible" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />
                    {(["a","b"] as const).map((point)=><g key={point}>
                      <circle className="finger-line-handle-hit" cx={line[point].x} cy={line[point].y} r="4.8"
                        onPointerDown={(e)=>startFingerLineDrag(side,point,e)} />
                      <circle className="finger-line-handle" cx={line[point].x} cy={line[point].y} r="1.55" />
                    </g>)}
                  </svg>;
                })}
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

          {analyzingCard && <p className="analysis-loading">Localizando o cartão e preparando as 4 linhas...</p>}
          {phase === "card" && !analyzingCard && <div className="card-line-status">
            {(Object.keys(cardLines) as CardEdge[]).map((edge)=><span key={edge} className={cardLineLocked[edge] ? "locked" : ""}>
              {cardLineLocked[edge] ? "✓" : "○"} {edge==="top"?"Superior":edge==="bottom"?"Inferior":edge==="left"?"Esquerda":"Direita"}
            </span>)}
          </div>}
          {phase === "card" && !analyzingCard && <button className="primary confirm-perspective" type="button" onClick={confirmPerspective}>Confirmar linhas e medir o dedo</button>}
          {phase === "card" && !analyzingCard && (
            <div className="card-base-status">
              <strong>Ajuste as 4 linhas nas bordas retas</strong>
              <span>Arraste a linha inteira para mover. Arraste as bolinhas das pontas para inclinar. Ao soltar, o ímã procura a borda.</span>
              <small>Os 4 cantos corrigem a perspectiva. A base inferior é a referência principal de escala; a geometria completa valida a perspectiva.</small>
              <small>O dedo só é liberado com calibração confirmada de {MIN_CARD_CALIBRATION_CONFIDENCE}% ou mais.</small>
            </div>
          )}

          {phase === "finger" && calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE && (
            <div className="calibration-warning" role="alert">
              <strong>Calibração do cartão insuficiente: {calibrationConfidence}%</strong>
              <span>O aro foi bloqueado para evitar resultado instável.</span>
              <button className="secondary" type="button" onClick={recalibrateCard}>Recalibrar cartão</button>
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
              <span>MA bruto: {result.rawWidthMm.toFixed(1)} mm</span>
              {measurementMode === "anelimetro" ? (
                <>
                  <span>Medida corrigida: {result.widthMm.toFixed(1)} mm</span>
                  <span>Correção de bancada: {result.measurementCorrectionMm >= 0 ? "+" : ""}{result.measurementCorrectionMm.toFixed(2)} mm</span>
                </>
              ) : (
                <span>Modo dedo: curva do anelímetro não aplicada</span>
              )}
              {measurementMode === "finger" && restWidthMm !== null && jointWidthMm !== null && <span>Encaixe: {restWidthMm.toFixed(1)} mm · Junta: {jointWidthMm.toFixed(1)} mm</span>}
              <span>Diâmetro interno equivalente: {result.equivalentDiameterMm.toFixed(2)} mm</span>
              <span>Calibração do cartão: {calibrationConfidence}%</span>
              <span>Confiança final: {finalMeasurementConfidence}% · {calibrationQualityLabel}</span>
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
          {phase === "finger" && !tryOn && <div className="edge-status">
            <strong>{leftLocked && rightLocked ? "2. Ímã concluído — agora ajuste pelas bolinhas" : "1. Alinhe as duas linhas até ficarem verdes"}</strong>
            <span>
              {leftLocked ? (leftLocked&&rightLocked&&leftManualRefined ? `✓ Esquerda refinada manualmente` : `✓ Esquerda magnética ${leftMagnetConfidence}%`) : "○ Falta a esquerda"}
              {" · "}
              {rightLocked ? (leftLocked&&rightLocked&&rightManualRefined ? `✓ Direita refinada manualmente` : `✓ Direita magnética ${rightMagnetConfidence}%`) : "○ Falta a direita"}
            </span>
          </div>}

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
          <p className="pending">{tryOn ? "Escolha o acabamento e a largura para comparar os modelos no seu dedo." : "Primeiro alinhe as duas linhas no dedo e solte para o ímã travar em verde. As bolinhas só aparecem depois que esquerda e direita estiverem verdes."}</p>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeLiveCardGuide, calibratePhoto } from "./vision";
import AdminCalibration from "./AdminCalibration";
import { clamp, computeDiameterOnlyTestResult, computeRingResult, type CalibrationRule } from "./ringCalculation";
import { assessCardQuadGeometry, homographyFromQuad, quadFromLines, distance, type Line, type Point } from "./perspective";
import { useCameraStream } from "./useCameraStream";
import type { CardEdge, DragTarget, FingerSide, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "./types";
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
  const [diameterPhotoTestMode, setDiameterPhotoTestMode] = useState(false);
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
                y:clamp(startPoint.y+dy,4,96),
              },
            };
          }else{
            next={
              a:{x:clamp(start.line.a.x+dx,2,98),y:clamp(start.line.a.y+dy,4,96)},
              b:{x:clamp(start.line.b.x+dx,2,98),y:clamp(start.line.b.y+dy,4,96)},
            };
          }
          setFingerLines((current)=>({...current,[side]:next}));
          syncFingerLineState(side,next);
        }
        return;
      }
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
    if (target === "left") {
      if (fingerRefineDragRef.current !== "left") {
        setLeftLocked(false);
        setLeftMagnetConfidence(0);
        setLeftFingerTilt(0);
        setLeftManualRefined(false);
      }
      setLeftLine(Math.min(x, rightLine - 3));
    }
    if (target === "right") {
      if (fingerRefineDragRef.current !== "right") {
        setRightLocked(false);
        setRightMagnetConfidence(0);
        setRightFingerTilt(0);
        setRightManualRefined(false);
      }
      setRightLine(Math.max(x, leftLine + 3));
    }
    if (target === "height") {
      setLeftLocked(false);
      setRightLocked(false);
      setLeftManualRefined(false);
      setRightManualRefined(false);
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      setMeasureY(clamp(dragStartRef.current.right + dy, 18, 76));
    }
    if (target === "pan") {
      setLeftLocked(false);
      setRightLocked(false);
      setLeftManualRefined(false);
      setRightManualRefined(false);
      const maxX = (zoom - 1) * rect.width / 2;
      const maxY = (zoom - 1) * rect.height / 2;
      setPanX(clamp(dragStartRef.current.left + clientX - dragStartRef.current.x, -maxX, maxX));
      setPanY(clamp(dragStartRef.current.top + clientY - dragStartRef.current.y, -maxY, maxY));
    }
  };

  const startDrag = (target: DragTarget, event: React.PointerEvent) => {
    event.stopPropagation();
    // Depois que o ímã encontrou a borda, tocar/arrastar a mesma linha entra
    // em refinamento manual. Ao soltar, não puxamos de volta para o ímã.
    fingerRefineDragRef.current =
      leftLocked && rightLocked && target === "left" ? "left" :
      leftLocked && rightLocked && target === "right" ? "right" :
      null;
    draggingRef.current = target;
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: cardLeft, top: cardBottom, right: target === "height" ? measureY : cardRight, bottom: cardBottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target !== "height") updateDrag(event.clientX, event.clientY);
  };

  const startCardLineDrag = (edge:CardEdge, endpoint:"a"|"b"|null, event:React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const stage=measureRef.current;
    if(!stage) return;
    const rect=stage.getBoundingClientRect();
    const imageX=(((event.clientX-rect.left)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*100;
    const imageY=(((event.clientY-rect.top)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*100;
    draggingRef.current=(endpoint ? `card-line-${edge}-${endpoint}` : `card-line-${edge}`) as DragTarget;
    cardLineDragStartRef.current={pointer:{x:imageX,y:imageY},line:{a:{...cardLines[edge].a},b:{...cardLines[edge].b}}};
    setSelectedCardLine(edge);
    event.currentTarget.setPointerCapture(event.pointerId);
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
    setLeftFingerTilt(0);
    setRightFingerTilt(0);
    setLeftMagnetConfidence(0);
    setRightMagnetConfidence(0);
    setLeftManualRefined(false);
    setRightManualRefined(false);
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
    const radius = Math.max(8, Math.round(20 / zoom));
    const grayscale = (x:number,y:number) => {
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const offset=(iy*source.width+ix)*4;
      return source.data[offset]*0.299+source.data[offset+1]*0.587+source.data[offset+2]*0.114;
    };
    const findEdgeAt = (center:number,y:number) => {
      let bestX=Math.round(center);
      let best=-Infinity;
      for(let candidate=Math.round(center)-radius;candidate<=Math.round(center)+radius;candidate++){
        if(candidate<3||candidate>=source.width-3) continue;
        const contrast=Math.abs(grayscale(candidate-2,y)-grayscale(candidate+2,y));
        const score=contrast-Math.abs(candidate-center)*0.52;
        if(score>best){best=score;bestX=candidate;}
      }
      return {x:bestX,score:best};
    };

    // Ímã multiponto: procura a mesma borda em várias alturas próximas e
    // ajusta uma reta robusta. Dobras/sombras isoladas deixam de mandar na linha.
    const points:{x:number;y:number;score:number}[]=[];
    for(const offset of [-42,-32,-22,-12,0,12,22,32,42]){
      const y=Math.round(imageY+offset/Math.max(1,zoom));
      if(y<4||y>=source.height-4) continue;
      const edge=findEdgeAt(imageX,y);
      if(edge.score>=9) points.push({x:edge.x,y,score:edge.score});
    }

    const unlock=()=>{
      if(side==="left"){
        setLeftLocked(false); setLeftMagnetConfidence(0); setLeftFingerTilt(0);
      }else{
        setRightLocked(false); setRightMagnetConfidence(0); setRightFingerTilt(0);
      }
    };
    if(points.length<5){ unlock(); return; }

    const median=(values:number[])=>{
      const ordered=[...values].sort((a,b)=>a-b);
      return ordered[Math.floor(ordered.length/2)];
    };
    const medianX=median(points.map(p=>p.x));
    const filtered=points.filter(p=>Math.abs(p.x-medianX)<=Math.max(5,radius*0.72));
    if(filtered.length<5){ unlock(); return; }

    const cy=filtered.reduce((s,p)=>s+p.y,0)/filtered.length;
    const cx=filtered.reduce((s,p)=>s+p.x,0)/filtered.length;
    let yy=0,yx=0;
    for(const p of filtered){
      const dy=p.y-cy;
      yy+=dy*dy;
      yx+=dy*(p.x-cx);
    }
    const slope=yy>1?yx/yy:0; // x = cx + slope * (y-cy)
    const predictedCenterX=cx+slope*(imageY-cy);
    const residuals=filtered.map(p=>Math.abs(p.x-(cx+slope*(p.y-cy))));
    const residual=median(residuals);
    const avgScore=filtered.reduce((s,p)=>s+p.score,0)/filtered.length;
    const coverage=filtered.length/9;
    const confidence=Math.round(clamp(
      52 + coverage*28 + Math.min(18,avgScore*0.45) - residual*5.5,
      0, 99,
    ));

    if(confidence<68 || residual>3.8){ unlock(); return; }

    const snappedScreenX=rect.width/2+(predictedCenterX/source.width*rect.width-rect.width/2)*zoom+panX;
    const snappedPercent=clamp(snappedScreenX/rect.width*100,2,98);
    // Converte a inclinação no espaço da imagem para o ângulo visual da linha.
    const tiltDeg=clamp(Math.atan(slope)*180/Math.PI,-12,12);

    if(side==="left"){
      setLeftLine(Math.min(snappedPercent,rightLine-3));
      setLeftFingerTilt(tiltDeg);
      setLeftMagnetConfidence(confidence);
      setLeftManualRefined(false);
      setLeftLocked(true);
      setFingerLineFromCenterTilt("left",Math.min(snappedPercent,rightLine-3),tiltDeg);
    }else{
      setRightLine(Math.max(snappedPercent,leftLine+3));
      setRightFingerTilt(tiltDeg);
      setRightMagnetConfidence(confidence);
      setRightManualRefined(false);
      setRightLocked(true);
      setFingerLineFromCenterTilt("right",Math.max(snappedPercent,leftLine+3),tiltDeg);
    }
  };

  const snapCardLine = (edge:CardEdge) => {
    const source=photoPixelsRef.current;
    if(!source) return;
    const line=cardLines[edge];
    const a={x:line.a.x/100*source.width,y:line.a.y/100*source.height};
    const b={x:line.b.x/100*source.width,y:line.b.y/100*source.height};
    const dx=b.x-a.x, dy=b.y-a.y;
    const len=Math.hypot(dx,dy);
    if(len<12) return;
    const ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
    const gray=(x:number,y:number)=>{
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const o=(iy*source.width+ix)*4;
      return source.data[o]*.299+source.data[o+1]*.587+source.data[o+2]*.114;
    };
    const radius=Math.max(7,Math.round(Math.min(source.width,source.height)*0.018/Math.max(zoom,1)));
    const points:Point[]=[];
    let totalScore=0;
    for(let i=1;i<=18;i++){
      const t=i/19;
      const px=a.x+dx*t, py=a.y+dy*t;
      let bestOffset=0, best=-Infinity;
      for(let off=-radius;off<=radius;off+=1){
        const qx=px+nx*off, qy=py+ny*off;
        const contrast=Math.abs(gray(qx+nx*2,qy+ny*2)-gray(qx-nx*2,qy-ny*2));
        const score=contrast-Math.abs(off)*0.35;
        if(score>best){best=score;bestOffset=off;}
      }
      if(best>7){ points.push({x:px+nx*bestOffset,y:py+ny*bestOffset}); totalScore+=best; }
    }
    if(points.length<8 || totalScore/points.length<9){
      setCardLineLocked((current)=>({...current,[edge]:false}));
      return;
    }
    const cx=points.reduce((s,p)=>s+p.x,0)/points.length;
    const cy=points.reduce((s,p)=>s+p.y,0)/points.length;
    let xx=0,xy=0,yy=0;
    for(const p of points){const x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y;}
    let theta=.5*Math.atan2(2*xy,xx-yy);
    let fx=Math.cos(theta),fy=Math.sin(theta);
    if(fx*ux+fy*uy<0){fx=-fx;fy=-fy;}
    const ta=(a.x-cx)*fx+(a.y-cy)*fy;
    const tb=(b.x-cx)*fx+(b.y-cy)*fy;
    const snapped:Line={
      a:{x:clamp((cx+fx*ta)/source.width*100,1,99),y:clamp((cy+fy*ta)/source.height*100,1,99)},
      b:{x:clamp((cx+fx*tb)/source.width*100,1,99),y:clamp((cy+fy*tb)/source.height*100,1,99)},
    };
    setCardLines((current)=>({...current,[edge]:snapped}));
    setCardLineLocked((current)=>({...current,[edge]:true}));
  };

  const finishDrag = (event:React.PointerEvent) => {
    const target=draggingRef.current;
    if(target==="left"||target==="right"){
      const refining=fingerRefineDragRef.current===target;
      if(refining){
        // Mantém exatamente a posição escolhida pelo usuário. A inclinação
        // detectada pelo ímã continua como referência visual.
        if(target==="left"){
          setLeftLocked(true);
          setLeftManualRefined(true);
        }else{
          setRightLocked(true);
          setRightManualRefined(true);
        }
      }else{
        snapBoundary(target,event.clientX);
      }
    }
    if(typeof target==="string"&&target.startsWith("finger-line-")){
      const match=/^finger-line-(left|right)/.exec(target);
      if(match){
        const side=match[1] as FingerSide;
        const line=fingerLines[side];
        syncFingerLineState(side,line);
      }
    }
    if(typeof target==="string"&&target.startsWith("card-line-")){
      const match=/^card-line-(top|right|bottom|left)/.exec(target);
      if(match) snapCardLine(match[1] as CardEdge);
    }
    draggingRef.current=null;
    fingerRefineDragRef.current=null;
    fingerLineDragStartRef.current=null;
    cardLineDragStartRef.current=null;
  };

  const fingerBandSamplesPx = () => {
    const stage = measureRef.current;
    const source = photoPixelsRef.current;
    if (!stage || !source || !leftLocked || !rightLocked) return null;
    const rect = stage.getBoundingClientRect();

    const toImageX = (percent: number) => (
      (((percent / 100 * rect.width) - rect.width / 2 - panX) / zoom + rect.width / 2) / rect.width * source.width
    );
    const toImageY = (percent: number) => (
      (((percent / 100 * rect.height) - rect.height / 2 - panY) / zoom + rect.height / 2) / rect.height * source.height
    );
    const toScreenXPercent = (imageX: number) => (
      (rect.width / 2 + (imageX / source.width * rect.width - rect.width / 2) * zoom + panX) / rect.width * 100
    );

    const lineXAtScreenY = (line:Line, yPercent:number) => {
      const dy=line.b.y-line.a.y;
      if(Math.abs(dy)<1e-6) return (line.a.x+line.b.x)/2;
      const t=clamp((yPercent-line.a.y)/dy,0,1);
      return line.a.x+(line.b.x-line.a.x)*t;
    };

    const searchRadius = Math.max(6, Math.round(14 / zoom));
    const grayscale = (x: number, y: number) => {
      const ix = Math.max(0, Math.min(source.width - 1, Math.round(x)));
      const iy = Math.max(0, Math.min(source.height - 1, Math.round(y)));
      const offset = (iy * source.width + ix) * 4;
      return source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
    };

    const findEdge = (center: number, y: number) => {
      let bestX = Math.round(center);
      let bestScore = -Infinity;
      for (let x = Math.round(center) - searchRadius; x <= Math.round(center) + searchRadius; x++) {
        if (x < 3 || x >= source.width - 3) continue;
        const contrast = Math.abs(grayscale(x - 2, y) - grayscale(x + 2, y));
        const score = contrast - Math.abs(x - center) * 0.55;
        if (score > bestScore) { bestScore = score; bestX = x; }
      }
      return { x: bestX, score: bestScore };
    };

    // Quatro pares magnéticos independentes, sempre horizontais.
    // As linhas laterais servem só como guia; cada par procura a borda local real.
    const yPercents = [-15, -5, 5, 15].map((offset)=>clamp(measureY + offset, 6, 94));
    const samples: {left:number;right:number;y:number;width:number;yPercent:number;leftPercent:number;rightPercent:number;confidence:number}[] = [];

    for (const yPercent of yPercents) {
      const y = toImageY(yPercent);
      if (y < 3 || y >= source.height - 3) continue;

      const leftGuidePercent = lineXAtScreenY(fingerLines.left, yPercent);
      const rightGuidePercent = lineXAtScreenY(fingerLines.right, yPercent);
      const leftGuide = toImageX(leftGuidePercent);
      const rightGuide = toImageX(rightGuidePercent);

      const leftEdge = findEdge(leftGuide, y);
      const rightEdge = findEdge(rightGuide, y);
      if (leftEdge.score < 8 || rightEdge.score < 8 || rightEdge.x <= leftEdge.x) continue;

      const confidence = Math.round(clamp(
        45 + Math.min(28, leftEdge.score * 0.55) + Math.min(28, rightEdge.score * 0.55),
        0, 99,
      ));

      samples.push({
        left:leftEdge.x,
        right:rightEdge.x,
        y,
        width:rightEdge.x-leftEdge.x,
        yPercent,
        leftPercent:toScreenXPercent(leftEdge.x),
        rightPercent:toScreenXPercent(rightEdge.x),
        confidence,
      });
    }

    if (samples.length < 3) return null;

    const orderedWidths = samples.map((sample)=>sample.width).sort((a,b)=>a-b);
    const medianWidth = orderedWidths[Math.floor(orderedWidths.length/2)];
    const tolerancePx = Math.max(3, medianWidth * 0.10);
    const filtered = samples.filter((sample)=>Math.abs(sample.width-medianWidth)<=tolerancePx);
    return filtered.length >= 3 ? filtered : samples;
  };

  const cardWidthAtImageY = (imageY:number, sourceWidth:number, sourceHeight:number) => {
    const toPx=(line:Line):Line=>({
      a:{x:line.a.x/100*sourceWidth,y:line.a.y/100*sourceHeight},
      b:{x:line.b.x/100*sourceWidth,y:line.b.y/100*sourceHeight},
    });
    const xAtY=(line:Line,y:number)=>{
      const dy=line.b.y-line.a.y;
      if(Math.abs(dy)<1e-6) return null;
      const t=(y-line.a.y)/dy;
      return line.a.x+(line.b.x-line.a.x)*t;
    };
    const leftX=xAtY(toPx(cardLines.left),imageY);
    const rightX=xAtY(toPx(cardLines.right),imageY);
    if(leftX===null||rightX===null||!Number.isFinite(leftX)||!Number.isFinite(rightX)) return null;
    const width=Math.abs(rightX-leftX);
    return width>1?width:null;
  };

  const liveWidthMm = useMemo(() => {
    if(!pixelsPerMm||!leftLocked||!rightLocked) return null;
    const source=photoPixelsRef.current;
    const stage=measureRef.current;
    if(!source||!stage) return null;

    const rect=stage.getBoundingClientRect();
    const samples=fingerBandSamplesPx();
    const toImageX=(percent:number)=>((((percent/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*source.width);
    const imageY=(((measureY/100*rect.height)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*source.height;

    const fallbackSample = {
      left: toImageX(leftLine),
      right: toImageX(rightLine),
      y: imageY,
      width: Math.abs(toImageX(rightLine)-toImageX(leftLine)),
    };
    const measurementSamples = samples && samples.length ? samples : [fallbackSample];

    const median = (values:number[]) => {
      const ordered=[...values].filter(Number.isFinite).sort((a,b)=>a-b);
      if(!ordered.length) return null;
      const middle=Math.floor(ordered.length/2);
      return ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
    };

    // Corrige a perspectiva de CADA linha da faixa e depois usa a mediana
    // das medidas. Assim uma única dobra, sombra ou altura ligeiramente
    // diferente não empurra o resultado inteiro para cima/baixo.
    const quadPx = cardQuad.map((point)=>({
      x: point.x/100*source.width,
      y: point.y/100*source.height,
    })) as [Point,Point,Point,Point];
    try {
      const mapToCardMm = homographyFromQuad(quadPx);
      const widthsMm = measurementSamples
        .map((sample)=>{
          const leftMm=mapToCardMm({x:sample.left,y:sample.y});
          const rightMm=mapToCardMm({x:sample.right,y:sample.y});
          return distance(leftMm,rightMm);
        })
        .filter((value)=>Number.isFinite(value)&&value>0&&value<45)
        .sort((a,b)=>a-b);

      // Com 4 leituras, usa a média central (descarta os extremos).
      // Se houver só 3 leituras válidas, usa a mediana.
      if(widthsMm.length>=4){
        const middle=widthsMm.slice(1,-1);
        return middle.reduce((sum,value)=>sum+value,0)/middle.length;
      }
      const stableWidthMm=median(widthsMm);
      if(stableWidthMm!==null) return stableWidthMm;
    } catch {
      // Cai no método defensivo abaixo.
    }

    // Fallback defensivo: calcula a razão cartão/dedo em várias alturas e
    // também usa a mediana, em vez de uma única leitura.
    const fallbackWidthsMm=measurementSamples.map((sample)=>{
      const cardReferencePx=cardWidthAtImageY(sample.y,source.width,source.height);
      if(!cardReferencePx||cardReferencePx<=0) return NaN;
      return sample.width/cardReferencePx*85.6;
    });
    const stableFallbackMm=median(fallbackWidthsMm);
    if(stableFallbackMm!==null) return stableFallbackMm;

    const cardBottomPx=Math.hypot(
      (cardQuad[2].x-cardQuad[3].x)/100*source.width,
      (cardQuad[2].y-cardQuad[3].y)/100*source.height,
    );
    if(cardBottomPx<=0) return null;
    return fallbackSample.width/cardBottomPx*85.6;
  },[pixelsPerMm,leftLine,rightLine,measureY,zoom,panX,panY,leftLocked,rightLocked,leftFingerTilt,rightFingerTilt,leftManualRefined,rightManualRefined,fingerLines,cardQuad,cardLines]);

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
    setLeftLocked(false);
    setRightLocked(false);
    setLeftManualRefined(false);
    setRightManualRefined(false);
    setTryOn(false);
    camera.setError("Reajuste as quatro linhas do cartão. A medição só será liberada com calibração de 90% ou mais.");
  };

  const result = useMemo(() => {
    if (liveWidthMm === null || calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE) return null;
    if (diameterPhotoTestMode) return computeDiameterOnlyTestResult(liveWidthMm, calibrationConfidence, 0.05);
    return computeRingResult(liveWidthMm, calibrationRules, measurementMode === "anelimetro", calibrationConfidence);
  }, [liveWidthMm, measurementMode, calibrationRules, calibrationConfidence, diameterPhotoTestMode]);

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

  const lineXAtMeasureY = (line: Line, fallbackX: number) => {
    const dy = line.b.y - line.a.y;
    if (Math.abs(dy) < 1e-6) return fallbackX;
    const t = clamp((measureY - line.a.y) / dy, 0, 1);
    return line.a.x + (line.b.x - line.a.x) * t;
  };

  const visualLeftX =
    phase === "finger" && leftLocked && rightLocked
      ? lineXAtMeasureY(fingerLines.left, leftLine)
      : leftLine;

  const visualRightX =
    phase === "finger" && leftLocked && rightLocked
      ? lineXAtMeasureY(fingerLines.right, rightLine)
      : rightLine;

  const visualBandLeft = Math.min(visualLeftX, visualRightX);
  const visualBandRight = Math.max(visualLeftX, visualRightX);
  const visualBandWidth = Math.max(0, visualBandRight - visualBandLeft);
  const visualBandCenter = visualBandLeft + visualBandWidth / 2;

  const fourMagnetSamples = phase === "finger" && leftLocked && rightLocked
    ? fingerBandSamplesPx()
    : null;

  // Guarda as quatro larguras horizontais em milímetros individualmente.
  // Essas medidas formam o perfil do dedo e serão usadas para descobrir a
  // correlação entre formato do dedo e equivalente do anelímetro.
  const fourMagnetWidthsMm = (() => {
    if (!fourMagnetSamples?.length) return [] as number[];
    const source = photoPixelsRef.current;
    if (!source) return [] as number[];

    const quadPx = cardQuad.map((point)=>({
      x: point.x / 100 * source.width,
      y: point.y / 100 * source.height,
    })) as [Point,Point,Point,Point];

    try {
      const mapToCardMm = homographyFromQuad(quadPx);
      return fourMagnetSamples
        .map((sample)=>{
          const leftMm = mapToCardMm({x:sample.left,y:sample.y});
          const rightMm = mapToCardMm({x:sample.right,y:sample.y});
          return distance(leftMm,rightMm);
        })
        .filter((value)=>Number.isFinite(value)&&value>0&&value<45)
        .map((value)=>Number(value.toFixed(2)));
    } catch {
      return fourMagnetSamples
        .map((sample)=>{
          const cardReferencePx = cardWidthAtImageY(sample.y,source.width,source.height);
          if(!cardReferencePx||cardReferencePx<=0) return NaN;
          return sample.width / cardReferencePx * 85.6;
        })
        .filter((value)=>Number.isFinite(value)&&value>0&&value<45)
        .map((value)=>Number(value.toFixed(2)));
    }
  })();

  return (
    <main className="app">
      <header className="brand">
        <span className="mark">◇</span>
        <div><strong>Medidor de Anel</strong><small>Paquímetro digital</small></div>
      </header>

      {stage === "intro" && (
        <IntroScreen
          error={camera.error}
          onMeasureFinger={() => { setDiameterPhotoTestMode(false); setMeasurementMode("finger"); void openCamera(); }}
          onTestGauge={() => { setDiameterPhotoTestMode(false); setMeasurementMode("anelimetro"); void openCamera(); }}
          onTestDiameterPhoto={() => { setDiameterPhotoTestMode(true); setMeasurementMode("finger"); void openCamera(); }}
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
          <span className="step">{phase === "card" ? "1. CALIBRE O CARTÃO" : diameterPhotoTestMode ? "2. MEÇA O DIÂMETRO INTERNO" : measurementMode === "anelimetro" ? "2. TESTE O ANELÍMETRO" : "2. MEÇA O DEDO"}</span>
          <h1>{phase === "card" ? "Ajuste as quatro bordas do cartão" : diameterPhotoTestMode ? "Encaixe as linhas nas bordas internas do anel" : measurementMode === "anelimetro" ? "Encaixe as linhas no anelímetro" : "Meça onde o anel vai ficar"}</h1>
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
                {fourMagnetSamples?.map((sample,index)=>(
                  <div
                    key={`magnet-pair-${index}`}
                    className="measurement-band"
                    style={{
                      left: `${sample.leftPercent}%`,
                      top: `${sample.yPercent}%`,
                      width: `${Math.max(0, sample.rightPercent-sample.leftPercent)}%`,
                      opacity: index===1 || index===2 ? 0.72 : 0.48,
                    }}
                    aria-hidden="true"
                  />
                ))}
                <div className="measurement-band" style={{ left: `${visualBandLeft}%`, top: `${measureY}%`, width: `${visualBandWidth}%` }} aria-hidden="true" />
                <button className={`measure-cross${tryOn ? " ring-adjust" : ""}`} style={{ left: `${visualBandLeft}%`, top: `${measureY}%`, width: `${visualBandWidth}%` }} onPointerDown={(event) => startDrag("height", event)} aria-label="Mover altura da medição" />
                <button className={`measure-height-handle${tryOn ? " ring-adjust" : ""}`} style={{ left: `${visualBandCenter}%`, top: `${Math.min(measureY + 19, 95)}%` }} onPointerDown={(event) => startDrag("height", event)}>{tryOn ? "AJUSTAR" : "ARRASTE"}</button>
              </>
            )}
            {phase === "finger" && result && leftLocked && rightLocked && !tryOn && (
              <div className="ring-size-badge" style={{ left: `${visualBandCenter}%` }} aria-live="polite">
                <span>ARO PROVÁVEL:</span>
                <strong>{result.ringSize}</strong>
              </div>
            )}
            {phase === "finger" && pixelsPerMm && tryOn && (
              <div
                className={`virtual-ring metal-${ringMetal} style-${ringStyle}`}
                style={{
                  left: `${visualBandCenter}%`,
                  top: `${measureY}%`,
                  width: `${Math.min(100, visualBandWidth)}%`,
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

          {phase === "finger" && result && leftLocked && rightLocked && (
            <div className="analysis-result">
              <strong>Aro provável: {result.ringSize}</strong>
              {diameterPhotoTestMode && <span>Diâmetro interno medido: {result.rawWidthMm.toFixed(2)} mm</span>}
              {diameterPhotoTestMode && <span>Diâmetro ajustado para 94%: {result.widthMm.toFixed(2)} mm</span>}
              {diameterPhotoTestMode && <span>Referência do aro: {result.equivalentDiameterMm.toFixed(2)} mm</span>}
              {diameterPhotoTestMode && <span>{result.nearBoundary ? "Zona morta ativa" : "Fora da zona morta"}{result.boundaryDistanceMm !== null ? " · " + result.boundaryDistanceMm.toFixed(2) + " mm da divisão" : ""}</span>}
              <span>Faixa recomendada: aro {clamp(result.ringSize - 1, 1, 40)} a {clamp(result.ringSize + 1, 1, 40)}</span>
              <span>MA bruto: {result.rawWidthMm.toFixed(1)} mm</span>
              {measurementMode === "anelimetro" ? (
                <>
                  <span>Medida corrigida: {result.widthMm.toFixed(1)} mm</span>
                  <span>Correção de bancada: {result.measurementCorrectionMm >= 0 ? "+" : ""}{result.measurementCorrectionMm.toFixed(2)} mm</span>
                </>
              ) : (
                <>
                  <span>MAB normalizado para 94%: {result.widthMm.toFixed(2)} mm</span>
                  {result.fingerEquivalentMabMm !== null && (
                    <span>MAB equivalente no anelímetro: {result.fingerEquivalentMabMm.toFixed(2)} mm</span>
                  )}
                </>
              )}
              <span>Diâmetro interno equivalente: {result.equivalentDiameterMm.toFixed(2)} mm</span>
              <span>Calibração do cartão: {calibrationConfidence}%</span>
              <span>Confiança final: {finalMeasurementConfidence}% · {calibrationQualityLabel}</span>
            </div>
          )}
          {phase === "finger" && result && leftLocked && rightLocked && !tryOn && !diameterPhotoTestMode && (
            <AdminCalibration
              measurement={{ widthMm: result.widthMm, ringSize: result.ringSize, magnetWidthsMm: fourMagnetWidthsMm }}
              calibrationConfidence={calibrationConfidence}
              zoom={zoom}
              defaultMeasurementType={measurementMode}
            />
          )}
          {phase === "finger" && leftLocked && rightLocked && fourMagnetSamples && !tryOn && (
            <div className="edge-status">
              <strong>4 ímãs horizontais ativos</strong>
              <span>{fourMagnetSamples.length}/4 leituras válidas · cálculo pela média central das medidas</span>
            </div>
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
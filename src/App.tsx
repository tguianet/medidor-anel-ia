import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeLiveCardGuide, calibratePhoto } from "./vision";
import AdminCalibration from "./AdminCalibration";
import { clamp, computeDiameterOnlyTestResult, computeRingResult, type CalibrationRule } from "./ringCalculation";
import { lineIntersection, type Line, type Point } from "./perspective";
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
const TEST_FINGER_CARD_NORMALIZATION = 0.908;

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
  // Snap matematico separado da linha visual. Depois que uma lateral encaixa
  // na borda real do cartao, a calibracao usa esta geometria travada mesmo
  // se a guia visual for arrastada alem da borda.
  const [cardSnapLines, setCardSnapLines] = useState<Partial<Record<CardEdge, Line>>>({});
  const [selectedCardLine, setSelectedCardLine] = useState<CardEdge | null>(null);
  const [perspectiveReady, setPerspectiveReady] = useState(false);
  const [leftLine, setLeftLine] = useState(25);
  const [rightLine, setRightLine] = useState(38);
  const [measureY, setMeasureY] = useState(60);
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
  const [fingerCardCalibrationStep, setFingerCardCalibrationStep] = useState<"reference" | "measurement" | "done">("reference");
  const [referenceCardLine, setReferenceCardLine] = useState<Line>({ a:{x:15,y:50}, b:{x:85,y:50} });
  const [referenceCardGuideLines, setReferenceCardGuideLines] = useState<Pick<Record<CardEdge, Line>,"left"|"right"|"bottom">>({
    left:{a:{x:15,y:20},b:{x:15,y:80}},
    right:{a:{x:85,y:20},b:{x:85,y:80}},
    bottom:{a:{x:15,y:50},b:{x:85,y:50}},
  });
  const [referenceCardLengthPx, setReferenceCardLengthPx] = useState<number | null>(null);

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

    // Modo dedo em duas fotos:
    // 1) cartão reto para definir a reta física de 85,60 mm;
    // 2) cartão sobre o dedo, reutilizando a mesma reta como gabarito e
    //    reajustando suas pontas na nova foto. A escala vem SOMENTE da
    //    reta ajustada na segunda foto.
    if (measurementMode === "finger" && !diameterPhotoTestMode && fingerCardCalibrationStep !== "done") {
      setPixelsPerMm(null);
      setCalibrationConfidence(0);
      setPhase("card");
      setZoom(1);
      setPanX(0);
      setPanY(0);
      setLeftLocked(false);
      setRightLocked(false);
      camera.stopCamera();
      setStage("review");
      setAnalyzingCard(false);
      setCardLineLocked({top:false,right:false,bottom:false,left:false});
      // A nova foto precisa adquirir seus proprios snaps laterais.
      setCardSnapLines({});
      setSelectedCardLine("bottom");

      if (fingerCardCalibrationStep === "reference") {
        try {
          const calibration = await calibratePhoto(capturedPhoto);
          const left = clamp(calibration.cardBox.x * 100, 4, 90);
          const right = clamp((calibration.cardBox.x + calibration.cardBox.width) * 100, 10, 96);
          const y = clamp((calibration.cardBox.y + calibration.cardBox.height * 0.5) * 100, 8, 92);
          const l=Math.min(left,right-5);
          const r=Math.max(right,left+5);
          const verticalHalf=20;
          setCardLines((current)=>({
            ...current,
            left:{a:{x:l,y:clamp(y-verticalHalf,2,98)},b:{x:l,y:clamp(y+verticalHalf,2,98)}},
            right:{a:{x:r,y:clamp(y-verticalHalf,2,98)},b:{x:r,y:clamp(y+verticalHalf,2,98)}},
            bottom:{a:{x:l,y},b:{x:r,y}},
          }));
          camera.setError("Foto 1: ajuste a reta exatamente de uma ponta à outra da largura de 85,60 mm do cartão.");
        } catch {
          setCardLines((current)=>({
            ...current,
            left:{a:{x:15,y:25},b:{x:15,y:75}},
            right:{a:{x:85,y:25},b:{x:85,y:75}},
            bottom:{a:{x:15,y:50},b:{x:85,y:50}},
          }));
          camera.setError("Foto 1: ajuste manualmente a reta de ponta a ponta do cartão. Essa reta vale 85,60 mm.");
        }
      } else {
        setCardLines((current)=>({
          ...current,
          left:{a:{...referenceCardGuideLines.left.a},b:{...referenceCardGuideLines.left.b}},
          right:{a:{...referenceCardGuideLines.right.a},b:{...referenceCardGuideLines.right.b}},
          bottom:{a:{...referenceCardGuideLines.bottom.a},b:{...referenceCardGuideLines.bottom.b}},
        }));
        camera.setError("Foto 2: ajuste a mesma reta sobre as duas pontas do cartão que está sobre o dedo.");
      }
      return;
    }
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



  const cardBaseFromCurrentLines = () => {
    const source = photoPixelsRef.current;
    if (!source) throw new Error("foto");

    const toPx = (line:Line):Line => ({
      a:{x:line.a.x/100*source.width,y:line.a.y/100*source.height},
      b:{x:line.b.x/100*source.width,y:line.b.y/100*source.height},
    });
    const leftPx = lineIntersection(toPx(cardLines.left), toPx(cardLines.bottom));
    const rightPx = lineIntersection(toPx(cardLines.right), toPx(cardLines.bottom));
    const widthPx = Math.hypot(rightPx.x-leftPx.x,rightPx.y-leftPx.y);
    if (!Number.isFinite(widthPx) || widthPx < source.width*0.08) throw new Error("base");

    const left = {x:leftPx.x/source.width*100,y:leftPx.y/source.height*100};
    const right = {x:rightPx.x/source.width*100,y:rightPx.y/source.height*100};
    const bottomY = (left.y+right.y)/2;

    // Mantém um quadrilátero sintético apenas para compatibilidade de estado.
    // A escala física passa a vir SOMENTE da base de 85,60 mm.
    const syntheticTopY = clamp(bottomY-28,2,96);
    const quadPercent:[Point,Point,Point,Point] = [
      {x:left.x,y:syntheticTopY},
      {x:right.x,y:syntheticTopY},
      right,
      left,
    ];
    return {left,right,widthPx,bottomY,quadPercent};
  };

  const confirmPerspective = () => {
    try {
      const base = cardBaseFromCurrentLines();
      const lockedCount = (["left","right","bottom"] as CardEdge[])
        .filter((edge)=>cardLineLocked[edge]).length;
      // A porcentagem fica apenas como diagnóstico; não corrige a medida.
      const confidence = lockedCount === 3 ? 96 : lockedCount === 2 ? 93 : 90;

      setCardQuad(base.quadPercent);
      setPerspectiveReady(true);
      setCalibrationConfidence(confidence);
      setCardLeft(base.left.x);
      setCardRight(base.right.x);
      setCardBottom(base.bottomY);
      activateFingerMeasurement(base.left.x,base.right.x,base.bottomY,confidence,base.quadPercent);
    } catch {
      camera.setError("Ajuste as duas laterais e a linha da base do cartão. A base precisa ficar entre as duas laterais.");
    }
  };

  const activateFingerMeasurement = (
    baseLeft:number, baseRight:number, baseBottom:number, confidence=92,
    quadPercent:[Point,Point,Point,Point]=cardQuad,
    pixelsPerMmOverride?: number,
  ) => {
    const source=photoPixelsRef.current;
    if(Number.isFinite(pixelsPerMmOverride) && (pixelsPerMmOverride ?? 0) > 0){
      setPixelsPerMm(pixelsPerMmOverride as number);
    } else if(source){
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

  const cardReferenceSegment = () => {
    const source=photoPixelsRef.current;
    if(!source) throw new Error("foto");
    const toPx=(line:Line):Line=>({
      a:{x:line.a.x/100*source.width,y:line.a.y/100*source.height},
      b:{x:line.b.x/100*source.width,y:line.b.y/100*source.height},
    });
    // No fluxo de duas fotos, a escala usa exclusivamente as laterais que
    // realmente encaixaram no snap. Arrastar a guia visual para alem da
    // borda nao pode alterar a medida.
    const requiresLockedSideSnaps =
      measurementMode==="finger" &&
      !diameterPhotoTestMode &&
      fingerCardCalibrationStep!=="done";
    const leftMeasureLine = requiresLockedSideSnaps ? cardSnapLines.left : cardLines.left;
    const rightMeasureLine = requiresLockedSideSnaps ? cardSnapLines.right : cardLines.right;
    if(!leftMeasureLine || !rightMeasureLine) throw new Error("snap-lateral");
    const leftPx=lineIntersection(toPx(leftMeasureLine),toPx(cardLines.bottom));
    const rightPx=lineIntersection(toPx(rightMeasureLine),toPx(cardLines.bottom));
    const lengthPx=Math.hypot(rightPx.x-leftPx.x,rightPx.y-leftPx.y);
    if(!Number.isFinite(lengthPx)||lengthPx<source.width*0.08) throw new Error("reta");
    return {leftPx,rightPx,lengthPx};
  };

  const cardReferencePreview = (() => {
    const source=photoPixelsRef.current;
    if(!source || phase!=="card" || measurementMode!=="finger" || diameterPhotoTestMode) return null;
    try{
      const segment=cardReferenceSegment();
      return {
        left:{x:segment.leftPx.x/source.width*100,y:segment.leftPx.y/source.height*100},
        right:{x:segment.rightPx.x/source.width*100,y:segment.rightPx.y/source.height*100},
        lengthPx:segment.lengthPx,
        mmPerPx:85.6/segment.lengthPx,
      };
    }catch{
      return null;
    }
  })();

  const confirmReferenceCardLine = () => {
    try{
      const segment=cardReferenceSegment();
      setReferenceCardLengthPx(segment.lengthPx);
      setReferenceCardLine({a:{...cardLines.bottom.a},b:{...cardLines.bottom.b}});
      setReferenceCardGuideLines({
        left:{a:{...cardLines.left.a},b:{...cardLines.left.b}},
        right:{a:{...cardLines.right.a},b:{...cardLines.right.b}},
        bottom:{a:{...cardLines.bottom.a},b:{...cardLines.bottom.b}},
      });
      setFingerCardCalibrationStep("measurement");
      camera.setError("Referência salva: as duas interseções representam 85,60 mm. Agora tire a segunda foto com o cartão sobre o dedo.");
      void openCamera();
    }catch{
      camera.setError("Encaixe as duas laterais no snap da borda do cartão. A linha central pode ser ajustada, mas a medida usa os snaps laterais travados.");
    }
  };

  const confirmMeasurementCardLine = () => {
    const source=photoPixelsRef.current;
    if(!source){
      camera.setError("A foto ainda está carregando. Tente confirmar novamente.");
      return;
    }
    try{
      const segment=cardReferenceSegment();
      const pxPerMm=segment.lengthPx/85.6;
      const leftPercent=segment.leftPx.x/source.width*100;
      const rightPercent=segment.rightPx.x/source.width*100;
      const lineMidY=(segment.leftPx.y+segment.rightPx.y)/2/source.height*100;
      setFingerCardCalibrationStep("done");
      setCalibrationConfidence(100);
      activateFingerMeasurement(leftPercent,rightPercent,lineMidY,100,cardQuad,pxPerMm);
    }catch{
      camera.setError("As duas laterais precisam estar encaixadas no snap do cartão. A linha central não altera as bordas matemáticas travadas.");
    }
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
      setMeasureY(clamp(dragStartRef.current.right + dy, 35, 82));
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
    // Pontos do dedo são 100% manuais; nunca há snap magnético.
    fingerRefineDragRef.current =
      target === "left" ? "left" :
      target === "right" ? "right" :
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

    // O usuario aproxima a linha da borda. O ima apenas refina localmente.
    const radius = Math.max(5, Math.round(9 / Math.max(1, zoom)));

    const grayscale = (x:number,y:number) => {
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const offset=(iy*source.width+ix)*4;
      return source.data[offset]*0.299+source.data[offset+1]*0.587+source.data[offset+2]*0.114;
    };

    // Descobre a polaridade esperada entre o lado externo e o interior do dedo.
    // Assim evitamos grudar em rugas/sombras internas.
    const outsideAt = (x:number,y:number) => side==="left" ? grayscale(x-8,y) : grayscale(x+8,y);
    const insideAt = (x:number,y:number) => side==="left" ? grayscale(x+8,y) : grayscale(x-8,y);
    const polarityRaw = outsideAt(imageX,imageY)-insideAt(imageX,imageY);
    const polarity = Math.abs(polarityRaw) >= 4 ? Math.sign(polarityRaw) : 0;

    const findEdgeAt = (center:number,y:number) => {
      let bestX=Math.round(center);
      let bestScore=-Infinity;

      for(let candidate=Math.round(center)-radius;candidate<=Math.round(center)+radius;candidate++){
        if(candidate<6||candidate>=source.width-6) continue;

        const outside = side==="left" ? grayscale(candidate-4,y) : grayscale(candidate+4,y);
        const inside = side==="left" ? grayscale(candidate+4,y) : grayscale(candidate-4,y);
        const signedContrast = outside-inside;

        // Se conseguimos inferir a polaridade do contorno, rejeitamos arestas
        // com direcao oposta (tipicamente textura/ruga dentro do dedo).
        const directionalContrast = polarity===0
          ? Math.abs(signedContrast)
          : Math.max(0, signedContrast*polarity);

        const distancePenalty=Math.abs(candidate-center)*1.35;
        const score=directionalContrast-distancePenalty;
        if(score>bestScore){bestScore=score;bestX=candidate;}
      }

      return {x:bestX,score:bestScore};
    };

    // Varias amostras verticais curtas para privilegiar um contorno continuo.
    const sampleOffsets=[-24,-16,-8,0,8,16,24].map(v=>v/Math.max(1,zoom));
    const rawPoints:{x:number;y:number;score:number}[]=[];

    for(const off of sampleOffsets){
      const y=Math.round(imageY+off);
      if(y<6||y>=source.height-6) continue;
      const edge=findEdgeAt(imageX,y);
      if(edge.score>=6) rawPoints.push({x:edge.x,y,score:edge.score});
    }

    const keepManual=()=>{
      if(side==="left"){
        setLeftLocked(true);
        setLeftMagnetConfidence(0);
        setLeftFingerTilt(0);
        setLeftManualRefined(true);
      }else{
        setRightLocked(true);
        setRightMagnetConfidence(0);
        setRightFingerTilt(0);
        setRightManualRefined(true);
      }
    };

    if(rawPoints.length<4){ keepManual(); return; }

    const median=(values:number[])=>{
      const ordered=[...values].sort((a,b)=>a-b);
      return ordered[Math.floor(ordered.length/2)];
    };

    const medianX=median(rawPoints.map(p=>p.x));
    const coherent=rawPoints.filter(p=>Math.abs(p.x-medianX)<=Math.max(2.5,radius*0.45));
    if(coherent.length<4){ keepManual(); return; }

    const cx=coherent.reduce((s,p)=>s+p.x,0)/coherent.length;
    const cy=coherent.reduce((s,p)=>s+p.y,0)/coherent.length;
    let yy=0,yx=0;
    for(const p of coherent){
      const dy=p.y-cy;
      yy+=dy*dy;
      yx+=dy*(p.x-cx);
    }
    const slope=yy>1?yx/yy:0;
    const predictedCenterX=cx+slope*(imageY-cy);

    const residual=median(coherent.map(p=>Math.abs(p.x-(cx+slope*(p.y-cy)))));
    const delta=predictedCenterX-imageX;
    if(Math.abs(delta)>radius || residual>2.6){ keepManual(); return; }

    const avgScore=coherent.reduce((s,p)=>s+p.score,0)/coherent.length;
    const confidence=Math.round(clamp(
      50 + coherent.length*5 + Math.min(28,avgScore*0.65) - residual*6,
      0,99,
    ));
    if(confidence<68){ keepManual(); return; }

    const snappedScreenX=rect.width/2+(predictedCenterX/source.width*rect.width-rect.width/2)*zoom+panX;
    const snappedPercent=clamp(snappedScreenX/rect.width*100,2,98);
    const tiltDeg=clamp(Math.atan(slope)*180/Math.PI,-7,7);

    if(side==="left"){
      const next=Math.min(snappedPercent,rightLine-3);
      setLeftLine(next);
      setLeftFingerTilt(tiltDeg);
      setLeftMagnetConfidence(confidence);
      setLeftManualRefined(false);
      setLeftLocked(true);
      setFingerLineFromCenterTilt("left",next,tiltDeg);
    }else{
      const next=Math.max(snappedPercent,leftLine+3);
      setRightLine(next);
      setRightFingerTilt(tiltDeg);
      setRightMagnetConfidence(confidence);
      setRightManualRefined(false);
      setRightLocked(true);
      setFingerLineFromCenterTilt("right",next,tiltDeg);
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
    // Guarda a borda magnetica separada da guia visual. O calculo do cartao
    // usa esta linha travada ate que um novo snap valido seja encontrado.
    setCardSnapLines((current)=>({...current,[edge]:snapped}));
    setCardLineLocked((current)=>({...current,[edge]:true}));
  };

  const finishDrag = (event:React.PointerEvent) => {
    const target=draggingRef.current;
    if(target==="left"||target==="right"){
      // Linha lateral híbrida: ao soltar, procura o contorno real do dedo.
      // Se a borda não for confiável, mantém exatamente o ajuste manual.
      snapBoundary(target,event.clientX);
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
      if(match){
        const edge=match[1] as CardEdge;
        if(measurementMode==="finger" && !diameterPhotoTestMode && fingerCardCalibrationStep!=="done"){
          if(edge==="left" || edge==="right"){
            // Laterais magnéticas: ao soltar, encaixam na borda real do cartão.
            snapCardLine(edge);
          }else if(edge==="bottom"){
            // Linha central continua manual. As bolinhas são apenas handles;
            // a medida válida é SEMPRE o trecho entre as duas interseções.
            setCardLineLocked((current)=>({...current,bottom:true}));
          }
        }else{
          snapCardLine(edge);
        }
      }
    }
    draggingRef.current=null;
    fingerRefineDragRef.current=null;
    fingerLineDragStartRef.current=null;
    cardLineDragStartRef.current=null;
  };

  const fingerBandSamplesPx = () => {
    const stage=measureRef.current;
    const source=photoPixelsRef.current;
    if(!stage||!source||!leftLocked||!rightLocked) return null;
    const rect=stage.getBoundingClientRect();

    const toImageX=(percent:number)=>(
      (((percent/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*source.width
    );
    const toImageY=(percent:number)=>(
      (((percent/100*rect.height)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*source.height
    );
    const toScreenXPercent=(imageX:number)=>(
      (rect.width/2+(imageX/source.width*rect.width-rect.width/2)*zoom+panX)/rect.width*100
    );
    const lineXAtScreenY=(line:Line,yPercent:number)=>{
      const dy=line.b.y-line.a.y;
      if(Math.abs(dy)<1e-6) return (line.a.x+line.b.x)/2;
      const t=clamp((yPercent-line.a.y)/dy,0,1);
      return line.a.x+(line.b.x-line.a.x)*t;
    };

    const grayscale=(x:number,y:number)=>{
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const o=(iy*source.width+ix)*4;
      return source.data[o]*0.299+source.data[o+1]*0.587+source.data[o+2]*0.114;
    };

    const searchRadius=Math.max(7,Math.round(16/Math.max(1,zoom)));
    const yPercents=[-4,-1.5,1.5,4].map(off=>clamp(measureY+off,6,94));

    const findEdge=(side:"left"|"right",guideX:number,y:number,previousX:number|null)=>{
      const outside=(x:number)=>side==="left"?grayscale(x-4,y):grayscale(x+4,y);
      const inside=(x:number)=>side==="left"?grayscale(x+4,y):grayscale(x-4,y);

      const expectedPolarityRaw=outside(guideX)-inside(guideX);
      const expectedPolarity=Math.abs(expectedPolarityRaw)>=3?Math.sign(expectedPolarityRaw):0;

      let bestX=Math.round(guideX);
      let bestScore=-Infinity;
      for(let x=Math.round(guideX)-searchRadius;x<=Math.round(guideX)+searchRadius;x++){
        if(x<6||x>=source.width-6) continue;

        const signed=outside(x)-inside(x);
        const edgeStrength=expectedPolarity===0?Math.abs(signed):Math.max(0,signed*expectedPolarity);
        const guidePenalty=Math.abs(x-guideX)*0.45;
        const continuityPenalty=previousX===null?0:Math.abs(x-previousX)*0.9;
        const score=edgeStrength-guidePenalty-continuityPenalty;

        if(score>bestScore){
          bestScore=score;
          bestX=x;
        }
      }
      return {x:bestX,score:bestScore};
    };

    // Cada um dos 4 níveis procura localmente a borda mais próxima,
    // mas com continuidade entre os níveis para formar UM contorno por lado.
    const leftPoints:{x:number;y:number;yPercent:number;score:number}[]=[];
    const rightPoints:{x:number;y:number;yPercent:number;score:number}[]=[];
    let previousLeft:number|null=null;
    let previousRight:number|null=null;

    for(const yPercent of yPercents){
      const y=toImageY(yPercent);
      if(y<6||y>=source.height-6) continue;

      const leftGuide=toImageX(lineXAtScreenY(fingerLines.left,yPercent));
      const rightGuide=toImageX(lineXAtScreenY(fingerLines.right,yPercent));

      const le=findEdge("left",leftGuide,y,previousLeft);
      const re=findEdge("right",rightGuide,y,previousRight);

      if(le.score<6||re.score<6||re.x<=le.x) continue;

      leftPoints.push({x:le.x,y,yPercent,score:le.score});
      rightPoints.push({x:re.x,y,yPercent,score:re.score});
      previousLeft=le.x;
      previousRight=re.x;
    }

    if(leftPoints.length!==4||rightPoints.length!==4) return null;

    // Rejeita saltos grandes entre pontos vizinhos: se uma ruga/sombra tentar
    // puxar um ponto para dentro, mantemos o contorno contínuo.
    const maxJump=Math.max(5,Math.round(10/Math.max(1,zoom)));
    for(let i=1;i<4;i++){
      if(Math.abs(leftPoints[i].x-leftPoints[i-1].x)>maxJump) return null;
      if(Math.abs(rightPoints[i].x-rightPoints[i-1].x)>maxJump) return null;
    }

    return leftPoints.map((leftPoint,index)=>{
      const rightPoint=rightPoints[index];
      return {
        left:leftPoint.x,
        right:rightPoint.x,
        y:leftPoint.y,
        width:rightPoint.x-leftPoint.x,
        yPercent:leftPoint.yPercent,
        leftPercent:toScreenXPercent(leftPoint.x),
        rightPercent:toScreenXPercent(rightPoint.x),
        confidence:Math.round(clamp(
          45+Math.min(26,leftPoint.score*.55)+Math.min(26,rightPoint.score*.55),
          0,99
        )),
      };
    });
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
    const toImageX=(percent:number)=>(
      (((percent/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*source.width
    );
    const fallbackWidth=Math.abs(toImageX(rightLine)-toImageX(leftLine));
    const widthsPx=samples?.length ? samples.map(s=>s.width) : [fallbackWidth];

    // TESTE CONTROLADO:
    // usa a escala REAL obtida pelo cartão na segunda foto e, no modo dedo,
    // aplica uma normalização provisória de 0,908 sobre a medida física bruta.
    const cardScaleMmPerPx = 1/pixelsPerMm;
    const normalization =
      measurementMode === "finger" && !diameterPhotoTestMode
        ? TEST_FINGER_CARD_NORMALIZATION
        : 1;

    const widthsMm=widthsPx
      .map(w=>w*cardScaleMmPerPx*normalization)
      .filter(v=>Number.isFinite(v)&&v>0&&v<45)
      .sort((a,b)=>a-b);
    if(!widthsMm.length) return null;
    if(widthsMm.length>=4){
      const middle=widthsMm.slice(1,-1);
      return middle.reduce((sum,v)=>sum+v,0)/middle.length;
    }
    const mid=Math.floor(widthsMm.length/2);
    return widthsMm.length%2 ? widthsMm[mid] : (widthsMm[mid-1]+widthsMm[mid])/2;
  },[pixelsPerMm,leftLine,rightLine,measureY,zoom,panX,panY,leftLocked,rightLocked,fingerLines,measurementMode,diameterPhotoTestMode]);

  const finalMeasurementConfidence = calibrationConfidence;

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
    camera.setError("Reajuste as duas laterais e a linha da base do cartão.");
  };

  const result = useMemo(() => {
    if (liveWidthMm === null) return null;
    if (measurementMode === "anelimetro" && calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE) return null;
    if (diameterPhotoTestMode) return computeDiameterOnlyTestResult(liveWidthMm, calibrationConfidence);
    return computeRingResult(liveWidthMm, calibrationRules, measurementMode === "anelimetro", calibrationConfidence);
  }, [liveWidthMm, measurementMode, calibrationRules, calibrationConfidence, diameterPhotoTestMode]);

  const resetPhoto = () => {
    if(measurementMode==="finger" && !diameterPhotoTestMode){
      setFingerCardCalibrationStep((current)=>current==="done" ? "measurement" : current);
    }
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

  const geometricScaleMmPerPx = (() => {
    if(phase!=="finger"||!pixelsPerMm||pixelsPerMm<=0) return null;
    return 1/pixelsPerMm;
  })();

  const fourMagnetSamples = phase==="finger" && leftLocked && rightLocked ? fingerBandSamplesPx() : null;

  const measurementAudit = (() => {
    if(!fourMagnetSamples?.length) return null;

    const rawWidthsPx=fourMagnetSamples.map((sample)=>sample.width).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!rawWidthsPx.length) return null;

    const centralWidthsPx =
      rawWidthsPx.length>=4
        ? rawWidthsPx.slice(1,-1)
        : rawWidthsPx;

    const usedWidthPx =
      centralWidthsPx.reduce((sum,value)=>sum+value,0)/centralWidthsPx.length;

    const cardScaleMmPerPx =
      pixelsPerMm && pixelsPerMm>0
        ? 1/pixelsPerMm
        : null;

    const rawCardMm =
      cardScaleMmPerPx!==null
        ? usedWidthPx*cardScaleMmPerPx
        : null;

    const normalizedMm =
      rawCardMm!==null
        ? rawCardMm*TEST_FINGER_CARD_NORMALIZATION
        : null;

    const correctionPercent=(1-TEST_FINGER_CARD_NORMALIZATION)*100;

    const spreadPx =
      rawWidthsPx.length
        ? rawWidthsPx[rawWidthsPx.length-1]-rawWidthsPx[0]
        : 0;

    const spreadPercent =
      usedWidthPx>0
        ? spreadPx/usedWidthPx*100
        : 0;

    return {
      rawWidthsPx,
      usedWidthPx,
      cardScaleMmPerPx,
      rawCardMm,
      normalizedMm,
      correctionPercent,
      spreadPx,
      spreadPercent,
    };
  })();

  const fourMagnetWidthsMm = (() => {
    if(!fourMagnetSamples?.length||!pixelsPerMm) return [] as number[];
    const cardScaleMmPerPx=1/pixelsPerMm;
    const normalization =
      measurementMode === "finger" && !diameterPhotoTestMode
        ? TEST_FINGER_CARD_NORMALIZATION
        : 1;
    return fourMagnetSamples.map(s=>Number((s.width*cardScaleMmPerPx*normalization).toFixed(2)));
  })();

  const singleFingerWidthMm = liveWidthMm !== null ? Number(liveWidthMm.toFixed(2)) : null;

  const guidedStep =
    phase === "card"
      ? (fingerCardCalibrationStep === "reference" ? 1 : 2)
      : phase === "finger"
        ? (result && leftLocked && rightLocked ? 4 : 3)
        : 1;

  const guideTitle =
    guidedStep === 1 ? "1. Calibre o cartão em uma base plana" :
    guidedStep === 2 ? "2. Fotografe o cartão sobre o dedo" :
    guidedStep === 3 ? "3. Ajuste o contorno na parte mais grossa" :
    "4. Confira os dois números";

  const guideText =
    guidedStep === 1
      ? "Ajuste as duas linhas laterais nas bordas do cartão. Quando elas estiverem verdes, confira a linha central e salve a referência de 85,60 mm."
      : guidedStep === 2
        ? "Coloque o cartão sobre o dedo que será medido. Posicione a região mais grossa — junta ou falange — na linha guia. Ajuste as laterais do cartão e confirme."
        : guidedStep === 3
          ? "Mova a faixa até a parte mais grossa do dedo, exatamente onde o anel precisa passar. Aproxime as laterais e solte para os 4 pontos magnéticos grudarem no contorno."
          : "Número exato = encaixa no dedo. Número de conforto = uma folga para passar pela junta e ficar mais confortável.";

  return (
    <main className="app">
      <header className="brand">
        <span className="mark">◇</span>
        <div><strong>Medidor de Anel</strong><small>Paquímetro digital</small></div>
      </header>

      {stage === "intro" && (
        <IntroScreen
          error={camera.error}
          onMeasureFinger={() => { setDiameterPhotoTestMode(false); setMeasurementMode("finger"); setFingerCardCalibrationStep("reference"); void openCamera(); }}
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
          calibrationStep={fingerCardCalibrationStep}
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
          {measurementMode === "finger" && !diameterPhotoTestMode && (
            <div
              role="status"
              style={{
                margin:"0 0 14px",
                padding:"14px 16px",
                border:"1px solid rgba(220,180,90,.65)",
                borderRadius:16,
                background:"rgba(34,27,17,.96)",
                display:"grid",
                gap:6
              }}
            >
              <small style={{color:"#d7b35f",fontWeight:800,letterSpacing:".12em"}}>PASSO {guidedStep} DE 4</small>
              <strong style={{fontSize:"1.05rem"}}>{guideTitle}</strong>
              <span style={{lineHeight:1.45,opacity:.9}}>{guideText}</span>
            </div>
          )}
          <span className="step">{
            phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode
              ? (fingerCardCalibrationStep === "reference" ? "1. CARTÃO RETO — RETA DE 85,60 MM" : "2. CARTÃO SOBRE O DEDO")
              : phase === "card" ? "1. CALIBRE O CARTÃO"
              : diameterPhotoTestMode ? "2. MEÇA O DIÂMETRO INTERNO"
              : measurementMode === "anelimetro" ? "2. TESTE O ANELÍMETRO"
              : "3. MEÇA O DEDO"
          }</span>
          <h1>{
            phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode
              ? (fingerCardCalibrationStep === "reference" ? "Ajuste a reta de ponta a ponta do cartão" : "Reajuste a mesma reta no cartão sobre o dedo")
              : phase === "card" ? "Ajuste as laterais e a base do cartão"
              : diameterPhotoTestMode ? "Encaixe as linhas nas bordas internas do anel"
              : measurementMode === "anelimetro" ? "Encaixe as linhas no anelímetro"
              : "Meça onde o anel vai ficar"
          }</h1>
          <div
            ref={measureRef}
            className="measurement-stage is-active"
            onPointerDown={startPan}
            onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
            onPointerUp={finishDrag}
            onPointerCancel={() => { draggingRef.current = null; }}
          >
            {photo && <img className="zoomable-photo" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }} src={photo} alt="Fotografia para medição" draggable={false} />}
            {phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode ? (
              <svg
                className="card-lines-overlay"
                style={{transform:`translate(${panX}px, ${panY}px) scale(${zoom})`}}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Duas laterais e linha central de referência do cartão"
              >
                {(["left","right","bottom"] as CardEdge[]).map((edge)=>{
                  const line=cardLines[edge];
                  const locked=cardLineLocked[edge];
                  return <g key={edge} className={`card-edge${locked?" locked":""}`}>
                    <line className="card-line-hit" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y}
                      onPointerDown={(e)=>startCardLineDrag(edge,null,e)} />
                    <line className="card-line-visible" x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />
                    {(["a","b"] as const).map((point)=><g key={point}>
                      <circle className="card-line-handle-hit" cx={line[point].x} cy={line[point].y} r="5.0"
                        onPointerDown={(e)=>startCardLineDrag(edge,point,e)} />
                      <circle className="card-line-handle" cx={line[point].x} cy={line[point].y} r="1.45" />
                    </g>)}
                  </g>;
                })}
                {cardReferencePreview && (
                  <g className="card-reference-snaps" aria-label="Interseções válidas de 85,60 milímetros">
                    <line
                      className="card-reference-segment"
                      x1={cardReferencePreview.left.x}
                      y1={cardReferencePreview.left.y}
                      x2={cardReferencePreview.right.x}
                      y2={cardReferencePreview.right.y}
                    />
                    <circle
                      className="card-reference-snap"
                      cx={cardReferencePreview.left.x}
                      cy={cardReferencePreview.left.y}
                      r="1.65"
                    />
                    <circle
                      className="card-reference-snap"
                      cx={cardReferencePreview.right.x}
                      cy={cardReferencePreview.right.y}
                      r="1.65"
                    />
                  </g>
                )}
              </svg>
            ) : phase === "card" ? (
              <svg
                className="card-lines-overlay"
                style={{transform:`translate(${panX}px, ${panY}px) scale(${zoom})`}}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Três linhas magnéticas do cartão"
              >
                {(["left","right","bottom"] as CardEdge[]).map((edge)=>{
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
              </svg>
            ) : null}
            {phase === "finger" && pixelsPerMm && (
              <>
                <div
                  className="manual-finger-line guide top"
                  style={{ left: `${visualBandLeft}%`, top: `${measureY - 3.2}%`, width: `${visualBandWidth}%` }}
                  aria-hidden="true"
                />
                {fourMagnetSamples?.map((sample,index)=>(
                  <div
                    key={`magnet-pair-${index}`}
                    className="measurement-band"
                    style={{
                      left:`${sample.leftPercent}%`,
                      top:`${sample.yPercent}%`,
                      width:`${Math.max(0,sample.rightPercent-sample.leftPercent)}%`,
                      opacity:index===1||index===2?0.72:0.48,
                    }}
                    aria-hidden="true"
                  />
                ))}
                {fourMagnetSamples && (
                  <svg
                    className="finger-contour-overlay"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:5}}
                  >
                    <polyline
                      points={fourMagnetSamples.map((sample)=>`${sample.leftPercent},${sample.yPercent}`).join(" ")}
                      fill="none"
                      stroke="#52e0a3"
                      strokeWidth="0.45"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points={fourMagnetSamples.map((sample)=>`${sample.rightPercent},${sample.yPercent}`).join(" ")}
                      fill="none"
                      stroke="#52e0a3"
                      strokeWidth="0.45"
                      vectorEffect="non-scaling-stroke"
                    />
                    {fourMagnetSamples.flatMap((sample,index)=>[
                      <circle key={`left-contour-${index}`} cx={sample.leftPercent} cy={sample.yPercent} r="0.65" fill="#52e0a3" />,
                      <circle key={`right-contour-${index}`} cx={sample.rightPercent} cy={sample.yPercent} r="0.65" fill="#52e0a3" />,
                    ])}
                  </svg>
                )}
                <div
                  className="manual-finger-line main"
                  style={{ left: `${visualBandLeft}%`, top: `${measureY}%`, width: `${visualBandWidth}%` }}
                  aria-hidden="true"
                />
                <div
                  className="manual-finger-line guide bottom"
                  style={{ left: `${visualBandLeft}%`, top: `${measureY + 3.2}%`, width: `${visualBandWidth}%` }}
                  aria-hidden="true"
                />
                <button
                  className={`finger-side-point left${leftLocked ? " locked" : ""}`}
                  style={{ left: `${leftLine}%`, top: `${measureY}%`, transform: `translate(-50%,-50%) rotate(${leftFingerTilt.toFixed(2)}deg)` }}
                  onPointerDown={(event)=>startDrag("left",event)}
                  aria-label="Ponto manual esquerdo do dedo"
                />
                <button
                  className={`finger-side-point right${rightLocked ? " locked" : ""}`}
                  style={{ left: `${rightLine}%`, top: `${measureY}%`, transform: `translate(-50%,-50%) rotate(${rightFingerTilt.toFixed(2)}deg)` }}
                  onPointerDown={(event)=>startDrag("right",event)}
                  aria-label="Ponto manual direito do dedo"
                />
                <button
                  className={`measure-line-hit${tryOn ? " ring-adjust" : ""}`}
                  style={{ left: `${visualBandLeft}%`, top: `${measureY}%`, width: `${visualBandWidth}%` }}
                  onPointerDown={(event) => startDrag("height", event)}
                  aria-label="Mover altura da linha de medição"
                />
              </>
            )}
            {phase === "finger" && result && leftLocked && rightLocked && !tryOn && (
              <div className="ring-size-badge" style={{ left: `${visualBandCenter}%` }} aria-live="polite">
                <span>NÚMERO EXATO:</span>
                <strong>{result.ringSize}</strong>
                <small>Conforto: {clamp(result.ringSize + 1, 1, 40)} · recomendado com folga</small>
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

          {analyzingCard && <p className="analysis-loading">Localizando o cartão...</p>}
          {phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode && !analyzingCard && (
            <>
              <button
                className="primary confirm-perspective"
                type="button"
                onClick={fingerCardCalibrationStep === "reference" ? confirmReferenceCardLine : confirmMeasurementCardLine}
              >
                {fingerCardCalibrationStep === "reference" ? "Salvar calibração e ir para a foto 2" : "Confirmar cartão e ajustar o dedo"}
              </button>
              <div className="card-base-status">
                <strong>{fingerCardCalibrationStep === "reference" ? "Foto 1 — calibração do cartão" : "Foto 2 — cartão sobre o dedo"}</strong>
                <span>{fingerCardCalibrationStep === "reference"
                  ? "Ajuste somente as duas laterais nas bordas do cartão até encaixarem. A linha central já serve como referência do meio."
                  : "Confira as laterais do cartão sobre o dedo. A região mais grossa do dedo deve estar alinhada com a guia antes de confirmar."}</span>
                <small>{fingerCardCalibrationStep === "reference"
                  ? "Base plana, câmera de cima e cartão sem inclinação. O trecho entre as duas interseções vale 85,60 mm."
                  : "Meça na parte mais grossa do dedo — junta ou falange — porque é por ali que o anel precisa passar."}</small>
                {cardReferencePreview && (
                  <>
                    <small><strong>Segmento válido:</strong> 85,60 mm · {cardReferencePreview.lengthPx.toFixed(1)} px</small>
                    <small><strong>Escala desta foto:</strong> {cardReferencePreview.mmPerPx.toFixed(4)} mm/px</small>
                  </>
                )}
                {fingerCardCalibrationStep === "measurement" && referenceCardLengthPx !== null && (
                  <small><strong>Foto 1 salva:</strong> 85,60 mm = {referenceCardLengthPx.toFixed(1)} px</small>
                )}
                <small>Na segunda foto repita o mesmo ajuste; a distância entre essas duas interseções gera a escala px/mm usada no dedo.</small>
              </div>
            </>
          )}
          {phase === "card" && !(measurementMode === "finger" && !diameterPhotoTestMode) && !analyzingCard && <div className="card-line-status">
            {(["left","right","bottom"] as CardEdge[]).map((edge)=><span key={edge} className={cardLineLocked[edge] ? "locked" : ""}>
              {cardLineLocked[edge] ? "✓" : "○"} {edge==="bottom"?"Base":edge==="left"?"Esquerda":"Direita"}
            </span>)}
          </div>}
          {phase === "card" && !(measurementMode === "finger" && !diameterPhotoTestMode) && !analyzingCard && <button className="primary confirm-perspective" type="button" onClick={confirmPerspective}>Confirmar linhas e medir o dedo</button>}
          {phase === "card" && !(measurementMode === "finger" && !diameterPhotoTestMode) && !analyzingCard && (
            <div className="card-base-status">
              <strong>Ajuste as 2 laterais e a linha da base</strong>
              <span>Arraste a linha inteira para mover. Arraste as bolinhas das pontas para inclinar. Ao soltar, o ímã procura a borda.</span>
              <small>A largura é calculada exatamente na linha da base. Essa distância representa os 85,60 mm do cartão.</small>
              <small>As 3 linhas mantêm o ímã: aproxime da borda e solte para encaixar automaticamente.</small>
            </div>
          )}

          {phase === "finger" && measurementMode === "anelimetro" && calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE && (
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
              <strong>Número exato: {result.ringSize}</strong>
              {measurementMode === "finger" && (
                <>
                  <span><strong>Número de conforto: {clamp(result.ringSize + 1, 1, 40)}</strong></span>
                  <small>Exato = encaixa no dedo · Conforto = uma folga para passar pela junta.</small>
                </>
              )}
              {diameterPhotoTestMode && <span>Diâmetro interno medido: {result.rawWidthMm.toFixed(2)} mm</span>}
              {diameterPhotoTestMode && <span>Diâmetro ajustado para 94%: {result.widthMm.toFixed(2)} mm</span>}
              {diameterPhotoTestMode && <span>Referência do aro: {result.equivalentDiameterMm.toFixed(2)} mm</span>}
              {!diameterPhotoTestMode && measurementMode === "finger" && (
                <>
                  <span>Medida do dedo: {result.widthMm.toFixed(2)} mm</span>
                </>
              )}
              {!diameterPhotoTestMode && measurementMode === "anelimetro" && (
                <>
                  <span>Medida normalizada: {result.widthMm.toFixed(2)} mm</span>
                  <span>Diâmetro interno equivalente: {result.equivalentDiameterMm.toFixed(2)} mm</span>
                </>
              )}
              {measurementMode === "finger" && <span>Referência do cartão: reta ajustada de 85,60 mm na 2ª foto</span>}
              {measurementMode === "finger" && geometricScaleMmPerPx !== null && (
                <span>Escala pela reta: {geometricScaleMmPerPx.toFixed(4)} mm/px</span>
              )}
              {measurementMode === "finger" && !diameterPhotoTestMode && (
                <>
                  <span>Normalização provisória aplicada: × {TEST_FINGER_CARD_NORMALIZATION.toFixed(3)}</span>
                  {measurementAudit && (
                    <>
                      <strong>DIAGNÓSTICO DA MEDIÇÃO</strong>
                      <span>Larguras detectadas: {measurementAudit.rawWidthsPx.map((value)=>value.toFixed(1)).join(" / ")} px</span>
                      <span>Largura em px usada no cálculo: {measurementAudit.usedWidthPx.toFixed(2)} px</span>
                      <span>Variação dos 4 pontos: {measurementAudit.spreadPx.toFixed(2)} px · {measurementAudit.spreadPercent.toFixed(2)}%</span>
                      {measurementAudit.cardScaleMmPerPx !== null && (
                        <span>Escala real do cartão: {measurementAudit.cardScaleMmPerPx.toFixed(4)} mm/px</span>
                      )}
                      {measurementAudit.rawCardMm !== null && (
                        <span>Medida bruta pela escala do cartão: {measurementAudit.rawCardMm.toFixed(2)} mm</span>
                      )}
                      {measurementAudit.normalizedMm !== null && (
                        <span>Medida após normalização: {measurementAudit.normalizedMm.toFixed(2)} mm</span>
                      )}
                      <span>Correção aplicada: -{measurementAudit.correctionPercent.toFixed(1)}%</span>
                      {referenceCardLengthPx !== null && (
                        <span>Foto 1 do cartão: 85,60 mm = {referenceCardLengthPx.toFixed(1)} px</span>
                      )}
                    </>
                  )}
                </>
              )}
              {measurementMode === "anelimetro" && <span>Calibração do cartão: {calibrationConfidence}%</span>}
              {measurementMode === "anelimetro" && <span>Confiança final: {finalMeasurementConfidence}% · {calibrationQualityLabel}</span>}
            </div>
          )}
          {phase === "finger" && result && leftLocked && rightLocked && !tryOn && !diameterPhotoTestMode && (
            <AdminCalibration
              measurement={{ widthMm: result.widthMm, ringSize: result.ringSize, magnetWidthsMm: fourMagnetWidthsMm.length ? fourMagnetWidthsMm : (singleFingerWidthMm !== null ? [singleFingerWidthMm] : []) }}
              calibrationConfidence={calibrationConfidence}
              zoom={zoom}
              defaultMeasurementType={measurementMode}
            />
          )}
          {phase === "finger" && !tryOn && !diameterPhotoTestMode && (
            <div className="edge-status">
              <strong>Meça na parte mais grossa do dedo</strong>
              <span>Use a junta ou falange por onde o anel precisa passar. Depois aproxime as laterais e solte.</span>
            </div>
          )}
          {phase === "finger" && !tryOn && !diameterPhotoTestMode && (
            <div className="edge-status">
              <strong>4 pontos magnéticos no contorno</strong>
              <span>{fourMagnetSamples ? `${fourMagnetSamples.length}/4 leituras válidas · cada ponto busca a borda próxima e os 4 formam um contorno contínuo` : "Aproxime as laterais do dedo e solte para o ímã encaixar"}</span>
            </div>
          )}
          {phase === "finger" && !tryOn && <div className="edge-status">
            <strong>{leftLocked && rightLocked ? "Laterais posicionadas" : "Ajuste as 2 laterais"}</strong>
            <span>
              {leftLocked ? (leftMagnetConfidence > 0 ? `✓ Esquerda magnética ${leftMagnetConfidence}%` : "✓ Esquerda manual") : "○ Ajuste a esquerda"}
              {" · "}
              {rightLocked ? (rightMagnetConfidence > 0 ? `✓ Direita magnética ${rightMagnetConfidence}%` : "✓ Direita manual") : "○ Ajuste a direita"}
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
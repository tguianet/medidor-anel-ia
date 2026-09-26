import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeLiveCardGuide, calibratePhoto } from "../vision";
import { clamp, computeDiameterOnlyTestResult, computeRingResult, type CalibrationRule } from "../ringCalculation";
import { lineIntersection, type Line, type Point } from "../perspective";
import { useCameraStream } from "../useCameraStream";
import type { CardEdge, DragTarget, FingerSide, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "../types";
import { wearableRingImage } from "../types";
import IntroScreen from "../components/IntroScreen";
import CameraScreen from "../components/CameraScreen";
import HandCameraScreen from "../components/HandCameraScreen";
import HandReviewScreen from "../components/HandReviewScreen";
import TryOnPanel from "../components/TryOnPanel";
import { classifyFingerWidthMm } from "./ringClassifier";

const MIN_CARD_CALIBRATION_CONFIDENCE = 90;
const HIGH_CARD_CALIBRATION_CONFIDENCE = 92;
// V2: mantido apenas para compatibilidade dos diagnosticos herdados. Sem correcao historica.
const TEST_FINGER_CARD_NORMALIZATION = 1;
const CARD_WIDTH_MM = 85.6;
const CARD_HEIGHT_MM = 53.98;
type Homography = [number,number,number,number,number,number,number,number,number];

const solveLinearSystem = (matrix:number[][], values:number[]) => {
  const n=values.length;
  const a=matrix.map((row,i)=>[...row,values[i]]);
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let row=col+1;row<n;row++){
      if(Math.abs(a[row][col])>Math.abs(a[pivot][col])) pivot=row;
    }
    if(Math.abs(a[pivot][col])<1e-9) throw new Error("homography-singular");
    [a[col],a[pivot]]=[a[pivot],a[col]];
    const divisor=a[col][col];
    for(let j=col;j<=n;j++) a[col][j]/=divisor;
    for(let row=0;row<n;row++){
      if(row===col) continue;
      const factor=a[row][col];
      for(let j=col;j<=n;j++) a[row][j]-=factor*a[col][j];
    }
  }
  return a.map(row=>row[n]);
};

const buildHomography = (
  source:[Point,Point,Point,Point],
  target:[Point,Point,Point,Point],
):Homography => {
  const rows:number[][]=[];
  const values:number[]=[];
  for(let i=0;i<4;i++){
    const {x,y}=source[i];
    const {x:u,y:v}=target[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y]);
    values.push(u);
    rows.push([0,0,0,x,y,1,-v*x,-v*y]);
    values.push(v);
  }
  const h=solveLinearSystem(rows,values);
  return [h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
};

const projectPoint = (h:Homography, point:Point):Point => {
  const d=h[6]*point.x+h[7]*point.y+h[8];
  if(Math.abs(d)<1e-9) throw new Error("homography-denominator");
  return {
    x:(h[0]*point.x+h[1]*point.y+h[2])/d,
    y:(h[3]*point.x+h[4]*point.y+h[5])/d,
  };
};

export default function AppV2() {
  const camera = useCameraStream();
  // Diagnostico privado: fica dentro da mesma pagina para nao interferir
  // com permissao/ciclo da camera. Toque 5 vezes no simbolo da marca.
  const [debugMode, setDebugMode] = useState(false);
  const debugTapRef = useRef({ count: 0, lastTap: 0 });
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const cardLineDragStartRef = useRef<{ pointer: Point; line: Line } | null>(null);
  const autoCaptureTimerRef = useRef<number | null>(null);
  const autoCaptureLockedRef = useRef(false);
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
  const [ringGuideY, setRingGuideY] = useState(60);
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
  const [fingerLoupe, setFingerLoupe] = useState<{side:"left"|"right";imageX:number;imageY:number}|null>(null);
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
  const [singlePhotoTestMode, setSinglePhotoTestMode] = useState(false);
  const [calibrationRules, setCalibrationRules] = useState<CalibrationRule[]>([]);
  const [fingerCardCalibrationStep, setFingerCardCalibrationStep] = useState<"reference" | "measurement" | "done">("reference");
  const [referenceCardLine, setReferenceCardLine] = useState<Line>({ a:{x:15,y:50}, b:{x:85,y:50} });
  const [referenceCardGuideLines, setReferenceCardGuideLines] = useState<Pick<Record<CardEdge, Line>,"left"|"right"|"bottom">>({
    left:{a:{x:15,y:20},b:{x:15,y:80}},
    right:{a:{x:85,y:20},b:{x:85,y:80}},
    bottom:{a:{x:15,y:50},b:{x:85,y:50}},
  });
  const [referenceCardLengthPx, setReferenceCardLengthPx] = useState<number | null>(null);
  const [referenceCardWidthPercent, setReferenceCardWidthPercent] = useState<number | null>(null);
  const [referenceCardAngleDeg, setReferenceCardAngleDeg] = useState<number | null>(null);
  const [measurementCardLengthPx, setMeasurementCardLengthPx] = useState<number | null>(null);
  const [perspectiveMismatchPercent, setPerspectiveMismatchPercent] = useState<number | null>(null);
  const [referenceCardQuad, setReferenceCardQuad] = useState<[Point,Point,Point,Point] | null>(null);
  const [measurementCardHomography, setMeasurementCardHomography] = useState<Homography | null>(null);
  const cardCornerDragRef = useRef<{index:number;start:Point;pointer:Point} | null>(null);

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

  useEffect(() => {
    const shouldAutoCapture =
      stage === "camera" &&
      !camera.cameraOpening &&
      !camera.error &&
      cardReady &&
      measurementMode === "finger" &&
      !diameterPhotoTestMode &&
      // Foto 1 pode ser automatica. Na Foto 2 o usuario precisa casar o
      // cartao com o calibrador fantasma salvo da Foto 1 antes de capturar.
      fingerCardCalibrationStep === "reference";

    if (!shouldAutoCapture) {
      if (autoCaptureTimerRef.current !== null) {
        window.clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
      return;
    }

    if (autoCaptureLockedRef.current || autoCaptureTimerRef.current !== null) return;

    // Exige verde estavel por 800 ms para evitar capturas em um unico frame.
    autoCaptureTimerRef.current = window.setTimeout(() => {
      autoCaptureTimerRef.current = null;
      if (
        autoCaptureLockedRef.current ||
        stage !== "camera" ||
        !cardReady ||
        camera.cameraOpening ||
        camera.error
      ) return;

      autoCaptureLockedRef.current = true;
      void capture();
    }, 800);

    return () => {
      if (autoCaptureTimerRef.current !== null) {
        window.clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [
    stage,
    cardReady,
    camera.cameraOpening,
    camera.error,
    measurementMode,
    diameterPhotoTestMode,
    fingerCardCalibrationStep,
  ]);

  const openCamera = async () => {
    if (autoCaptureTimerRef.current !== null) {
      window.clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }
    autoCaptureLockedRef.current = false;
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
    if (autoCaptureLockedRef.current && stage !== "camera") return;
    const video = camera.videoRef.current;
    if (!video?.videoWidth) {
      autoCaptureLockedRef.current = false;
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
      setCardSnapLines({});
      setSelectedCardLine(null);
      setMeasurementCardHomography(null);

      try {
        const calibration = await calibratePhoto(capturedPhoto);
        const detectedLeft = clamp(calibration.cardBox.x * 100, 2, 94);
        const detectedRight = clamp((calibration.cardBox.x + calibration.cardBox.width) * 100, 6, 98);
        const finalLeft = Math.min(detectedLeft, detectedRight - 5);
        const finalRight = Math.max(detectedRight, detectedLeft + 5);
        const finalBottom = clamp((calibration.cardBox.y + calibration.cardBox.height) * 100, 10, 88);
        const top = clamp(calibration.cardBox.y * 100, 3, finalBottom - 5);
        const padY = Math.min(7, Math.max(3, (finalBottom-top)*0.15));

        setCardLeft(finalLeft);
        setCardRight(finalRight);
        setCardBottom(finalBottom);
        setCardLines({
          top:{a:{x:finalLeft,y:top},b:{x:finalRight,y:top}},
          right:{a:{x:finalRight,y:clamp(top-padY,1,99)},b:{x:finalRight,y:clamp(finalBottom+padY,1,99)}},
          bottom:{a:{x:finalLeft,y:finalBottom},b:{x:finalRight,y:finalBottom}},
          left:{a:{x:finalLeft,y:clamp(top-padY,1,99)},b:{x:finalLeft,y:clamp(finalBottom+padY,1,99)}},
        });
      } catch {
        setCardLeft(15);
        setCardRight(85);
        setCardBottom(58);
        setCardLines({
          top:{a:{x:15,y:28},b:{x:85,y:28}},
          right:{a:{x:85,y:22},b:{x:85,y:64}},
          bottom:{a:{x:15,y:58},b:{x:85,y:58}},
          left:{a:{x:15,y:22},b:{x:15,y:64}},
        });
      }

      camera.setError(
        fingerCardCalibrationStep === "reference"
          ? "Foto 1: ajuste as 2 laterais e a base do cartão."
          : "Foto 2: ajuste novamente as 2 laterais e a base do cartão sobre o dedo."
      );
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
    setRingGuideY(nextMeasureY);
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

  const automaticCardReferenceLine = (left: Line, right: Line): Line => {
    // A reta de 85,60 mm deve representar a largura REAL entre as duas
    // laterais do cartao. Ligar simplesmente o meio das laterais pode encurtar
    // ou alongar a referencia quando as duas guias possuem inclinacoes ou
    // comprimentos diferentes. Em vez disso, construimos uma reta perpendicular
    // a direcao media das duas laterais e usamos as intersecoes exatas.
    const midpoint = (line: Line): Point => ({
      x: (line.a.x + line.b.x) / 2,
      y: (line.a.y + line.b.y) / 2,
    });
    const normalizedDirection = (line: Line) => {
      const dx=line.b.x-line.a.x;
      const dy=line.b.y-line.a.y;
      const len=Math.hypot(dx,dy);
      if(len<1e-6) return null;
      return {x:dx/len,y:dy/len};
    };

    const leftMid=midpoint(left);
    const rightMid=midpoint(right);
    const dl=normalizedDirection(left);
    const dr0=normalizedDirection(right);
    if(!dl || !dr0) return {a:leftMid,b:rightMid};

    // Mantem as duas direcoes apontando para o mesmo sentido antes da media.
    const dot=dl.x*dr0.x+dl.y*dr0.y;
    const dr=dot<0 ? {x:-dr0.x,y:-dr0.y} : dr0;
    const avgX=dl.x+dr.x;
    const avgY=dl.y+dr.y;
    const avgLen=Math.hypot(avgX,avgY);
    if(avgLen<1e-6) return {a:leftMid,b:rightMid};

    const ux=avgX/avgLen;
    const uy=avgY/avgLen;
    const nx=-uy;
    const ny=ux;
    const center={x:(leftMid.x+rightMid.x)/2,y:(leftMid.y+rightMid.y)/2};

    // Segmento longo apenas para calcular as intersecoes com as laterais.
    const crossLine:Line={
      a:{x:center.x-nx*120,y:center.y-ny*120},
      b:{x:center.x+nx*120,y:center.y+ny*120},
    };
    try{
      const a=lineIntersection(left,crossLine);
      const b=lineIntersection(right,crossLine);
      if(
        Number.isFinite(a.x) && Number.isFinite(a.y) &&
        Number.isFinite(b.x) && Number.isFinite(b.y) &&
        Math.hypot(b.x-a.x,b.y-a.y)>5
      ){
        return {a,b};
      }
    }catch{
      // fallback abaixo
    }
    return {a:leftMid,b:rightMid};
  };

  const cardReferenceSegment = () => {
    const source=photoPixelsRef.current;
    if(!source) throw new Error("foto");
    const toPx=(line:Line):Line=>({
      a:{x:line.a.x/100*source.width,y:line.a.y/100*source.height},
      b:{x:line.b.x/100*source.width,y:line.b.y/100*source.height},
    });

    const useSnap =
      measurementMode==="finger" &&
      !diameterPhotoTestMode &&
      fingerCardCalibrationStep!=="done";

    const leftMeasureLine = useSnap ? (cardSnapLines.left ?? cardLines.left) : cardLines.left;
    const rightMeasureLine = useSnap ? (cardSnapLines.right ?? cardLines.right) : cardLines.right;
    const bottomMeasureLine = useSnap ? (cardSnapLines.bottom ?? cardLines.bottom) : cardLines.bottom;

    const leftPx=lineIntersection(toPx(leftMeasureLine),toPx(bottomMeasureLine));
    const rightPx=lineIntersection(toPx(rightMeasureLine),toPx(bottomMeasureLine));
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

  const quadPixels = (quad:[Point,Point,Point,Point]) => {
    const source=photoPixelsRef.current;
    if(!source) throw new Error("foto");
    return quad.map((p)=>({x:p.x/100*source.width,y:p.y/100*source.height})) as [Point,Point,Point,Point];
  };

  const quadAverageWidthPx = (quad:[Point,Point,Point,Point]) => {
    const px=quadPixels(quad);
    const top=Math.hypot(px[1].x-px[0].x,px[1].y-px[0].y);
    const bottom=Math.hypot(px[2].x-px[3].x,px[2].y-px[3].y);
    return (top+bottom)/2;
  };

  const validateCardQuad = (quad:[Point,Point,Point,Point]) => {
    const px=quadPixels(quad);
    const polygonArea=Math.abs(
      px.reduce((sum,p,i)=>{
        const next=px[(i+1)%4];
        return sum+p.x*next.y-next.x*p.y;
      },0)/2
    );
    const source=photoPixelsRef.current!;
    if(polygonArea<source.width*source.height*0.015) throw new Error("quad-small");
    return px;
  };

  const confirmReferenceCardLine = () => {
    try{
      const segment=cardReferenceSegment();
      const source=photoPixelsRef.current;
      setReferenceCardLengthPx(segment.lengthPx);
      if(source){
        setReferenceCardWidthPercent(segment.lengthPx/source.width*100);
      }
      setReferenceCardAngleDeg(
        Math.atan2(
          segment.rightPx.y-segment.leftPx.y,
          segment.rightPx.x-segment.leftPx.x,
        )*180/Math.PI,
      );
      setReferenceCardQuad(null);
      setFingerCardCalibrationStep("measurement");
      camera.setError("Calibração de 3 linhas salva. Agora fotografe o cartão sobre o dedo.");
      void openCamera();
    }catch{
      camera.setError("Ajuste as duas laterais e a linha da base exatamente nas bordas do cartão.");
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
      const widthPx=segment.lengthPx;
      setMeasurementCardLengthPx(widthPx);

      if(referenceCardLengthPx!==null && referenceCardLengthPx>0){
        setPerspectiveMismatchPercent(Math.abs((widthPx/referenceCardLengthPx-1)*100));
      }else{
        setPerspectiveMismatchPercent(null);
      }

      // Volta ao metodo de 3 linhas: a escala vem diretamente da largura
      // de 85,60 mm medida na linha da base da foto 2. Sem homografia.
      setMeasurementCardHomography(null);
      const pxPerMm=widthPx/CARD_WIDTH_MM;

      const leftPercent={x:segment.leftPx.x/source.width*100,y:segment.leftPx.y/source.height*100};
      const rightPercent={x:segment.rightPx.x/source.width*100,y:segment.rightPx.y/source.height*100};
      const bottomY=(leftPercent.y+rightPercent.y)/2;
      const syntheticTopY=clamp(bottomY-28,2,96);
      const quad:[Point,Point,Point,Point]=[
        {x:leftPercent.x,y:syntheticTopY},
        {x:rightPercent.x,y:syntheticTopY},
        rightPercent,
        leftPercent,
      ];

      setFingerCardCalibrationStep("done");
      setCalibrationConfidence(96);
      activateFingerMeasurement(leftPercent.x,rightPercent.x,bottomY,96,quad,pxPerMm);
    }catch{
      camera.setError("Ajuste as duas laterais e a linha da base exatamente nas bordas do cartão.");
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
    if(typeof target==="string" && target.startsWith("card-corner-")){
      const match=/^card-corner-(0|1|2|3)$/.exec(target);
      const start=cardCornerDragRef.current;
      if(match && start){
        const index=Number(match[1]);
        const dx=imageX-start.pointer.x;
        const dy=imageY-start.pointer.y;
        setCardQuad((current)=>{
          const next=current.map((p)=>({...p})) as [Point,Point,Point,Point];
          next[index]={
            x:clamp(start.start.x+dx,1,99),
            y:clamp(start.start.y+dy,1,99),
          };
          return next;
        });
      }
      return;
    }
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
      const nextLeft=Math.min(x, rightLine - 3);
      setLeftLine(nextLeft);
      const lineScreenX=nextLeft/100*rect.width;
      const lineImageX=((lineScreenX-rect.width/2-panX)/zoom+rect.width/2)/rect.width*100;
      const guideScreenY=ringGuideY/100*rect.height;
      const guideImageY=((guideScreenY-rect.height/2-panY)/zoom+rect.height/2)/rect.height*100;
      setFingerLoupe({side:"left",imageX:clamp(lineImageX,0,100),imageY:clamp(guideImageY,0,100)});
    }
    if (target === "right") {
      if (fingerRefineDragRef.current !== "right") {
        setRightLocked(false);
        setRightMagnetConfidence(0);
        setRightFingerTilt(0);
        setRightManualRefined(false);
      }
      const nextRight=Math.max(x, leftLine + 3);
      setRightLine(nextRight);
      const lineScreenX=nextRight/100*rect.width;
      const lineImageX=((lineScreenX-rect.width/2-panX)/zoom+rect.width/2)/rect.width*100;
      const guideScreenY=ringGuideY/100*rect.height;
      const guideImageY=((guideScreenY-rect.height/2-panY)/zoom+rect.height/2)/rect.height*100;
      setFingerLoupe({side:"right",imageX:clamp(lineImageX,0,100),imageY:clamp(guideImageY,0,100)});
    }
    if (target === "height") {
      setLeftLocked(false);
      setRightLocked(false);
      setLeftManualRefined(false);
      setRightManualRefined(false);
      const dy = ((clientY - dragStartRef.current.y) / rect.height) * 100;
      const nextY=clamp(dragStartRef.current.right + dy, 30, 88);
      setMeasureY(nextY);
      setRingGuideY(nextY);
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
    dragStartRef.current = { x: event.clientX, y: event.clientY, left: cardLeft, top: cardBottom, right: target === "height" ? ringGuideY : cardRight, bottom: cardBottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target !== "height") updateDrag(event.clientX, event.clientY);
  };

  const startCardCornerDrag = (index:number, event:React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const stage=measureRef.current;
    if(!stage) return;
    const rect=stage.getBoundingClientRect();
    const imageX=(((event.clientX-rect.left)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*100;
    const imageY=(((event.clientY-rect.top)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*100;
    const point=cardQuad[index];
    draggingRef.current=(`card-corner-${index}` as DragTarget);
    cardCornerDragRef.current={index,start:{...point},pointer:{x:imageX,y:imageY}};
    event.currentTarget.setPointerCapture(event.pointerId);
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
      const candidates:{x:number;contrast:number;score:number}[]=[];
      const start=Math.round(center)-radius;
      const end=Math.round(center)+radius;

      for(let candidate=start;candidate<=end;candidate++){
        if(candidate<6||candidate>=source.width-6) continue;

        const outside = side==="left" ? grayscale(candidate-4,y) : grayscale(candidate+4,y);
        const inside = side==="left" ? grayscale(candidate+4,y) : grayscale(candidate-4,y);
        const signedContrast = outside-inside;

        // Mantem somente transicoes com a polaridade esperada da borda externa.
        const directionalContrast = polarity===0
          ? Math.abs(signedContrast)
          : Math.max(0, signedContrast*polarity);

        if(directionalContrast<5) continue;

        const distancePenalty=Math.abs(candidate-center)*0.55;
        candidates.push({
          x:candidate,
          contrast:directionalContrast,
          score:directionalContrast-distancePenalty,
        });
      }

      if(!candidates.length) return {x:Math.round(center),score:-Infinity};

      // Primeiro identifica quanto e uma aresta realmente forte nesta faixa.
      const strongest=Math.max(...candidates.map(item=>item.contrast));
      const strongEnough=Math.max(7,strongest*0.62);
      const valid=candidates.filter(item=>item.contrast>=strongEnough);

      // As comparacoes +/-4 px criam uma pequena "faixa" de candidatos
      // fortes ao redor da mesma borda. Escolher o pixel mais externo dessa
      // faixa exagerava a largura em alguns dedos. Agora agrupamos candidatos
      // contiguos, escolhemos o GRUPO externo e usamos o centro ponderado do
      // gradiente dentro desse grupo.
      const sorted=[...valid].sort((a,b)=>a.x-b.x);
      const groups:{x:number;contrast:number;score:number}[][]=[];
      for(const item of sorted){
        const last=groups[groups.length-1];
        if(!last || item.x-last[last.length-1].x>1) groups.push([item]);
        else last.push(item);
      }
      const chosenGroup = side==="left" ? groups[0] : groups[groups.length-1];
      if(chosenGroup?.length){
        const weight=chosenGroup.reduce((sum,item)=>sum+Math.max(1,item.contrast),0);
        const x=chosenGroup.reduce((sum,item)=>sum+item.x*Math.max(1,item.contrast),0)/weight;
        const score=chosenGroup.reduce((sum,item)=>sum+item.score,0)/chosenGroup.length;
        return {x,score};
      }
      return candidates.reduce((best,item)=>item.score>best.score?item:best,candidates[0]);
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
    // Snap lateral propositalmente curto: o usuario aproxima a guia da borda
    // correta e o ima apenas faz o refinamento final. Isso impede que a linha
    // pule para sombra, textura ou outra aresta do cartao.
    const baseRadius = edge==="left" || edge==="right" ? 6 : 9;
    const radius=Math.max(3,Math.round(baseRadius/Math.max(1,zoom)));
    const points:Point[]=[];
    const snapOffsets:number[]=[];
    let totalScore=0;
    for(let i=1;i<=18;i++){
      const t=i/19;
      const px=a.x+dx*t, py=a.y+dy*t;
      let bestOffset=0, best=-Infinity;
      for(let off=-radius;off<=radius;off+=1){
        const qx=px+nx*off, qy=py+ny*off;
        const contrast=Math.abs(gray(qx+nx*2,qy+ny*2)-gray(qx-nx*2,qy-ny*2));

        // Penalidade forte de distancia: a borda correta precisa estar
        // praticamente embaixo da guia. Assim nao "pesca" outra linha.
        const distancePenalty=Math.abs(off)*(edge==="left" || edge==="right" ? 1.6 : 0.55);
        const score=contrast-distancePenalty;
        if(score>best){best=score;bestOffset=off;}
      }
      if(best>8){
        points.push({x:px+nx*bestOffset,y:py+ny*bestOffset});
        snapOffsets.push(bestOffset);
        totalScore+=best;
      }
    }
    if(points.length<10 || totalScore/points.length<10){
      setCardLineLocked((current)=>({...current,[edge]:false}));
      return;
    }
    let snapped:Line;

    if(edge==="left" || edge==="right"){
      // IMPORTANTE: nas laterais o snap agora SOMENTE TRANSLADA a guia.
      // Ele nao gira, nao alonga e nao encurta a linha desenhada pelo usuario.
      // Isso evita que o ima altere indiretamente a largura usada na calibracao.
      const orderedOffsets=[...snapOffsets].sort((v1,v2)=>v1-v2);
      const medianOffset=orderedOffsets[Math.floor(orderedOffsets.length/2)] ?? 0;
      snapped={
        a:{
          x:clamp((a.x+nx*medianOffset)/source.width*100,1,99),
          y:clamp((a.y+ny*medianOffset)/source.height*100,1,99),
        },
        b:{
          x:clamp((b.x+nx*medianOffset)/source.width*100,1,99),
          y:clamp((b.y+ny*medianOffset)/source.height*100,1,99),
        },
      };
    }else{
      // Para linhas nao laterais mantemos o ajuste angular existente.
      const cx=points.reduce((s,p)=>s+p.x,0)/points.length;
      const cy=points.reduce((s,p)=>s+p.y,0)/points.length;
      let xx=0,xy=0,yy=0;
      for(const p of points){const x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y;}
      let theta=.5*Math.atan2(2*xy,xx-yy);
      let fx=Math.cos(theta),fy=Math.sin(theta);
      if(fx*ux+fy*uy<0){fx=-fx;fy=-fy;}
      const ta=(a.x-cx)*fx+(a.y-cy)*fy;
      const tb=(b.x-cx)*fx+(b.y-cy)*fy;
      snapped={
        a:{x:clamp((cx+fx*ta)/source.width*100,1,99),y:clamp((cy+fy*ta)/source.height*100,1,99)},
        b:{x:clamp((cx+fx*tb)/source.width*100,1,99),y:clamp((cy+fy*tb)/source.height*100,1,99)},
      };
    }
    // Validacao extra das laterais: elas precisam continuar em lados
    // diferentes e manter uma largura plausivel antes de substituir o snap.
    if(edge==="left" || edge==="right"){
      const otherEdge = edge==="left" ? "right" : "left";
      const other = cardSnapLines[otherEdge];
      if(other){
        const midpoint=(lineToUse:Line)=>({
          x:(lineToUse.a.x+lineToUse.b.x)/2,
          y:(lineToUse.a.y+lineToUse.b.y)/2,
        });
        const here=midpoint(snapped);
        const there=midpoint(other);
        const leftX=edge==="left" ? here.x : there.x;
        const rightX=edge==="right" ? here.x : there.x;
        if(rightX-leftX<12){
          setCardLineLocked((current)=>({...current,[edge]:false}));
          return;
        }
      }
    }

    setCardLines((current)=>({...current,[edge]:snapped}));
    // Guarda a borda magnetica separada da guia visual. O calculo do cartao
    // usa esta linha travada ate que um novo snap valido seja encontrado.
    setCardSnapLines((current)=>({...current,[edge]:snapped}));
    setCardLineLocked((current)=>({...current,[edge]:true}));
  };

  const finishDrag = (event:React.PointerEvent) => {
    const target=draggingRef.current;
    if(target==="left"){
      setLeftLocked(true);
      setLeftMagnetConfidence(0);
      setLeftManualRefined(true);
      setFingerLines((current)=>({...current,left:{a:{x:leftLine,y:0},b:{x:leftLine,y:100}}}));
    }
    if(target==="right"){
      setRightLocked(true);
      setRightMagnetConfidence(0);
      setRightManualRefined(true);
      setFingerLines((current)=>({...current,right:{a:{x:rightLine,y:0},b:{x:rightLine,y:100}}}));
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
        snapCardLine(edge);
      }
    }
    draggingRef.current=null;
    fingerRefineDragRef.current=null;
    fingerLineDragStartRef.current=null;
    cardLineDragStartRef.current=null;
    cardCornerDragRef.current=null;
    setFingerLoupe(null);
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
    const toScreenYPercent=(imageY:number)=>(
      (rect.height/2+(imageY/source.height*rect.height-rect.height/2)*zoom+panY)/rect.height*100
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

    // Hibrido: busca curta em torno das linhas manuais. O algoritmo nao pode
    // sair procurando outra textura longe da borda indicada pelo usuario.
    const seedRadius=Math.max(6,Math.round(14/Math.max(1,zoom)));
    const trackRadius=Math.max(5,Math.round(10/Math.max(1,zoom)));

    // 50 cortes centrados exatamente na linha amarela que simula a altura do anel.
    // As linhas verdes sao o gabarito; cada corte apenas refina alguns pixels
    // para encontrar a borda real do dedo.
    const rawYPercents=Array.from({length:50},(_,index)=>{
      const off=-10+(index*(20/49));
      return clamp(ringGuideY+off,6,94);
    });
    const yPercents=rawYPercents.filter((value,index,array)=>
      index===0 || Math.abs(value-array[index-1])>0.02
    );

    const findEdge=(
      side:"left"|"right",
      centerX:number,
      y:number,
      previousX:number|null,
      radius:number,
    )=>{
      const outside=(x:number)=>side==="left"?grayscale(x-4,y):grayscale(x+4,y);
      const inside=(x:number)=>side==="left"?grayscale(x+4,y):grayscale(x-4,y);

      const expectedPolarityRaw=outside(centerX)-inside(centerX);
      const expectedPolarity=Math.abs(expectedPolarityRaw)>=3?Math.sign(expectedPolarityRaw):0;
      const candidates:{x:number;strength:number;score:number}[]=[];

      for(let x=Math.round(centerX)-radius;x<=Math.round(centerX)+radius;x++){
        if(x<6||x>=source.width-6) continue;

        const signed=outside(x)-inside(x);
        const edgeStrength=expectedPolarity===0?Math.abs(signed):Math.max(0,signed*expectedPolarity);
        if(edgeStrength<5) continue;

        // Depois da semente, centerX ja e a ultima borda encontrada.
        // A penalidade de distancia mantem o rastreamento grudado no mesmo
        // contorno em vez de voltar a procurar perto da guia manual.
        const guidePenalty=Math.abs(x-centerX)*(previousX===null?0.28:1.05);
        const continuityPenalty=previousX===null?0:Math.abs(x-previousX)*1.15;
        candidates.push({
          x,
          strength:edgeStrength,
          score:edgeStrength-guidePenalty-continuityPenalty,
        });
      }

      if(!candidates.length) return {x:Math.round(centerX),score:-Infinity};

      const strongest=Math.max(...candidates.map(item=>item.strength));
      const strongEnough=Math.max(7,strongest*0.60);
      let valid=candidates.filter(item=>item.strength>=strongEnough);

      if(previousX!==null){
        const continuityLimit=Math.max(4,Math.round(6/Math.max(1,zoom)));
        const continuous=valid.filter(item=>Math.abs(item.x-previousX)<=continuityLimit);
        if(!continuous.length) return {x:Math.round(previousX),score:-Infinity};
        valid=continuous;
      }

      const sorted=[...valid].sort((a,b)=>a.x-b.x);
      const groups:{x:number;strength:number;score:number}[][]=[];
      for(const item of sorted){
        const last=groups[groups.length-1];
        if(!last || item.x-last[last.length-1].x>1) groups.push([item]);
        else last.push(item);
      }

      // Na semente ainda preferimos a transicao externa. Durante o tracking,
      // como a busca ja esta centrada na borda anterior, escolhemos o grupo
      // mais proximo dessa borda para impedir saltos para outra textura.
      let chosenGroup:{x:number;strength:number;score:number}[]|undefined;
      if(previousX===null){
        chosenGroup=side==="left" ? groups[0] : groups[groups.length-1];
      }else{
        chosenGroup=groups.reduce((best,group)=>{
          const center=group.reduce((sum,item)=>sum+item.x,0)/group.length;
          const bestCenter=best.reduce((sum,item)=>sum+item.x,0)/best.length;
          return Math.abs(center-previousX)<Math.abs(bestCenter-previousX)?group:best;
        },groups[0]);
      }

      if(chosenGroup?.length){
        const weight=chosenGroup.reduce((sum,item)=>sum+Math.max(1,item.strength),0);
        const x=chosenGroup.reduce((sum,item)=>sum+item.x*Math.max(1,item.strength),0)/weight;
        const score=chosenGroup.reduce((sum,item)=>sum+item.score,0)/chosenGroup.length;
        return {x,score};
      }

      return {x:Math.round(centerX),score:-Infinity};
    };

    type EdgePoint={x:number;y:number;yPercent:number;score:number};
    type EdgePair={left:EdgePoint;right:EdgePoint};

    const sampleAt=(
      yPercent:number,
      leftCenter:number,
      rightCenter:number,
      previousLeft:number|null,
      previousRight:number|null,
      radius:number,
    ):EdgePair|null=>{
      const y=toImageY(yPercent);
      if(y<6||y>=source.height-6) return null;

      const le=findEdge("left",leftCenter,y,previousLeft,radius);
      const re=findEdge("right",rightCenter,y,previousRight,radius);
      if(le.score<6||re.score<6||re.x<=le.x) return null;

      return {
        left:{x:le.x,y,yPercent,score:le.score},
        right:{x:re.x,y,yPercent,score:re.score},
      };
    };

    // Encontra a semente perto da linha amarela. As linhas manuais continuam
    // limitando a busca durante toda a varredura.
    const centerIndex=yPercents.reduce((bestIndex,value,index)=>
      Math.abs(value-ringGuideY)<Math.abs(yPercents[bestIndex]-ringGuideY)?index:bestIndex
    ,0);

    let seedIndex=-1;
    let seed:EdgePair|null=null;
    const seedOrder:number[]=[centerIndex];
    for(let distanceIndex=1;distanceIndex<7;distanceIndex++){
      if(centerIndex-distanceIndex>=0) seedOrder.push(centerIndex-distanceIndex);
      if(centerIndex+distanceIndex<yPercents.length) seedOrder.push(centerIndex+distanceIndex);
    }

    for(const index of seedOrder){
      const yPercent=yPercents[index];
      const leftGuide=toImageX(leftLine);
      const rightGuide=toImageX(rightLine);
      const candidate=sampleAt(yPercent,leftGuide,rightGuide,null,null,seedRadius);
      if(candidate){
        seedIndex=index;
        seed=candidate;
        break;
      }
    }
    if(seedIndex<0||!seed) return null;

    const pairs:EdgePair[]=[seed];

    const traceDirection=(step:-1|1)=>{
      let previousLeft=seed!.left.x;
      let previousRight=seed!.right.x;
      let misses=0;

      for(let index=seedIndex+step;index>=0&&index<yPercents.length;index+=step){
        const yPercent=yPercents[index];

        // Cada corte volta a usar as linhas manuais como centro de busca.
        // A borda anterior entra apenas como continuidade, impedindo saltos.
        const manualLeft=toImageX(leftLine);
        const manualRight=toImageX(rightLine);
        let pair=sampleAt(
          yPercent,
          manualLeft,
          manualRight,
          previousLeft,
          previousRight,
          trackRadius,
        );

        // Uma unica segunda tentativa um pouco mais larga, ainda presa ao
        // gabarito manual. Nunca procura livremente pelo dedo inteiro.
        if(!pair){
          pair=sampleAt(
            yPercent,
            manualLeft,
            manualRight,
            previousLeft,
            previousRight,
            Math.max(trackRadius+2,Math.round(trackRadius*1.5)),
          );
        }

        if(!pair){
          misses++;
          if(misses>=3) break;
          continue;
        }

        misses=0;
        pairs.push(pair);
        previousLeft=pair.left.x;
        previousRight=pair.right.x;
      }
    };

    traceDirection(-1);
    traceDirection(1);

    pairs.sort((a,b)=>a.left.yPercent-b.left.yPercent);
    const leftPoints=pairs.map(pair=>pair.left);
    const rightPoints=pairs.map(pair=>pair.right);

    // V2: leitura comercial so e aceita quando praticamente toda a faixa foi
    // rastreada. Um resultado com poucos cortes validos nao pode virar aro.
    if(leftPoints.length<35||rightPoints.length<35||leftPoints.length!==rightPoints.length) return null;

    // Evita que o rastreador salte de uma borda anatomica para outra textura.
    // Mantemos tolerancia pequena para a curvatura real do dedo.
    const maxJump=Math.max(5,Math.round(8/Math.max(1,zoom)));
    for(let i=1;i<leftPoints.length;i++){
      if(Math.abs(leftPoints[i].x-leftPoints[i-1].x)>maxJump) return null;
      if(Math.abs(rightPoints[i].x-rightPoints[i-1].x)>maxJump) return null;
    }

    const medianValue=(values:number[])=>{
      const ordered=[...values].sort((a,b)=>a-b);
      const mid=Math.floor(ordered.length/2);
      return ordered.length%2
        ? ordered[mid]
        : (ordered[mid-1]+ordered[mid])/2;
    };
    const leftMedian=medianValue(leftPoints.map(p=>p.x));
    const rightMedian=medianValue(rightPoints.map(p=>p.x));
    const inwardTolerance=Math.max(2.5,Math.round(4/Math.max(1,zoom)));

    for(const point of leftPoints){
      if(point.x-leftMedian>inwardTolerance) point.x=leftMedian;
    }
    for(const point of rightPoints){
      if(rightMedian-point.x>inwardTolerance) point.x=rightMedian;
    }

    const fitXByY=(points:{x:number;y:number}[])=>{
      const meanY=points.reduce((s,p)=>s+p.y,0)/points.length;
      const meanX=points.reduce((s,p)=>s+p.x,0)/points.length;
      let yy=0,yx=0;
      for(const p of points){
        const dy=p.y-meanY;
        yy+=dy*dy;
        yx+=dy*(p.x-meanX);
      }
      const slope=yy>1e-6?yx/yy:0;
      const intercept=meanX-slope*meanY;
      return {slope,intercept};
    };

    const leftFit=fitXByY(leftPoints);
    const rightFit=fitXByY(rightPoints);
    const axisSlope=clamp((leftFit.slope+rightFit.slope)/2,-0.45,0.45);
    const normalLength=Math.hypot(1,axisSlope);
    const nx=1/normalLength;
    const ny=-axisSlope/normalLength;
    const axisAngleDeg=Math.atan(axisSlope)*180/Math.PI;

    return leftPoints.map((leftPoint,index)=>{
      const rightPoint=rightPoints[index];
      const denominator=nx-rightFit.slope*ny;
      let t=denominator!==0
        ? (rightFit.slope*leftPoint.y+rightFit.intercept-leftPoint.x)/denominator
        : rightPoint.x-leftPoint.x;

      if(!Number.isFinite(t) || t<=0){
        t=(rightPoint.x-leftPoint.x)*Math.cos(Math.atan(axisSlope));
      }

      const orthogonalRightX=leftPoint.x+t*nx;
      const orthogonalRightY=leftPoint.y+t*ny;

      return {
        left:leftPoint.x,
        right:orthogonalRightX,
        y:leftPoint.y,
        rightY:orthogonalRightY,
        width:Math.abs(t),
        horizontalWidth:rightPoint.x-leftPoint.x,
        axisAngleDeg,
        yPercent:leftPoint.yPercent,
        rightYPercent:toScreenYPercent(orthogonalRightY),
        leftPercent:toScreenXPercent(leftPoint.x),
        rightPercent:toScreenXPercent(orthogonalRightX),
        confidence:Math.round(clamp(
          45+Math.min(26,leftPoint.score*.55)+Math.min(26,rightPoint.score*.55),
          0,99
        )),
      };
    });
  };

  // Procura a regiao MAIS LARGA ESTAVEL ao longo de toda a varredura.
  // A maior largura so vale quando forma um plato continuo; um pico isolado
  // causado por sombra/ruga nunca comanda o resultado.
  const selectWidestStableRun = (values:number[]) => {
    const valid=values.filter(Number.isFinite).filter(v=>v>0);
    if(!valid.length) return {selected:[] as number[],used:null as number|null,startIndex:-1};

    const windowSize=Math.min(7,valid.length);
    let best:{selected:number[];used:number;startIndex:number;spreadPercent:number}|null=null;

    for(let start=0;start<=valid.length-windowSize;start++){
      const window=valid.slice(start,start+windowSize);
      const min=Math.min(...window);
      const max=Math.max(...window);
      const mean=window.reduce((sum,v)=>sum+v,0)/window.length;
      const spreadPercent=mean>0 ? ((max-min)/mean)*100 : 999;

      // A regiao grossa precisa ser continua. Com 7 cortes exigimos um plato
      // anatomico estavel e ainda toleramos pequenas mudancas reais do contorno.
      if(spreadPercent>2.2) continue;

      if(!best || mean>best.used){
        best={selected:window,used:mean,startIndex:start,spreadPercent};
      }
    }

    if(best) return best;

    // Fallback conservador: se nenhuma janela passar pelo limite, usa a
    // janela de 5 cortes com menor variacao; em empate, prefere a mais larga.
    let fallback:{selected:number[];used:number;startIndex:number;spreadPercent:number}|null=null;
    for(let start=0;start<=valid.length-windowSize;start++){
      const window=valid.slice(start,start+windowSize);
      const min=Math.min(...window);
      const max=Math.max(...window);
      const mean=window.reduce((sum,v)=>sum+v,0)/window.length;
      const spreadPercent=mean>0 ? ((max-min)/mean)*100 : 999;
      if(
        !fallback ||
        spreadPercent<fallback.spreadPercent ||
        (Math.abs(spreadPercent-fallback.spreadPercent)<0.05 && mean>fallback.used)
      ){
        fallback={selected:window,used:mean,startIndex:start,spreadPercent};
      }
    }

    return fallback ?? {selected:valid,used:valid.reduce((sum,v)=>sum+v,0)/valid.length,startIndex:0,spreadPercent:0};
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

  // V2 limpa: a foto 2 ja possui sua propria escala fisica de 85,60 mm.
  // A diferenca para a foto 1 fica somente como diagnostico e NAO altera o dedo.
  const v2PhotoScaleCorrection = 1;

  const liveWidthMm = useMemo(() => {
    if(!pixelsPerMm||!leftLocked||!rightLocked) return null;

    const samples=fingerBandSamplesPx();
    if(!samples || samples.length<35) return null;

    const widthsMm=samples
      .map((sample)=>{
        if(measurementCardHomography){
          try{
            const left=projectPoint(measurementCardHomography,{x:sample.left,y:sample.y});
            const right=projectPoint(measurementCardHomography,{x:sample.right,y:sample.rightY});
            return Math.hypot(right.x-left.x,right.y-left.y);
          }catch{
            return NaN;
          }
        }
        return sample.width/pixelsPerMm;
      })
      .filter(v=>Number.isFinite(v)&&v>0&&v<45);

    const stable=selectWidestStableRun(widthsMm);
    return stable.used;
  },[pixelsPerMm,leftLine,rightLine,ringGuideY,zoom,panX,panY,leftLocked,rightLocked,measurementCardHomography]);

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

    if (measurementMode === "finger") {
      const v2 = classifyFingerWidthMm(liveWidthMm);
      return {
        rawWidthMm: liveWidthMm,
        widthMm: liveWidthMm,
        measurementCorrectionMm: 0,
        equivalentDiameterMm: liveWidthMm,
        fingerEquivalentMabMm: null,
        ringSize: v2.exactRingSize,
        calculationMode: "formula" as const,
        appliedRuleOffset: null,
        continuousRing: null,
        nearBoundary: false,
        boundaryDistanceMm: Math.min(
          Math.abs(liveWidthMm - v2.lowerBoundaryMm),
          Math.abs(v2.upperBoundaryMm - liveWidthMm),
        ),
      };
    }

    return computeRingResult(liveWidthMm, calibrationRules, true, calibrationConfidence);
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

  const visualLeftX = leftLine;
  const visualRightX = rightLine;

  const visualBandLeft = Math.min(visualLeftX, visualRightX);
  const visualBandRight = Math.max(visualLeftX, visualRightX);
  const visualBandWidth = Math.max(0, visualBandRight - visualBandLeft);
  const visualBandCenter = visualBandLeft + visualBandWidth / 2;

  const geometricScaleMmPerPx = (() => {
    if(phase!=="finger"||!pixelsPerMm||pixelsPerMm<=0) return null;
    return 1/pixelsPerMm;
  })();

  const fingerMagnetSamples = phase==="finger" && leftLocked && rightLocked ? fingerBandSamplesPx() : null;

  const measurementAudit = (() => {
    if(!fingerMagnetSamples?.length || liveWidthMm===null) return null;

    const rawWidthsPx=fingerMagnetSamples.map((sample)=>sample.width).filter(Number.isFinite);
    if(!rawWidthsPx.length) return null;

    const widestRun=selectWidestStableRun(rawWidthsPx);
    if(widestRun.used===null) return null;

    const physicalWidthsMm=fingerMagnetSamples.map((sample)=>{
      if(measurementCardHomography){
        try{
          const left=projectPoint(measurementCardHomography,{x:sample.left,y:sample.y});
          const right=projectPoint(measurementCardHomography,{x:sample.right,y:sample.rightY});
          return Math.hypot(right.x-left.x,right.y-left.y);
        }catch{
          return NaN;
        }
      }
      return pixelsPerMm>0 ? sample.width/pixelsPerMm : NaN;
    }).filter(Number.isFinite);

    const widestPhysical=selectWidestStableRun(physicalWidthsMm);
    const spreadPx=Math.max(...rawWidthsPx)-Math.min(...rawWidthsPx);

    return {
      rawWidthsPx,
      usedWidthPx:widestRun.used,
      cardScaleMmPerPx:pixelsPerMm>0?1/pixelsPerMm:null,
      rawCardMm:widestPhysical.used,
      normalizedMm:liveWidthMm,
      correctionPercent:0,
      spreadPx,
      spreadPercent:widestRun.used>0?spreadPx/widestRun.used*100:0,
      selectedUpperWidthsPx:widestRun.selected,
      selectedRunStart:widestRun.startIndex+1,
      fingerAxisAngleDeg:fingerMagnetSamples[0]?.axisAngleDeg ?? 0,
    };
  })();

  const fourMagnetWidthsMm = fingerMagnetSamples?.map((sample)=>{
    if(measurementCardHomography){
      try{
        const left=projectPoint(measurementCardHomography,{x:sample.left,y:sample.y});
        const right=projectPoint(measurementCardHomography,{x:sample.right,y:sample.rightY});
        return Number(Math.hypot(right.x-left.x,right.y-left.y).toFixed(2));
      }catch{
        return NaN;
      }
    }
    return pixelsPerMm>0 ? Number((sample.width/pixelsPerMm).toFixed(2)) : NaN;
  }).filter(Number.isFinite) ?? [];

  const singleFingerWidthMm = liveWidthMm !== null ? Number(liveWidthMm.toFixed(2)) : null;

  const guidedStep =
    singlePhotoTestMode
      ? (phase === "card" ? 1 : phase === "finger" ? (result && leftLocked && rightLocked ? 3 : 2) : 1)
      : phase === "card"
        ? (fingerCardCalibrationStep === "reference" ? 1 : 2)
        : phase === "finger"
          ? (result && leftLocked && rightLocked ? 4 : 3)
          : 1;

  const guideTitle = singlePhotoTestMode
    ? (guidedStep === 1 ? "1. Calibre o cartão sobre o dedo" :
       guidedStep === 2 ? "2. Ajuste as linhas na parte mais grossa" :
       "3. Confira os três números")
    : guidedStep === 1 ? "1. Calibre o cartão em uma base plana" :
      guidedStep === 2 ? "2. Fotografe o cartão sobre o dedo" :
      guidedStep === 3 ? "3. Ajuste as duas linhas na parte mais grossa" :
      "4. Confira os dois números";

  const guideText = singlePhotoTestMode
    ? (guidedStep === 1
        ? "Ajuste as duas laterais e a linha da base do cartão na mesma foto do dedo. Essa própria foto define a escala de 85,60 mm."
        : guidedStep === 2
          ? "Posicione a linha amarela na altura do anel e use as linhas verdes como guia. Os 50 refinamentos trabalham na mesma foto calibrada."
          : "Justo = um aro abaixo do calculado. Exato = aro calculado. Conforto = um aro acima para maior folga.")
    : guidedStep === 1
      ? "Ajuste as duas laterais e a linha da base do cartão. A largura na base representa 85,60 mm."
      : guidedStep === 2
        ? "Coloque o cartão sobre o dedo e ajuste novamente as duas laterais e a base. A foto 2 define a escala final da medição."
        : guidedStep === 3
          ? "Posicione a linha amarela na altura do anel e use as linhas verdes como guia aproximada. O sistema faz 50 refinamentos automáticos perto dessas linhas e calcula pela região mais larga estável."
          : "Justo = um aro abaixo do calculado. Exato = aro calculado. Conforto = um aro acima para maior folga.";

  const historicalFingerTests = [
    { ring:17, mm:19.09 },
    { ring:21, mm:20.18 },
    { ring:25, mm:22.22 },
    { ring:29, mm:22.923 },
    { ring:33, mm:25.28 },
  ];

  const todayFingerTests = [
    { ring:24, mm:20.98 },
    { ring:25, mm:21.74 },
    { ring:29, mm:22.435 },
  ];

  const comparisonShared = todayFingerTests
    .map((today)=>{
      const old=historicalFingerTests.find((item)=>item.ring===today.ring);
      return old ? {ring:today.ring, oldMm:old.mm, todayMm:today.mm, diff:today.mm-old.mm} : null;
    })
    .filter((item): item is {ring:number;oldMm:number;todayMm:number;diff:number}=>item!==null);

  const comparisonAverageShift = comparisonShared.length
    ? comparisonShared.reduce((sum,item)=>sum+item.diff,0)/comparisonShared.length
    : 0;

  const comparisonChart = (() => {
    const width=340, height=220;
    const left=38, right=12, top=14, bottom=30;
    const minRing=17, maxRing=33;
    const minMm=18.5, maxMm=25.7;
    const x=(ring:number)=>left+(ring-minRing)/(maxRing-minRing)*(width-left-right);
    const y=(mm:number)=>top+(maxMm-mm)/(maxMm-minMm)*(height-top-bottom);
    const path=(items:{ring:number;mm:number}[])=>items.map((item)=>`${x(item.ring).toFixed(1)},${y(item.mm).toFixed(1)}`).join(" ");
    return {width,height,left,right,top,bottom,minRing,maxRing,minMm,maxMm,x,y,path};
  })();

  return (
    <main className="app">
      <header className="brand">
        <button
          type="button"
          className="mark"
          aria-label="Marca"
          onClick={() => {
            const now=Date.now();
            const current=debugTapRef.current;
            if(now-current.lastTap>1800) current.count=0;
            current.lastTap=now;
            current.count+=1;
            if(current.count>=5){
              current.count=0;
              setDebugMode((value)=>!value);
            }
          }}
          style={{background:"none",border:0,padding:0,color:"inherit",font:"inherit"}}
        >◇</button>
        <div>
          <strong>Medidor de Anel</strong>
          <small>{debugMode ? "Modo de teste privado ativo" : "Paquímetro digital"}</small>
        </div>
      </header>

      {stage === "intro" && (
        <>
          <IntroScreen
            error={camera.error}
            onMeasureFinger={() => {
              setSinglePhotoTestMode(false);
              setDiameterPhotoTestMode(false);
              setMeasurementMode("finger");
              setFingerCardCalibrationStep("reference");
              void openCamera();
            }}
          />
          {debugMode && (
            <section className="panel" style={{marginTop:12}}>
              <span className="step">TESTE PRIVADO</span>
              <h2 style={{margin:"4px 0 8px"}}>Modo 1 foto</h2>
              <p className="lead" style={{marginBottom:12}}>
                Cartão e dedo na mesma foto. A própria foto fornece a escala de 85,60 mm e os 50 cortes medem o dedo sem usar Foto 1.
              </p>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setSinglePhotoTestMode(true);
                  setDiameterPhotoTestMode(false);
                  setMeasurementMode("finger");
                  setFingerCardCalibrationStep("measurement");
                  setReferenceCardLengthPx(null);
                  setReferenceCardWidthPercent(null);
                  setReferenceCardAngleDeg(null);
                  setMeasurementCardLengthPx(null);
                  setPerspectiveMismatchPercent(null);
                  void openCamera();
                }}
              >
                Testar medição com 1 foto
              </button>
            </section>
          )}
        </>
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
          referenceCardWidthPercent={fingerCardCalibrationStep === "measurement" ? referenceCardWidthPercent : null}
          referenceCardAngleDeg={fingerCardCalibrationStep === "measurement" ? referenceCardAngleDeg : null}
          singlePhotoTestMode={singlePhotoTestMode}
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
              ? (singlePhotoTestMode
                  ? "1. CARTÃO SOBRE O DEDO"
                  : (fingerCardCalibrationStep === "reference" ? "1. ALINHE O CARTÃO" : "2. CARTÃO SOBRE O DEDO"))
              : phase === "card" ? "1. CALIBRE O CARTÃO"
              : diameterPhotoTestMode ? "2. MEÇA O DIÂMETRO INTERNO"
              : measurementMode === "anelimetro" ? "2. TESTE O ANELÍMETRO"
              : "3. MEÇA O DEDO"
          }</span>
          <h1>{
            phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode
              ? (singlePhotoTestMode
                  ? "Calibre o cartão nesta foto"
                  : (fingerCardCalibrationStep === "reference" ? "Alinhe o cartão nas guias" : "Alinhe o cartão sobre o dedo"))
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
            onPointerCancel={() => { draggingRef.current = null; setFingerLoupe(null); }}
          >
            {photo && <img className="zoomable-photo" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }} src={photo} alt="Fotografia para medição" draggable={false} />}
            {phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode ? (
              <svg
                className="card-lines-overlay"
                style={{transform:`translate(${panX}px, ${panY}px) scale(${zoom})`}}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Três linhas de calibração do cartão"
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
                {fingerLoupe && photo && (
                  <div
                    aria-hidden="true"
                    style={{
                      position:"absolute",
                      left:fingerLoupe.side==="left" ? "72%" : "28%",
                      top:"18%",
                      width:"132px",
                      height:"132px",
                      transform:"translate(-50%,-50%)",
                      borderRadius:"50%",
                      overflow:"hidden",
                      border:"3px solid #52e0a3",
                      boxShadow:"0 8px 28px rgba(0,0,0,.55)",
                      backgroundImage:`url("${photo}")`,
                      backgroundRepeat:"no-repeat",
                      backgroundSize:"600% 600%",
                      backgroundPosition:`${fingerLoupe.imageX}% ${fingerLoupe.imageY}%`,
                      zIndex:12,
                      pointerEvents:"none",
                    }}
                  >
                    <span style={{
                      position:"absolute",
                      left:"50%",
                      top:0,
                      bottom:0,
                      width:"1px",
                      background:"#ffd86b",
                      transform:"translateX(-50%)",
                    }} />
                    <span style={{
                      position:"absolute",
                      top:"50%",
                      left:0,
                      right:0,
                      height:"1px",
                      background:"#ffd86b",
                      transform:"translateY(-50%)",
                    }} />
                    <span style={{
                      position:"absolute",
                      left:"50%",
                      bottom:"8px",
                      transform:"translateX(-50%)",
                      padding:"3px 7px",
                      borderRadius:"999px",
                      background:"rgba(0,0,0,.72)",
                      color:"#fff",
                      fontSize:"10px",
                      fontWeight:700,
                      whiteSpace:"nowrap",
                    }}>BORDA DA LINHA · 6×</span>
                  </div>
                )}
                {fingerMagnetSamples && (
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:5}}
                  >
                    {fingerMagnetSamples.map((sample,index)=>(
                      <line
                        key={`hybrid-cut-${index}`}
                        x1={sample.leftPercent}
                        y1={sample.yPercent}
                        x2={sample.rightPercent}
                        y2={sample.rightYPercent}
                        stroke="#52e0a3"
                        strokeWidth="0.34"
                        opacity="0.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <polyline
                      points={fingerMagnetSamples.map((sample)=>`${sample.leftPercent},${sample.yPercent}`).join(" ")}
                      fill="none"
                      stroke="#52e0a3"
                      strokeWidth="0.48"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points={fingerMagnetSamples.map((sample)=>`${sample.rightPercent},${sample.rightYPercent}`).join(" ")}
                      fill="none"
                      stroke="#52e0a3"
                      strokeWidth="0.48"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                <button
                  type="button"
                  className="ring-height-guide"
                  style={{
                    position:"absolute",
                    left:`${Math.min(leftLine,rightLine)}%`,
                    top:`${ringGuideY}%`,
                    width:`${Math.abs(rightLine-leftLine)}%`,
                    height:"24px",
                    transform:"translateY(-50%)",
                    border:0,
                    padding:0,
                    background:"transparent",
                    cursor:"ns-resize",
                    zIndex:6,
                    touchAction:"none",
                  }}
                  onPointerDown={(event)=>startDrag("height",event)}
                  aria-label="Linha horizontal simulando a altura do anel"
                >
                  <span style={{
                    position:"absolute",
                    left:0,
                    right:0,
                    top:"50%",
                    height:"3px",
                    transform:"translateY(-50%)",
                    background:"#ffd86b",
                    boxShadow:"0 0 0 1px rgba(0,0,0,.35)",
                  }} />
                  <span style={{
                    position:"absolute",
                    left:"50%",
                    top:"50%",
                    transform:"translate(-50%,-50%)",
                    padding:"3px 7px",
                    borderRadius:"999px",
                    background:"rgba(0,0,0,.72)",
                    color:"#ffd86b",
                    fontSize:"10px",
                    fontWeight:700,
                    whiteSpace:"nowrap",
                  }}>ALTURA DO ANEL</span>
                </button>
                <button
                  type="button"
                  className={`finger-full-line left${leftLocked ? " locked" : ""}`}
                  style={{
                    position:"absolute",
                    left:`${leftLine}%`,
                    top:0,
                    width:"18px",
                    height:"100%",
                    transform:"translateX(-50%)",
                    border:0,
                    padding:0,
                    background:"transparent",
                    cursor:"ew-resize",
                    zIndex:7,
                    touchAction:"none",
                  }}
                  onPointerDown={(event)=>startDrag("left",event)}
                  aria-label="Linha manual esquerda do dedo"
                >
                  <span style={{
                    position:"absolute",
                    left:"50%",
                    top:0,
                    bottom:0,
                    width:"2px",
                    transform:"translateX(-50%)",
                    background:"#52e0a3",
                    boxShadow:"0 0 0 1px rgba(0,0,0,.28)",
                  }} />
                </button>
                <button
                  type="button"
                  className={`finger-full-line right${rightLocked ? " locked" : ""}`}
                  style={{
                    position:"absolute",
                    left:`${rightLine}%`,
                    top:0,
                    width:"18px",
                    height:"100%",
                    transform:"translateX(-50%)",
                    border:0,
                    padding:0,
                    background:"transparent",
                    cursor:"ew-resize",
                    zIndex:7,
                    touchAction:"none",
                  }}
                  onPointerDown={(event)=>startDrag("right",event)}
                  aria-label="Linha manual direita do dedo"
                >
                  <span style={{
                    position:"absolute",
                    left:"50%",
                    top:0,
                    bottom:0,
                    width:"2px",
                    transform:"translateX(-50%)",
                    background:"#52e0a3",
                    boxShadow:"0 0 0 1px rgba(0,0,0,.28)",
                  }} />
                </button>
              </>
            )}
            {phase === "finger" && result && leftLocked && rightLocked && !tryOn && (
              <div className="ring-size-badge" style={{ left: `${visualBandCenter}%` }} aria-live="polite">
                <span>JUSTO: {clamp(result.ringSize - 1, 1, 40)}</span>
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
                {singlePhotoTestMode
                  ? "Calibrar esta foto e medir o dedo"
                  : fingerCardCalibrationStep === "reference"
                    ? "Salvar 3 linhas e ir para a foto 2"
                    : "Calibrar cartão e medir o dedo"}
              </button>
              <div className="card-line-status">
                {(["left","right","bottom"] as CardEdge[]).map((edge)=><span key={edge} className={cardLineLocked[edge] ? "locked" : ""}>
                  {cardLineLocked[edge] ? "✓" : "○"} {edge==="bottom"?"Base":edge==="left"?"Esquerda":"Direita"}
                </span>)}
              </div>
              <div className="card-base-status">
                <strong>{singlePhotoTestMode
                  ? "Modo 1 foto — cartão sobre o dedo"
                  : fingerCardCalibrationStep === "reference"
                    ? "Foto 1 — calibração do cartão"
                    : "Foto 2 — cartão sobre o dedo"}</strong>
                <span>{singlePhotoTestMode
                  ? "Ajuste a lateral esquerda, a lateral direita e a linha da base nas bordas reais do cartão já posicionado sobre o dedo."
                  : fingerCardCalibrationStep === "reference"
                    ? "Ajuste a lateral esquerda, a lateral direita e a linha da base nas bordas reais do cartão."
                    : "Ajuste novamente as duas laterais e a base do cartão sobre o dedo. Na captura, use a guia fantasma da Foto 1 para aproximar escala e ângulo."}</span>
                <small>{singlePhotoTestMode
                  ? "A própria largura de 85,60 mm desta foto define a escala usada para medir o dedo."
                  : fingerCardCalibrationStep === "reference"
                    ? "A largura entre as duas laterais na linha da base representa os 85,60 mm do cartão."
                    : "A Foto 2 continua calculando sua própria escala, mas agora a captura é guiada para ficar o mais próxima possível da Foto 1."}</small>
                <small>As 3 linhas mantêm o ímã: aproxime da borda e solte para encaixar.</small>
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
            <div className="analysis-result commercial-result">
              <span><strong>Número justo: {clamp(result.ringSize - 1, 1, 40)}</strong></span>
              <strong>Número exato: {result.ringSize}</strong>
              <span><strong>Número de conforto: {clamp(result.ringSize + 1, 1, 40)}</strong></span>
              <small>Justo = um aro abaixo · Exato = aro calculado · Conforto = um aro acima para maior folga.</small>
            </div>
          )}
          {debugMode && phase === "finger" && result && leftLocked && rightLocked && (
            <div className="analysis-result">
              <strong>DIAGNÓSTICO PRIVADO</strong>
              <span>Captura: {singlePhotoTestMode ? "1 foto (teste)" : "2 fotos"}</span>
              <span>Medida final: {result.widthMm.toFixed(2)} mm</span>
              {measurementAudit && (
                <>
                  <span>Modo híbrido: linhas manuais + 50 refinamentos automáticos</span>
                  <span>Varredura: {measurementAudit.rawWidthsPx.length} cortes · {measurementAudit.rawWidthsPx.map((value)=>value.toFixed(1)).join(" / ")} px</span>
                  <span>Região mais larga estável: pontos {measurementAudit.selectedRunStart}–{measurementAudit.selectedRunStart + measurementAudit.selectedUpperWidthsPx.length - 1}</span>
                  <span>Platô usado: {measurementAudit.selectedUpperWidthsPx.map((value)=>value.toFixed(1)).join(" / ")} px</span>
                  <span>Largura usada: {measurementAudit.usedWidthPx.toFixed(2)} px</span>
                  <span>Variação: {measurementAudit.spreadPx.toFixed(2)} px · {measurementAudit.spreadPercent.toFixed(2)}%</span>
                  {measurementAudit.cardScaleMmPerPx !== null && <span>Escala: {measurementAudit.cardScaleMmPerPx.toFixed(4)} mm/px</span>}
                  {measurementAudit.rawCardMm !== null && <span>Medida bruta foto 2: {measurementAudit.rawCardMm.toFixed(2)} mm</span>}
                  <span>Correção extra entre fotos: desativada</span>
                  {measurementAudit.normalizedMm !== null && <span>Medida usada pela V2: {measurementAudit.normalizedMm.toFixed(2)} mm</span>}
                  {referenceCardLengthPx !== null && <span>Cartão foto 1: {referenceCardLengthPx.toFixed(1)} px</span>}
                  {measurementCardLengthPx !== null && <span>Cartão foto 2: {measurementCardLengthPx.toFixed(1)} px</span>}
                  {referenceCardLengthPx !== null && measurementCardLengthPx !== null && (
                    <span>Diferença cartão 1→2: {(((measurementCardLengthPx/referenceCardLengthPx)-1)*100).toFixed(2)}%</span>
                  )}
                  {perspectiveMismatchPercent !== null && (
                    <span>Diferença entre fotos: {perspectiveMismatchPercent.toFixed(2)}% · apenas diagnóstico</span>
                  )}
                </>
              )}
            </div>
          )}
          {debugMode && phase === "finger" && (
            <div className="analysis-result">
              <strong>COMPARAÇÃO HISTÓRICA × HOJE</strong>
              <span>Histórico antigo: 17=19,09 · 21=20,18 · 25=22,22 · 29=22,92 · 33=25,28 mm</span>
              <span>Hoje (método congelado): 24=20,98 · 25=21,74 · 29=22,44 mm</span>
              {comparisonShared.map((item)=>(
                <span key={`cmp-${item.ring}`}>
                  Aro {item.ring}: antigo {item.oldMm.toFixed(2)} mm · hoje {item.todayMm.toFixed(2)} mm · diferença {item.diff>=0?"+":""}{item.diff.toFixed(2)} mm
                </span>
              ))}
              <span>Deslocamento médio nos aros comparáveis: {comparisonAverageShift>=0?"+":""}{comparisonAverageShift.toFixed(2)} mm</span>

              <svg
                viewBox={`0 0 ${comparisonChart.width} ${comparisonChart.height}`}
                role="img"
                aria-label="Gráfico comparando testes antigos e testes de hoje por aro"
                style={{width:"100%",height:"auto",marginTop:"10px",overflow:"visible"}}
              >
                {[19,21,23,25].map((mm)=>(
                  <g key={`grid-y-${mm}`}>
                    <line
                      x1={comparisonChart.left}
                      y1={comparisonChart.y(mm)}
                      x2={comparisonChart.width-comparisonChart.right}
                      y2={comparisonChart.y(mm)}
                      stroke="rgba(255,255,255,.14)"
                      strokeWidth="1"
                    />
                    <text x="4" y={comparisonChart.y(mm)+4} fill="currentColor" fontSize="9">{mm} mm</text>
                  </g>
                ))}
                {[17,21,25,29,33].map((ring)=>(
                  <g key={`grid-x-${ring}`}>
                    <line
                      x1={comparisonChart.x(ring)}
                      y1={comparisonChart.top}
                      x2={comparisonChart.x(ring)}
                      y2={comparisonChart.height-comparisonChart.bottom}
                      stroke="rgba(255,255,255,.08)"
                      strokeWidth="1"
                    />
                    <text
                      x={comparisonChart.x(ring)}
                      y={comparisonChart.height-9}
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize="9"
                    >{ring}</text>
                  </g>
                ))}

                <polyline
                  points={comparisonChart.path(historicalFingerTests)}
                  fill="none"
                  stroke="#d7b35f"
                  strokeWidth="2.2"
                />
                {historicalFingerTests.map((item)=>(
                  <circle key={`old-${item.ring}`} cx={comparisonChart.x(item.ring)} cy={comparisonChart.y(item.mm)} r="3.2" fill="#d7b35f" />
                ))}

                <polyline
                  points={comparisonChart.path(todayFingerTests)}
                  fill="none"
                  stroke="#52e0a3"
                  strokeWidth="2.2"
                />
                {todayFingerTests.map((item)=>(
                  <circle key={`today-${item.ring}`} cx={comparisonChart.x(item.ring)} cy={comparisonChart.y(item.mm)} r="3.4" fill="#52e0a3" />
                ))}

                {result && Number.isFinite(result.ringSize) && Number.isFinite(result.widthMm) && (
                  <g>
                    <circle
                      cx={comparisonChart.x(clamp(result.ringSize,17,33))}
                      cy={comparisonChart.y(clamp(result.widthMm,comparisonChart.minMm,comparisonChart.maxMm))}
                      r="5.2"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                    <text
                      x={comparisonChart.x(clamp(result.ringSize,17,33))}
                      y={comparisonChart.y(clamp(result.widthMm,comparisonChart.minMm,comparisonChart.maxMm))-8}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                    >agora</text>
                  </g>
                )}
              </svg>
              <span style={{fontSize:"0.85em",opacity:.85}}>Dourado = testes antigos · Verde = testes confirmados hoje · círculo branco = leitura atual</span>
            </div>
          )}
          {phase === "finger" && !tryOn && !diameterPhotoTestMode && (
            <div className="edge-status">
              <strong>Meça na parte mais grossa do dedo</strong>
              <span>Posicione a linha amarela onde o anel vai ficar e aproxime as duas linhas verdes das bordas. Depois, 50 cortes automáticos refinam os pixels exatos do contorno sem sair da região indicada por você.</span>
            </div>
          )}

          {phase === "finger" && !tryOn && <div className="edge-status">
            <strong>{leftLocked && rightLocked ? "Laterais posicionadas" : "Ajuste as 2 laterais"}</strong>
            <span>
              {leftLocked ? "✓ Esquerda manual" : "○ Ajuste a esquerda"}
              {" · "}
              {rightLocked ? "✓ Direita manual" : "○ Ajuste a direita"}
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
              <button className="primary" type="button" disabled>{
                result
                  ? "Aro calculado"
                  : leftLocked && rightLocked
                    ? "Linhas posicionadas"
                    : "Ajuste as linhas no dedo"
              }</button>
            )}
          </div>
          {camera.error && <p className="error">{camera.error}</p>}
          <p className="pending">{tryOn ? "Escolha o acabamento e a largura para comparar os modelos no seu dedo." : "Alinhe manualmente as duas linhas verdes nas bordas externas da parte mais grossa do dedo."}</p>
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
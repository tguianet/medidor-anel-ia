import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeLiveCardGuide, calibratePhoto } from "./visionV2";
import { refineCardEdgesNew } from "./detectorCompare";
import { chromaticityImage, findCardEdge, regionSaturation } from "./cardEdges";
import { trackFinger } from "./fingerTrack";
import { alignPhotoToFrame, canTakeFullPhoto, decodePhoto, takeFullPhoto, wholePhotoAsFrame, type AlignedPhoto } from "./fullPhoto";
import { buildReport, loadTests, makeCrops, storeTests, type SavedTest } from "./testReport";
import { clamp, computeDiameterOnlyTestResult, computeRingResult, type CalibrationRule } from "../ringCalculation";
import { lineIntersection, type Line, type Point } from "../perspective";
import { useFrozenCameraStream } from "./FrozenCameraStream";
import type { CardEdge, DragTarget, FingerSide, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "../types";
import { wearableRingImage } from "../types";
import FrozenIntroScreen from "./FrozenIntroScreen";
import FrozenCameraScreen from "./FrozenCameraScreen";
import HandCameraScreen from "../components/HandCameraScreen";
import HandReviewScreen from "../components/HandReviewScreen";
import TryOnPanel from "../components/TryOnPanel";
import { classifyFingerWidthMm, classifyFingerWidthMmExperimentalHigh } from "./ringClassifier";
import { VISION_FEATURE_FLAGS } from "./featureFlags";
import { robustWidthStats, combineConfidenceScore, confidenceLabel } from "./measurementQuality";
import { useDeviceCaptureQuality } from "./useDeviceCaptureQuality";
import { analyzeHandLandmarks, type HandLandmarkAnalysis } from "./handLandmarks";
import { analyzeFingerContourAnatomy } from "./fingerContourAnatomy";
import { assessCardQuadGeometry, quadFromLines } from "../perspective";
import OpenCvCardTest from "./OpenCvCardTest";
import type { LightCardDetectionPayload } from "./LightCardDetectorTest";

const MIN_CARD_CALIBRATION_CONFIDENCE = 90;
const HIGH_CARD_CALIBRATION_CONFIDENCE = 92;
// V2: mantido apenas para compatibilidade dos diagnosticos herdados. Sem correcao historica.
const TEST_FINGER_CARD_NORMALIZATION = 1;
const CARD_WIDTH_MM = 85.6;
const LOUPE_SIZE_PX = 132;
const LOUPE_EXTRA_ZOOM = 2;
const RING_HEIGHT_FALLBACK_OFFSET = 5;
// Inclinacao maxima aceita para cada lateral do cartao (tan 5 graus).
const CARD_EDGE_MAX_TILT = 0.0875;
// Vies medio do detector original (le o cartao ~0,57% mais largo que a borda
// real; medido nas fotos de 11/10). Mantem a compatibilidade com a curva.
const CARD_LEGACY_SCALE = 1.0057;
// medidordedov6: a medida usada e a distancia entre as linhas verdes que o
// usuario posicionou com a lupa (sem refinamento automatico), corrigida pela
// inclinacao do eixo do dedo.
const MANUAL_LINES_ONLY = true;
// medidordedov13: medida principal = media de 3000 cortes ao longo do dedo,
// rastreados a partir das linhas da lupa.
const DENSE_TRACK_PRIMARY = true;
const DENSE_TRACK_SAMPLES = 5;
// Disparo instantaneo: usa so o quadro do toque (sem rajada).
const INSTANT_SHUTTER = true;
// v16: os snaps medem so +-2 mm em volta da altura do anel; medida = mediana.
const RING_ZONE_HALF_MM = 2;
// v17: foto completa do sensor (Chrome/Android) no toque.
const FULL_PHOTO_ENABLED = true;
const FULL_PHOTO_TIMEOUT_MS = 2500;
// v16: o refino fisico do cartao so pode mover cada lateral ate 6 px em
// relacao ao detector original (evita grudar em faixas/bisel internos).
const CARD_PHYSICAL_MAX_SHIFT_PX = 6;
// v17: cartao colorido -> bordas pela cromaticidade (a sombra some).
const CARD_CHROMA_EDGES = true;
// v18: etapa de ajuste manual das laterais do cartao antes do dedo.
const MANUAL_CARD_STEP = true;
// v21: captura somente pela camera nativa do celular.
const NATIVE_CAMERA_ONLY = true;
// v21: raio de busca (px na foto 900) do botao automatico e do ima ao soltar.
const CARD_AUTO_RADIUS_PX = 20;
const CARD_MAGNET_RADIUS_PX = 10;
// v19: foto NITIDA (camera do celular / foto completa) + cartao na borda real
// mede o dedo ~2,8% menor que a foto de video sobre a qual a curva foi feita.
// Fator medido em 12/10 (3 fotos, aro real 25: media 21,16 -> 21,75 mm).
const SHARP_PHOTO_SCALE = 1.0279;
const CARD_CHROMA_MIN_SATURATION = 0.35;
// v16: distancia da divisa (mm) para mostrar os dois aros ao cliente.
const RING_BOUNDARY_MARGIN_MM = 0.04;
const COMMERCIAL_MAX_FINGER_ANGLE = 10;
// v20: bordas esquerda e direita devem ser quase paralelas (graus) e a
// largura nos snaps deve variar pouco (p90-p10, mm).
const COMMERCIAL_MAX_EDGE_SPREAD_DEG = 6;
const COMMERCIAL_MAX_WIDTH_SPREAD_MM = 0.35;
const COMMERCIAL_MAX_EDGE_DIVERGENCE_MM = 0.30;
// medidordedov7: largura maxima da copia em alta resolucao (retrato).
const HI_RES_MAX_WIDTH = 2400;
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
  const camera = useFrozenCameraStream();
  const deviceQuality = useDeviceCaptureQuality(VISION_FEATURE_FLAGS.ENABLE_DEVICE_ORIENTATION);
  // Diagnostico privado: fica dentro da mesma pagina para nao interferir
  // com permissao/ciclo da camera. Toque 5 vezes no simbolo da marca.
  const [debugMode, setDebugMode] = useState(false);
  const debugTapRef = useRef({ count: 0, lastTap: 0 });
  const measureRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragTarget>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0 });
  const cardLineDragStartRef = useRef<{ pointer: Point; line: Line } | null>(null);
  const recordedMeasurementPhotoRef = useRef<string>("");
  const autoAnatomyAppliedPhotoRef = useRef<string>("");
  // Depois que o usuario move ALTURA DO ANEL, a escolha manual tem prioridade
  // ate a proxima foto. O contorno multiponto usa essa altura apenas como semente.
  const ringGuideManualRef = useRef(false);
  const measurementHistoryTimerRef = useRef<number | null>(null);
  type StableCapture = { mm:number; regionOffsetY:number; photoKey:string; ts:number };
  const [stableCaptures, setStableCaptures] = useState<StableCapture[]>([]);
  const [measurementAttemptCount, setMeasurementAttemptCount] = useState(0);
  const measurementHistoryMm = useMemo(
    () => stableCaptures.map(item => item.mm),
    [stableCaptures]
  );
  const anatomicalRegionOffsetHistoryY = useMemo(
    () => stableCaptures.map(item => item.regionOffsetY),
    [stableCaptures]
  );
  const resetMeasurementSession = () => {
    if(measurementHistoryTimerRef.current!==null){
      window.clearTimeout(measurementHistoryTimerRef.current);
      measurementHistoryTimerRef.current=null;
    }
    recordedMeasurementPhotoRef.current="";
    autoAnatomyAppliedPhotoRef.current="";
    ringGuideManualRef.current=false;
    setStableCaptures([]);
    setMeasurementAttemptCount(0);
    setHandLandmarkAnalysis(null);
  };
  const [captureDeviceQuality, setCaptureDeviceQuality] = useState<{
    devicePitch:number|null;
    deviceRoll:number|null;
    deviceMotion:number|null;
    stabilityScore:number|null;
  } | null>(null);
  const [handLandmarkAnalysis, setHandLandmarkAnalysis] = useState<HandLandmarkAnalysis | null>(null);
  const photoPixelsRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [photoPixelsReady, setPhotoPixelsReady] = useState(false);
  const [stage, setStage] = useState<Stage>("intro");
  const [photo, setPhoto] = useState("");
  // medidordedov7: copia em ALTA RESOLUCAO do mesmo quadro, usada so para
  // exibir (zoom e lupa). O processamento continua na foto 900x1200.
  const [photoHiRes, setPhotoHiRes] = useState<{forPhoto:string;url:string;width:number;height:number;videoW:number;videoH:number}|null>(null);
  const hiPixelsRef = useRef<{forUrl:string;data:Uint8ClampedArray;width:number;height:number}|null>(null);
  const [hiPixelsReady, setHiPixelsReady] = useState(0);
  const hiResBlobByCanvasRef = useRef(new WeakMap<HTMLCanvasElement,{hi:HTMLCanvasElement;width:number;height:number;videoW:number;videoH:number}>());
  const [phase, setPhase] = useState<MeasurePhase>("card");
  const [pixelsPerMm, setPixelsPerMm] = useState<number | null>(null);
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [cardLeft, setCardLeft] = useState(15);
  const [cardRight, setCardRight] = useState(85);
  const [cardBottom, setCardBottom] = useState(58);
  // Fonte das bordas do cartao usadas na escala (diagnostico).
  const [cardEdgeInfo, setCardEdgeInfo] = useState<{source:string;legacyFail:string}|null>(null);
  // Tela de carregamento logo apos o disparo (a foto ja foi tirada).
  const [captureProgress, setCaptureProgress] = useState<{pct:number;label:string}|null>(null);
  const externalPhotoRef = useRef<AlignedPhoto|null>(null);
  // v21: linhas do cartao detectadas na foto (ponto de partida do botao automatico).
  const autoCardLinesRef = useRef<Record<"left"|"right"|"bottom",Line>|null>(null);
  const [photoSourceInfo, setPhotoSourceInfo] = useState("");
  const sharpPhoto = photoSourceInfo.startsWith("câmera do celular") || photoSourceInfo.startsWith("foto completa");
  const sharpScale = sharpPhoto ? SHARP_PHOTO_SCALE : 1;
  // Testes salvos para conferencia em lote (medidordedov15).
  const [savedTests, setSavedTests] = useState<SavedTest[]>(() => loadTests());
  const [realRingInput, setRealRingInput] = useState("");
  const [testBusy, setTestBusy] = useState("");
  const [reportUrl, setReportUrl] = useState<string|null>(null);
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
  const [fingerLoupe, setFingerLoupe] = useState<{side:"left"|"right";imageX:number;imageY:number;stageW:number;stageH:number;zoom:number}|null>(null);
  const fingerRefineDragRef = useRef<"left" | "right" | null>(null);
  const fingerLineDragStartRef = useRef<{ pointer: Point; line: Line } | null>(null);
  const [fingerLines, setFingerLines] = useState<Record<FingerSide, Line>>({
    left: { a:{x:25,y:34}, b:{x:25,y:66} },
    right: { a:{x:38,y:34}, b:{x:38,y:66} },
  });
  const [cardReady, setCardReady] = useState(false);
  const [cameraAngleGuide, setCameraAngleGuide] = useState<"forward" | "backward" | "aligned" | "unknown">("unknown");
  const [liveFingerTiltDeg, setLiveFingerTiltDeg] = useState<number | null>(null);
  const [liveFingerTiltConfidence, setLiveFingerTiltConfidence] = useState(0);
  const [liveOpticalCenterOffsetPx, setLiveOpticalCenterOffsetPx] = useState<number | null>(null);
  const [liveCardFingerOffsetPx, setLiveCardFingerOffsetPx] = useState<number | null>(null);
  const [liveOpticalCenterConfidence, setLiveOpticalCenterConfidence] = useState(0);
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
    setPhotoPixelsReady(false);
    if (!photo) {
      photoPixelsRef.current = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(image, 0, 0);
      const imageData = context?.getImageData(0, 0, canvas.width, canvas.height);
      if (imageData) {
        photoPixelsRef.current = { data: imageData.data, width: canvas.width, height: canvas.height };
        setPhotoPixelsReady(true);
      }
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
      setLiveFingerTiltDeg(null);
      setLiveFingerTiltConfidence(0);
      setLiveOpticalCenterOffsetPx(null);
      setLiveCardFingerOffsetPx(null);
      setLiveOpticalCenterConfidence(0);
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
        setLiveFingerTiltConfidence(liveGuide.fingerTiltConfidence);
        setLiveOpticalCenterConfidence(liveGuide.opticalCenterConfidence);
        setLiveOpticalCenterOffsetPx(current=>
          liveGuide.opticalCenterOffsetPx===null
            ? null
            : current===null
              ? liveGuide.opticalCenterOffsetPx
              : current*0.65+liveGuide.opticalCenterOffsetPx*0.35
        );
        setLiveCardFingerOffsetPx(current=>
          liveGuide.cardFingerOffsetPx===null
            ? null
            : current===null
              ? liveGuide.cardFingerOffsetPx
              : current*0.65+liveGuide.cardFingerOffsetPx*0.35
        );
        if(liveGuide.fingerTiltDeg===null){
          setLiveFingerTiltDeg(null);
        }else{
          setLiveFingerTiltDeg(current=>
            current===null
              ? liveGuide.fingerTiltDeg
              : current*0.65+liveGuide.fingerTiltDeg!*0.35
          );
        }
      } finally { running = false; }
    };
    checkAlignment();
    const interval = window.setInterval(checkAlignment, 120);
    return () => window.clearInterval(interval);
  }, [stage, camera.cameraOpening]);

  // Disparo automatico removido.
  // A deteccao ao vivo do cartao continua apenas como guia visual.
  // A captura acontece somente quando o usuario toca no botao da camera.

  const openCamera = async () => {
    if(VISION_FEATURE_FLAGS.ENABLE_DEVICE_ORIENTATION){
      void deviceQuality.requestPermission();
    }
    setCaptureDeviceQuality(null);
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
    setLiveFingerTiltDeg(null);
    setLiveFingerTiltConfidence(0);
    setLiveOpticalCenterOffsetPx(null);
    setLiveCardFingerOffsetPx(null);
    setLiveOpticalCenterConfidence(0);
    setStage("camera");
    // v21: so a camera nativa do celular (sem video do navegador).
    if(NATIVE_CAMERA_ONLY) return;
    await camera.startCameraStream();
  };

  const openHandCamera = async () => {
    setStage("hand-camera");
    await camera.startCameraStream();
  };

  const capture = async () => {
    try{
      await captureInner();
    }finally{
      setCaptureProgress(null);
      // Se a captura falhou e a camera continua na tela, volta o preview.
      const v=camera.videoRef.current;
      if(v && v.paused && v.srcObject) void v.play().catch(()=>undefined);
    }
  };

  const nextPaint = () => new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));

  const captureInner = async () => {
    // Modo comercial de 1 foto: nao exigimos mais que pitch, roll,
    // dedo e centro optico fiquem perfeitos no mesmo instante.
    // Um toque dispara uma rajada curta e o sistema escolhe o melhor quadro.

    // Foto da camera nativa: os sensores do momento nao valem para ela.
    const nativeShot=!!externalPhotoRef.current;
    if(
      !nativeShot &&
      VISION_FEATURE_FLAGS.ENABLE_DEVICE_ORIENTATION &&
      deviceQuality.stabilityScore !== null &&
      deviceQuality.stabilityScore < 65
    ){
      camera.setError("Celular muito instável. Mantenha o aparelho firme e aguarde a estabilidade melhorar antes de capturar.");
      return;
    }
    if(
      !nativeShot &&
      VISION_FEATURE_FLAGS.ENABLE_DEVICE_ORIENTATION &&
      deviceQuality.stabilityScore !== null &&
      deviceQuality.stabilityScore < 75
    ){
      camera.setError("Quase lá: mantenha o celular mais firme até a estabilidade chegar a 75 ou mais.");
      return;
    }
    const frozenDeviceQuality = nativeShot
      ? {devicePitch:null, deviceRoll:null, deviceMotion:null, stabilityScore:null}
      : {
          devicePitch: deviceQuality.devicePitch,
          deviceRoll: deviceQuality.deviceRoll,
          deviceMotion: deviceQuality.deviceMotion,
          stabilityScore: deviceQuality.stabilityScore,
        };
    setCaptureDeviceQuality(frozenDeviceQuality);

    const video = camera.videoRef.current;
    const externalPhoto=externalPhotoRef.current;
    externalPhotoRef.current=null;
    if (!externalPhoto && !video?.videoWidth) {
      return;
    }

    // Fonte do quadro: video ao vivo ou foto completa alinhada.
    let aligned:AlignedPhoto|null=externalPhoto;
    let photoSourceLabel=externalPhoto?"câmera do celular":"vídeo";
    const drawCurrentFrame = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1200;
      const targetRatio = canvas.width / canvas.height;
      let src:CanvasImageSource;
      let sx = 0, sy = 0, sw:number, sh:number, srcW:number, srcH:number;
      if(aligned){
        src=aligned.source;
        ({sx,sy,sw,sh}=aligned.crop);
        srcW=aligned.source.width; srcH=aligned.source.height;
      }else{
        const v=video!;
        src=v; srcW=v.videoWidth; srcH=v.videoHeight;
        sw=srcW; sh=srcH;
        const sourceRatio = srcW / srcH;
        if (sourceRatio > targetRatio) {
          sw = srcH * targetRatio;
          sx = (srcW - sw) / 2;
        } else {
          sh = srcW / targetRatio;
          sy = (srcH - sh) / 2;
        }
      }
      const videoW=srcW, videoH=srcH;
      // Quadro em resolucao nativa (limitado a 2160 px de largura).
      const hiW=Math.round(Math.min(sw,HI_RES_MAX_WIDTH));
      const hiH=Math.round(hiW/targetRatio);
      const hi=document.createElement("canvas");
      hi.width=hiW;
      hi.height=hiH;
      const hiCtx=hi.getContext("2d");
      if(hiCtx){
        hiCtx.imageSmoothingEnabled=true;
        hiCtx.imageSmoothingQuality="high";
        hiCtx.drawImage(src, sx, sy, sw, sh, 0, 0, hiW, hiH);
        const ctx=canvas.getContext("2d");
        if(ctx){
          ctx.imageSmoothingEnabled=true;
          ctx.imageSmoothingQuality="high";
          ctx.drawImage(hi, 0, 0, hiW, hiH, 0, 0, canvas.width, canvas.height);
        }
        // So guarda o quadro; a compressao JPEG acontece apenas para o quadro
        // ESCOLHIDO (antes eram 8 compressoes 4K por clique = lento).
        hiResBlobByCanvasRef.current.set(canvas,{hi,width:hiW,height:hiH,videoW,videoH});
      }else{
        canvas.getContext("2d")?.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      }
      return canvas;
    };

    // DISPARO INSTANTANEO: o quadro usado e o do exato momento do toque.
    // Congela a imagem e so depois mostra a tela de carregamento; o usuario
    // pode soltar a posicao imediatamente.
    let tapCanvas=drawCurrentFrame();
    try{ video?.pause(); }catch{ /* ignora */ }

    // FOTO COMPLETA (sensor inteiro) quando o navegador permite.
    if(!externalPhoto && FULL_PHOTO_ENABLED && canTakeFullPhoto(camera.streamRef.current)){
      setCaptureProgress({pct:8,label:"Segure firme · foto em alta"});
      await nextPaint();
      const blob=await takeFullPhoto(camera.streamRef.current!,FULL_PHOTO_TIMEOUT_MS);
      const photoCanvas=blob ? await decodePhoto(blob) : null;
      const match=photoCanvas ? alignPhotoToFrame(photoCanvas,tapCanvas) : null;
      if(match){
        aligned=match;
        photoSourceLabel=`foto completa ${photoCanvas!.width}×${photoCanvas!.height} (alinhada, dif ${match.score.toFixed(1)})`;
        tapCanvas=drawCurrentFrame();
      }else{
        photoSourceLabel=blob ? "vídeo (foto completa não alinhou: mão mexeu?)" : "vídeo (foto completa indisponível)";
      }
    }
    setPhotoSourceInfo(photoSourceLabel);
    setCaptureProgress({pct:20,label:"Foto tirada"});
    await nextPaint();

    type BurstCandidate={
      photo:string;
      canvas:HTMLCanvasElement;
      score:number;
      consistencyScore:number;
      guide:ReturnType<typeof analyzeLiveCardGuide>;
      calibration:Awaited<ReturnType<typeof calibratePhoto>> | null;
    };

    const scoreGuide = (guide:ReturnType<typeof analyzeLiveCardGuide>) => {
      let score=0;

      // Cartao/enquadramento.
      score += guide.frameAligned ? 24 : 8;
      score += guide.angle==="aligned" ? 16 : guide.angle==="unknown" ? 5 : 9;
      score += Math.max(0,8-Math.abs(guide.skew)*120);

      // Dedo: preferimos reto, mas nao transformamos isso em trava.
      if(guide.fingerTiltDeg!==null && guide.fingerTiltConfidence>=45){
        score += 14*Math.max(0,1-Math.abs(guide.fingerTiltDeg)/6);
      }else{
        score += 5;
      }

      // Centralizacao optica e cartao sobre o dedo.
      if(guide.opticalCenterOffsetPx!==null && guide.opticalCenterConfidence>=45){
        score += 14*Math.max(0,1-Math.abs(guide.opticalCenterOffsetPx)/18);
      }else{
        score += 5;
      }
      if(guide.cardFingerOffsetPx!==null && guide.opticalCenterConfidence>=45){
        score += 10*Math.max(0,1-Math.abs(guide.cardFingerOffsetPx)/16);
      }else{
        score += 4;
      }

      // Orientacao do aparelho entra como peso, nunca como sincronizacao obrigatoria.
      if(deviceQuality.stabilityScore!==null){
        score += 8*Math.max(0,Math.min(1,(deviceQuality.stabilityScore-65)/35));
      }
      if(deviceQuality.devicePitch!==null){
        score += 4*Math.max(0,1-Math.abs(deviceQuality.devicePitch)/12);
      }
      if(deviceQuality.deviceRoll!==null){
        score += 4*Math.max(0,1-Math.abs(deviceQuality.deviceRoll)/8);
      }

      return score;
    };

    // Rajada de 8 quadros desligada: exigia segurar a posicao ~1 s.
    const useBurst =
      !INSTANT_SHUTTER &&
      singlePhotoTestMode &&
      measurementMode==="finger" &&
      !diameterPhotoTestMode;

    let selectedCanvas:HTMLCanvasElement;
    let capturedPhoto:string;
    let selectedBurstCalibration:Awaited<ReturnType<typeof calibratePhoto>> | null=null;
    const burstCanvasesForRelease:HTMLCanvasElement[]=[];

    if(useBurst){
      camera.setError("Selecionando automaticamente o melhor quadro...");
      const candidates:BurstCandidate[]=[];

      for(let index=0;index<8;index++){
        const canvas=drawCurrentFrame();
        burstCanvasesForRelease.push(canvas);
        const guide=analyzeLiveCardGuide(video!);
        candidates.push({
          canvas,
          photo:canvas.toDataURL("image/jpeg",0.94),
          guide,
          score:scoreGuide(guide),
          consistencyScore:0,
          calibration:null,
        });
        setCaptureProgress({pct:6+Math.round((index+1)/8*24),label:"Capturando"});
        if(index<7){
          await new Promise<void>((resolve)=>window.setTimeout(resolve,65));
        }
      }
      // Quadros capturados: pausa o preview para liberar o processador.
      try{ video?.pause(); }catch{ /* ignora */ }

      // Consistencia geométrica da própria rajada:
      // calculamos a mediana da razão dedo/cartão e penalizamos frames
      // que fazem o dedo parecer artificialmente maior ou menor.
      const validRatios=candidates
        .map(candidate=>candidate.guide.fingerCardRatio)
        .filter((value):value is number=>value!==null && Number.isFinite(value) && value>0)
        .sort((x,y)=>x-y);

      const medianRatio=validRatios.length
        ? (
            validRatios.length%2
              ? validRatios[Math.floor(validRatios.length/2)]
              : (validRatios[validRatios.length/2-1]+validRatios[validRatios.length/2])/2
          )
        : null;

      for(const candidate of candidates){
        const ratio=candidate.guide.fingerCardRatio;
        if(medianRatio!==null && ratio!==null && ratio>0){
          const relativeDelta=Math.abs(ratio-medianRatio)/medianRatio;
          // Até ~1% recebe praticamente a pontuação máxima.
          // A partir de 3,5% o bônus zera, evitando extremos de paralaxe.
          candidate.consistencyScore=25*Math.max(0,1-relativeDelta/0.035);
        }else{
          candidate.consistencyScore=4;
        }
      }

      // Calibramos os 8 frames antes de escolher. Um frame só pode vencer
      // a rajada se também for elegível para o fluxo automático; assim não
      // escolhemos um quadro bonito/consistente que depois para na etapa do cartão.
      for(let ci=0;ci<candidates.length;ci++){
        const candidate=candidates[ci];
        setCaptureProgress({pct:30+Math.round((ci+1)/candidates.length*50),label:"Analisando o cartão…"});
        await nextPaint();
        try{
          candidate.calibration=await calibratePhoto(candidate.photo);
        }catch{
          candidate.calibration=null;
        }
      }

      const autoEligible=candidates.filter(candidate=>
        candidate.calibration!==null &&
        candidate.calibration.confidence>=MIN_CARD_CALIBRATION_CONFIDENCE
      );

      if(!autoEligible.length){
        camera.setError("A rajada não encontrou um quadro com calibração suficiente do cartão. Reenquadre cartão e dedo e tente novamente.");
        return;
      }

      // Entre os quadros que já passaram pela calibração mínima, vence o mais
      // consistente com a mediana dedo/cartão; qualidade visual e confiança
      // do cartão servem como desempate.
      let best:BurstCandidate|null=null;
      let bestCombined=-Infinity;

      for(const candidate of autoEligible){
        const calibration=candidate.calibration!;
        const combined=
          candidate.consistencyScore*1.35 +
          candidate.score*0.65 +
          calibration.confidence*0.45;

        if(combined>bestCombined){
          best=candidate;
          bestCombined=combined;
        }
      }

      if(!best || !best.calibration){
        camera.setError("Não encontrei um quadro confiável nesta rajada. Mantenha cartão e dedo no enquadramento e tente novamente.");
        return;
      }

      selectedCanvas=best.canvas;
      capturedPhoto=best.photo;
      selectedBurstCalibration=best.calibration;
      const ratioText=best.guide.fingerCardRatio===null
        ? "n/d"
        : best.guide.fingerCardRatio.toFixed(4);
      camera.setError("");
    }else{
      selectedCanvas=tapCanvas;
      capturedPhoto=selectedCanvas.toDataURL("image/jpeg",0.94);
      setCaptureProgress({pct:40,label:"Analisando o cartão…"});
      await nextPaint();
    }

    setCaptureProgress({pct:88,label:"Preparando a medição…"});
    await nextPaint();
    // Alias mantido para o restante do fluxo existente.
    const canvas=selectedCanvas;
    setPhoto(capturedPhoto);
    {
      const hiEntry=hiResBlobByCanvasRef.current.get(selectedCanvas);
      // Libera os quadros em alta dos candidatos descartados.
      for(const other of burstCanvasesForRelease){
        if(other===selectedCanvas) continue;
        const e=hiResBlobByCanvasRef.current.get(other);
        if(e){ e.hi.width=0; e.hi.height=0; hiResBlobByCanvasRef.current.delete(other); }
      }
      setPhotoHiRes((current)=>{ if(current) URL.revokeObjectURL(current.url); return null; });
      if(hiEntry){
        try{
          hiEntry.hi.toBlob((blob)=>{
            hiEntry.hi.width=0; hiEntry.hi.height=0;
            if(!blob) return;
            const url=URL.createObjectURL(blob);
            setPhotoHiRes({forPhoto:capturedPhoto,url,width:hiEntry.width,height:hiEntry.height,videoW:hiEntry.videoW,videoH:hiEntry.videoH});
          },"image/jpeg",0.93);
        }catch{ /* segue com a foto 900x1200 */ }
      }
    }

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
        const calibration = selectedBurstCalibration ?? await calibratePhoto(capturedPhoto);
        const detectedLeft = clamp(calibration.cardBox.x * 100, 2, 94);
        const detectedRight = clamp((calibration.cardBox.x + calibration.cardBox.width) * 100, 6, 98);
        const detectedBottom = clamp((calibration.cardBox.y + calibration.cardBox.height) * 100, 10, 88);
        const detectedTop = clamp(calibration.cardBox.y * 100, 3, detectedBottom - 5);

        // AUTO-SNAP FISICO DAS 3 LINHAS DO CARTAO.
        // O detector so aproxima o retangulo. A escala de 85,60 mm passa a usar
        // as bordas fisicas refinadas no proprio frame vencedor da rajada.
        const refineCardEdges = () => {
          const context=canvas.getContext("2d",{willReadFrequently:true});
          if(!context) return null;
          const imageData=context.getImageData(0,0,canvas.width,canvas.height);
          const data=imageData.data;
          const gray=(x:number,y:number)=>{
            const ix=Math.max(0,Math.min(canvas.width-1,Math.round(x)));
            const iy=Math.max(0,Math.min(canvas.height-1,Math.round(y)));
            const o=(iy*canvas.width+ix)*4;
            return data[o]*0.299+data[o+1]*0.587+data[o+2]*0.114;
          };
          const robustMean=(values:number[])=>{
            if(!values.length) return 0;
            const ordered=[...values].sort((a,b)=>a-b);
            const trim=Math.floor(ordered.length*0.18);
            const kept=ordered.slice(trim,Math.max(trim+1,ordered.length-trim));
            return kept.reduce((sum,value)=>sum+value,0)/kept.length;
          };

          const left0=detectedLeft/100*canvas.width;
          const right0=detectedRight/100*canvas.width;
          const top0=detectedTop/100*canvas.height;
          const bottom0=detectedBottom/100*canvas.height;
          const cardW=Math.max(40,right0-left0);
          const cardH=Math.max(30,bottom0-top0);

          type VerticalEdgeCandidate={
            x:number;
            dx:number;
            edge:number;
            coverage:number;
            score:number;
          };

          // Procura a BORDA FISICA EXTERNA de cada lateral.
          // Primeiro identifica quais candidatos possuem contraste forte e
          // continuidade vertical. Entre candidatos equivalentes, prefere:
          //   esquerda -> o mais externo para a esquerda
          //   direita  -> o mais externo para a direita
          // Isso evita grudar em faixa, texto ou desenho interno do cartão.
          const bestVertical=(
            expectedX:number,
            side:"left"|"right",
            yFrom:number=top0+cardH*0.14,
            yTo:number=bottom0-cardH*0.14,
            radius:number=18,
          )=>{
            const direction=side==="left" ? -1 : 1;
            const candidates:VerticalEdgeCandidate[]=[];

            for(let dx=-radius;dx<=radius;dx+=1){
              const x=expectedX+dx;
              const contrasts:number[]=[];
              let strong=0;
              let samples=0;

              for(let y=yFrom;y<=yTo;y+=Math.max(4,(yTo-yFrom)/12)){
                const contrast=Math.abs(gray(x-3,y)-gray(x+3,y));
                contrasts.push(contrast);
                if(contrast>=10) strong++;
                samples++;
              }

              const edge=robustMean(contrasts);
              const coverage=strong/Math.max(1,samples);
              const outward=Math.max(0,direction*dx);
              const inward=Math.max(0,-direction*dx);

              // Continuidade vertical pesa mais que um pico isolado.
              // Pequeno bônus externo só desempata bordas fisicamente plausíveis.
              const score=
                edge +
                coverage*12 +
                outward*0.22 -
                inward*0.18 -
                Math.abs(dx)*0.035;

              candidates.push({x,dx,edge,coverage,score});
            }

            const maxEdge=Math.max(...candidates.map(candidate=>candidate.edge));
            const maxCoverage=Math.max(...candidates.map(candidate=>candidate.coverage));

            const physicalCandidates=candidates.filter(candidate=>
              candidate.edge>=Math.max(7,maxEdge*0.78) &&
              candidate.coverage>=Math.max(0.52,maxCoverage-0.18)
            );

            const pool=physicalCandidates.length ? physicalCandidates : candidates;

            // Dentro do conjunto de bordas fortes/contínuas, escolhemos a mais
            // externa. O score serve de desempate caso duas fiquem praticamente
            // na mesma posição.
            pool.sort((a,b)=>{
              const outerA=direction*a.dx;
              const outerB=direction*b.dx;
              if(Math.abs(outerB-outerA)>0.75) return outerB-outerA;
              return b.score-a.score;
            });

            const best=pool[0];
            return {
              x:best.x,
              score:best.score,
              edge:best.edge,
              coverage:best.coverage,
              shift:best.x-expectedX,
            };
          };

          const leftEdge=bestVertical(left0,"left");
          const rightEdge=bestVertical(right0,"right");

          // INCLINACAO REAL DE CADA LATERAL: a borda do cartao quase nunca fica
          // perfeitamente vertical na foto. Medimos a borda na metade de cima e
          // na metade de baixo e tracamos a reta pelos dois pontos, para a
          // intersecao com a base (onde valem os 85,60 mm) cair na borda real.
          const yA=top0+cardH*0.14;
          const yB=bottom0-cardH*0.14;
          const yM=(yA+yB)/2;
          const sideTilt=(edgeX:number,side:"left"|"right")=>{
            const upper=bestVertical(edgeX,side,yA,yM,6);
            const lower=bestVertical(edgeX,side,yM,yB,6);
            const yU=(yA+yM)/2, yL=(yM+yB)/2;
            const slope=(lower.x-upper.x)/Math.max(1,yL-yU); // px em x por px em y
            const ok=
              upper.edge>=7 && lower.edge>=7 &&
              upper.coverage>=0.52 && lower.coverage>=0.52 &&
              Math.abs(slope)<=CARD_EDGE_MAX_TILT;
            return ok
              ? {slope, xAt:(y:number)=>upper.x+slope*(y-yU)}
              : {slope:0, xAt:(_y:number)=>edgeX};
          };
          const leftTiltRaw=sideTilt(leftEdge.x,"left");
          const rightTiltRaw=sideTilt(rightEdge.x,"right");
          // As duas laterais usam a MESMA inclinacao (media): acompanha o cartao
          // girado na foto sem abrir/fechar as linhas. Assim a largura na base
          // continua igual a largura medida no meio do cartao (como no metodo
          // original, sobre o qual a curva foi calibrada).
          const bothTilted=leftTiltRaw.slope!==0 && rightTiltRaw.slope!==0;
          const sharedSlope=bothTilted ? (leftTiltRaw.slope+rightTiltRaw.slope)/2 : 0;
          const yRef=(yA+yB)/2;
          let leftTilt={slope:sharedSlope,xAt:(y:number)=>leftEdge.x+sharedSlope*(y-yRef)};
          let rightTilt={slope:sharedSlope,xAt:(y:number)=>rightEdge.x+sharedSlope*(y-yRef)};

          // BORDA FISICA REAL (medidordedov12): o detector original escolhe o
          // candidato MAIS EXTERNO e costuma grudar na sombra/fundo alguns px
          // fora do cartao (variavel por foto). Refinamos cada lateral com o
          // detector de borda nitida (subpixel), na metade de cima e na de baixo,
          // perto da borda original. A curva foi calibrada com o vies medio do
          // original; ele e reaplicado SO na escala (CARD_LEGACY_SCALE).
          {
            const rgbImg={data:imageData.data,width:canvas.width,height:canvas.height};
            // Cartao colorido -> bordas na imagem de cromaticidade (sem sombra).
            const cardSat=regionSaturation(rgbImg,leftEdge.x+cardW*0.15,yA,rightEdge.x-cardW*0.15,yB);
            const useChroma=CARD_CHROMA_EDGES && cardSat>=CARD_CHROMA_MIN_SATURATION;
            const img=useChroma?chromaticityImage(rgbImg):rgbImg;
            cardEdgeMode=useChroma?`cromaticidade (sat ${cardSat.toFixed(2)})`:`brilho (sat ${cardSat.toFixed(2)})`;
            const maxShift=useChroma?CARD_PHYSICAL_MAX_SHIFT_PX+2:CARD_PHYSICAL_MAX_SHIFT_PX;
            const edgeHalf=(side:"left"|"right",expected:number,from:number,to:number)=>
              findCardEdge(img,{side,expected,from,to,searchPx:useChroma?10:8});
            const lU=edgeHalf("left",leftEdge.x,yA,yM), lL=edgeHalf("left",leftEdge.x,yM,yB);
            const rU=edgeHalf("right",rightEdge.x,yA,yM), rL=edgeHalf("right",rightEdge.x,yM,yB);
            const yU=(yA+yM)/2, yL=(yM+yB)/2;
            if(lU.reliable&&lL.reliable&&rU.reliable&&rL.reliable){
              const sl=(lL.position-lU.position)/(yL-yU);
              const sr=(rL.position-rU.position)/(yL-yU);
              const slope=Math.abs(sl)<=CARD_EDGE_MAX_TILT&&Math.abs(sr)<=CARD_EDGE_MAX_TILT?(sl+sr)/2:0;
              const lMid=(lU.position+lL.position)/2, rMid=(rU.position+rL.position)/2;
              const yMid=(yU+yL)/2;
              const physWidth=rMid-lMid;
              // So aceita se ficar perto da leitura original (protege contra frisos).
              const lShift=lMid+slope*(yRef-yMid)-leftEdge.x;
              const rShift=rMid+slope*(yRef-yMid)-rightEdge.x;
              cardEdgeShifts=`E ${lShift>=0?"+":""}${lShift.toFixed(1)} D ${rShift>=0?"+":""}${rShift.toFixed(1)} px`;
              if(Math.abs(lShift)<=maxShift && Math.abs(rShift)<=maxShift && Math.abs(physWidth-(rightEdge.x-leftEdge.x))<=cardW*0.03){
                leftTilt={slope,xAt:(y:number)=>lMid+slope*(y-yMid)};
                rightTilt={slope,xAt:(y:number)=>rMid+slope*(y-yMid)};
                physicalCardEdgesUsed=true;
              }
            }
          }
          const refinedLeft=Math.min(leftEdge.x,rightEdge.x-20);
          const refinedRight=Math.max(rightEdge.x,leftEdge.x+20);

          const bestHorizontal=(expectedY:number)=>{
            let bestY=expectedY;
            let bestScore=-Infinity;
            for(let dy=-14;dy<=14;dy+=1){
              const y=expectedY+dy;
              const contrasts:number[]=[];
              for(let x=refinedLeft+cardW*0.10;x<=refinedRight-cardW*0.10;x+=Math.max(4,cardW/28)){
                contrasts.push(Math.abs(gray(x,y-3)-gray(x,y+3)));
              }
              const edge=robustMean(contrasts);
              const score=edge-Math.abs(dy)*0.20;
              if(score>bestScore){bestScore=score;bestY=y;}
            }
            return {y:bestY,score:bestScore,shift:bestY-expectedY};
          };

          const bottomEdge=bestHorizontal(bottom0);

          // So aceitamos o refinamento se as 3 bordas possuem contraste real.
          // Caso contrario, mantemos o retangulo inicial como fallback.
          {
            const reasons:string[]=[];
            if(leftEdge.edge<7) reasons.push(`esq contraste ${leftEdge.edge.toFixed(1)}<7`);
            if(rightEdge.edge<7) reasons.push(`dir contraste ${rightEdge.edge.toFixed(1)}<7`);
            if(leftEdge.coverage<0.52) reasons.push(`esq cobertura ${leftEdge.coverage.toFixed(2)}<0,52`);
            if(rightEdge.coverage<0.52) reasons.push(`dir cobertura ${rightEdge.coverage.toFixed(2)}<0,52`);
            if(bottomEdge.score<7) reasons.push(`base ${bottomEdge.score.toFixed(1)}<7`);
            if(refinedRight-refinedLeft<cardW*0.92 || refinedRight-refinedLeft>cardW*1.10) reasons.push(`largura ${(refinedRight-refinedLeft).toFixed(0)} fora de ${(cardW*0.92).toFixed(0)}–${(cardW*1.10).toFixed(0)}`);
            if(reasons.length){
              legacyRefineFailReason=reasons.join(" · ");
              return null;
            }
          }

          // Bordas avaliadas NA ALTURA DA BASE (intersecoes A e B).
          const leftAtBase=leftTilt.xAt(bottomEdge.y);
          const rightAtBase=rightTilt.xAt(bottomEdge.y);
          const useTilt=physicalCardEdgesUsed || Math.abs((rightAtBase-leftAtBase)-(refinedRight-refinedLeft))<cardW*0.03;
          return {
            left:clamp((useTilt?leftAtBase:refinedLeft)/canvas.width*100,2,94),
            right:clamp((useTilt?rightAtBase:refinedRight)/canvas.width*100,6,98),
            bottom:clamp(bottomEdge.y/canvas.height*100,10,88),
            // inclinacao em unidades de % (dx% por dy%)
            leftSlopePct:useTilt?leftTilt.slope*canvas.height/canvas.width:0,
            rightSlopePct:useTilt?rightTilt.slope*canvas.height/canvas.width:0,
            leftShiftPx:leftEdge.shift,
            rightShiftPx:rightEdge.shift,
            bottomShiftPx:bottomEdge.shift,
          };
        };

        let legacyRefineFailReason="";
        let physicalCardEdgesUsed=false;
        let cardEdgeShifts="";
        let cardEdgeMode="";
        const legacyRefined=refineCardEdges();
        // medidordedov8: se o refino ORIGINAL falhar, NAO cair na caixa
        // aproximada (podia errar 10+ px e mudar 2 aros). Usa o detector novo
        // de borda fisica a partir da mesma caixa.
        let cardEdgeSource:"refino original"|"detector novo (fallback)"|"caixa aproximada"=legacyRefined?"refino original":"caixa aproximada";
        let refined=legacyRefined;
        if(!refined){
          try{
            const ctx2=canvas.getContext("2d",{willReadFrequently:true});
            if(ctx2){
              const W2=canvas.width,H2=canvas.height;
              const img2=ctx2.getImageData(0,0,W2,H2);
              const fb=refineCardEdgesNew({data:img2.data,width:W2,height:H2},{leftPct:detectedLeft,rightPct:detectedRight,topPct:detectedTop,bottomPct:detectedBottom});
              if(fb.refined){
                refined={
                  left:clamp(fb.left/W2*100,2,94),
                  right:clamp(fb.right/W2*100,6,98),
                  bottom:clamp(fb.bottom/H2*100,10,88),
                  leftShiftPx:fb.left-detectedLeft/100*W2,
                  rightShiftPx:fb.right-detectedRight/100*W2,
                  bottomShiftPx:fb.bottom-detectedBottom/100*H2,
                  leftSlopePct:0,
                  rightSlopePct:0,
                };
                cardEdgeSource="detector novo (fallback)";
              }
            }
          }catch{ /* mantem caixa aproximada */ }
        }

        setCardEdgeInfo({source:(physicalCardEdgesUsed?"borda física real (+0,57% compat. curva)":cardEdgeSource)+(cardEdgeMode?` · ${cardEdgeMode}`:"")+(cardEdgeShifts?` · física−original ${cardEdgeShifts}`:"")+(refined && (refined.leftSlopePct||refined.rightSlopePct) ? ` · laterais inclinadas E ${(Math.atan((refined.leftSlopePct??0)*canvas.width/canvas.height)*180/Math.PI).toFixed(1)}° D ${(Math.atan((refined.rightSlopePct??0)*canvas.width/canvas.height)*180/Math.PI).toFixed(1)}°` : ""),legacyFail:legacyRefineFailReason});
        const finalLeft = refined
          ? Math.min(refined.left, refined.right - 5)
          : Math.min(detectedLeft, detectedRight - 5);
        const finalRight = refined
          ? Math.max(refined.right, refined.left + 5)
          : Math.max(detectedRight, detectedLeft + 5);
        const finalBottom = refined?.bottom ?? detectedBottom;
        const top = clamp(detectedTop, 3, finalBottom - 5);
        const padY = Math.min(7, Math.max(3, (finalBottom-top)*0.15));

        // Laterais seguem a inclinacao real da borda e passam exatamente
        // pelas intersecoes com a base (finalLeft/finalRight).
        const leftSlopePct=refined?.leftSlopePct ?? 0;
        const rightSlopePct=refined?.rightSlopePct ?? 0;
        const leftXAt=(y:number)=>finalLeft+leftSlopePct*(y-finalBottom);
        const rightXAt=(y:number)=>finalRight+rightSlopePct*(y-finalBottom);
        const lineTopY=clamp(top-padY,1,99);
        const lineBottomY=clamp(finalBottom+padY,1,99);
        const detectedLeftLine:Line={
          a:{x:leftXAt(lineTopY),y:lineTopY},
          b:{x:leftXAt(lineBottomY),y:lineBottomY},
        };
        const detectedRightLine:Line={
          a:{x:rightXAt(lineTopY),y:lineTopY},
          b:{x:rightXAt(lineBottomY),y:lineBottomY},
        };
        const detectedBottomLine:Line={
          a:{x:finalLeft,y:finalBottom},
          b:{x:finalRight,y:finalBottom},
        };
        const detectedQuad:[Point,Point,Point,Point]=[
          {x:leftXAt(top),y:top},
          {x:rightXAt(top),y:top},
          {x:finalRight,y:finalBottom},
          {x:finalLeft,y:finalBottom},
        ];

        setCardLeft(finalLeft);
        setCardRight(finalRight);
        setCardBottom(finalBottom);
        setCardLines({
          top:{a:{x:leftXAt(top),y:top},b:{x:rightXAt(top),y:top}},
          right:detectedRightLine,
          bottom:detectedBottomLine,
          left:detectedLeftLine,
        });

        // Fluxo comercial de 1 foto: o detector leve ja confirmou o cartao.
        // Aplicamos automaticamente esquerda, direita e base e seguimos
        // direto para a medicao do dedo. Ajuste manual permanece como fallback.
        if(singlePhotoTestMode && calibration.confidence>=MIN_CARD_CALIBRATION_CONFIDENCE){
          setCardSnapLines({
            left:detectedLeftLine,
            right:detectedRightLine,
            bottom:detectedBottomLine,
          });
          setCardLineLocked({top:false,right:true,bottom:true,left:true});
          setCardQuad(detectedQuad);
          setPerspectiveReady(true);
          setCalibrationConfidence(calibration.confidence);
          // v18: o usuario confere/ajusta as laterais do cartao com zoom e lupa
          // antes de medir o dedo. As linhas automaticas ficam como ponto de partida.
          if(MANUAL_CARD_STEP){
            autoCardLinesRef.current={left:detectedLeftLine,right:detectedRightLine,bottom:detectedBottomLine};
            setCardLineLocked({top:false,right:true,bottom:true,left:true});
            setZoom(1); setPanX(0); setPanY(0);
            setAnalyzingCard(false);
            camera.setError("");
            return;
          }
          // IMPORTANTE: o detector leve apenas posiciona as 3 linhas.
          // A escala oficial NAO usa calibration.pixelsPerMm.
          // Voltamos à regra congelada: a distância entre as interseções
          // esquerda×base e direita×base representa exatamente 85,60 mm.
          // A foto acabou de ser capturada em canvas 900x1200.
          // Nao esperamos photoPixelsRef carregar para definir a escala,
          // porque isso criava uma corrida assíncrona e podia cair no fallback
          // pixelsPerMm=1 antes do buffer da foto ficar pronto.
          //
          // A escala continua vindo SOMENTE das interseções das 3 linhas:
          // A = esquerda x base, B = direita x base, |A-B| = 85,60 mm.
          const intersectionWidthPx=Math.hypot(
            (finalRight-finalLeft)/100*canvas.width,
            0,
          );
          // Linhas na borda real; a escala reaplica o vies medio do detector
          // original (sobre o qual a curva de aros foi calibrada).
          const intersectionPixelsPerMm=intersectionWidthPx*(physicalCardEdgesUsed?CARD_LEGACY_SCALE:1)/CARD_WIDTH_MM;

          setMeasurementCardLengthPx(intersectionWidthPx);

          setFingerCardCalibrationStep("done");
          setAnalyzingCard(false);
          activateFingerMeasurement(
            finalLeft,
            finalRight,
            finalBottom,
            calibration.confidence,
            detectedQuad,
            intersectionPixelsPerMm,
          );
          camera.setError("");
          return;
        }
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

  const applyLightCardDetection = (payload:LightCardDetectionPayload) => {
    if(payload.confidence<90){
      camera.setError("Detecção automática abaixo de 90% de confiança. Ajuste manualmente.");
      return;
    }

    const {x,y,width,height}=payload.cardBox;
    const leftX=clamp(x*100,1,99);
    const rightX=clamp((x+width)*100,1,99);
    const topY=clamp(y*100,1,99);
    const bottomY=clamp((y+height)*100,1,99);

    if(rightX-leftX<12 || bottomY-topY<8){
      camera.setError("Detecção automática inválida. Ajuste o cartão manualmente.");
      return;
    }

    const left:Line={a:{x:leftX,y:topY},b:{x:leftX,y:bottomY}};
    const right:Line={a:{x:rightX,y:topY},b:{x:rightX,y:bottomY}};
    const bottom:Line={a:{x:leftX,y:bottomY},b:{x:rightX,y:bottomY}};

    // Pré-calibração automática: somente posiciona as três guias.
    // A escala oficial continua sendo calculada depois pelas interseções
    // A-B da base, equivalentes a 85,60 mm.
    setCardLines((current)=>({
      ...current,
      left,
      right,
      bottom,
    }));
    setCardSnapLines({left,right,bottom});
    setCardLineLocked((current)=>({
      ...current,
      left:true,
      right:true,
      bottom:true,
    }));
    setSelectedCardLine(null);
    setPerspectiveReady(false);
    setCardLeft(leftX);
    setCardRight(rightX);
    setCardBottom(bottomY);
    camera.setError("Cartão detectado automaticamente. Confira as 3 linhas e ajuste se necessário.");
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

    // TESTE: as guias verticais do dedo nascem exatamente nas duas
    // intersecoes da base calibrada do cartao. Isso cria uma origem geometrica
    // comum entre calibracao e medicao e reduz a variacao causada por o usuario
    // reposicionar as linhas em X de uma tentativa para outra.
    const anchoredLeft=clamp(Math.min(baseLeft,baseRight-3),2,95);
    const anchoredRight=clamp(Math.max(baseRight,baseLeft+3),5,98);
    setLeftLine(anchoredLeft);
    setRightLine(anchoredRight);

    // ALTURA PADRAO DO ANEL quando o contorno/landmarks nao detectam a regiao:
    // antes era base+17%, perto da dobra entre os dedos, onde o dedo alarga
    // (foto do cartao azul: Y 64% = base 47% + 17 -> 21,88 mm, aro 26).
    // Fotos que acertaram mediram em base+3,5% (contorno detectado).
    // Agora o padrao fica dentro da mesma faixa anatomica (base+5%).
    const nextMeasureY=clamp(baseBottom+RING_HEIGHT_FALLBACK_OFFSET,30,84);
    setMeasureY(nextMeasureY);
    setRingGuideY(nextMeasureY);
    setFingerLines({
      left:{
        a:{x:anchoredLeft,y:clamp(baseBottom,4,96)},
        b:{x:anchoredLeft,y:clamp(nextMeasureY+20,4,96)},
      },
      right:{
        a:{x:anchoredRight,y:clamp(baseBottom,4,96)},
        b:{x:anchoredRight,y:clamp(nextMeasureY+20,4,96)},
      },
    });
    // Mantem exatamente o zoom e o enquadramento usados na calibracao.
    // As linhas continuam ancoradas na base do cartao, mas a transicao para
    // a medicao do dedo nao pode mudar a ampliacao escolhida pelo usuario.
    camera.setError("");
    setPhase("finger");

    // Como a propria base do cartao agora posiciona as guias, elas ja entram
    // travadas como sementes do refinamento automatico. O usuario ainda pode
    // arrastar manualmente para comparar durante o teste.
    setLeftLocked(true);
    setRightLocked(true);
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

    // A linha visual pode ser alongada, encurtada ou inclinada livremente.
    // O comprimento desenhado NUNCA entra na calibracao. O que vale e somente
    // a distancia euclidiana entre:
    //   A = intersecao(base, lateral esquerda)
    //   B = intersecao(base, lateral direita)
    // A-B representa fisicamente 85,60 mm.
    //
    // Um snap so pode participar enquanto aquela mesma borda continuar
    // explicitamente travada. Se o usuario voltar a mover a guia, usamos
    // imediatamente a geometria visual atual e descartamos o snap antigo.
    const lineForCalibration = (edge:"left"|"right"|"bottom"):Line => {
      const snapped=cardSnapLines[edge];
      return useSnap && cardLineLocked[edge] && snapped ? snapped : cardLines[edge];
    };

    const leftMeasureLine=lineForCalibration("left");
    const rightMeasureLine=lineForCalibration("right");
    const bottomMeasureLine=lineForCalibration("bottom");

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

      const leftPercent={x:segment.leftPx.x/source.width*100,y:segment.leftPx.y/source.height*100};
      const rightPercent={x:segment.rightPx.x/source.width*100,y:segment.rightPx.y/source.height*100};
      const bottomY=(leftPercent.y+rightPercent.y)/2;
      const syntheticTopY=clamp(bottomY-28,2,96);
      const syntheticQuad:[Point,Point,Point,Point]=[
        {x:leftPercent.x,y:syntheticTopY},
        {x:rightPercent.x,y:syntheticTopY},
        rightPercent,
        leftPercent,
      ];

      // v18: linhas colocadas na borda real pelo usuario; reaplica o vies medio
      // do detector original para manter a curva de aros.
      let pxPerMm=widthPx*(MANUAL_CARD_STEP?CARD_LEGACY_SCALE:1)/CARD_WIDTH_MM;
      if(MANUAL_CARD_STEP) setCardEdgeInfo({source:"ajuste manual nas laterais (+0,57% compat. curva)",legacyFail:""});
      let activeQuad=syntheticQuad;
      let activeHomography:Homography|null=null;
      let cardConfidence=96;

      if(VISION_FEATURE_FLAGS.ENABLE_PERSPECTIVE_CORRECTION){
        try{
          const actualQuad=quadFromLines(cardLines);
          const actualPx=validateCardQuad(actualQuad);
          const geometry=assessCardQuadGeometry(actualPx,CARD_WIDTH_MM,CARD_HEIGHT_MM);
          cardConfidence=Math.min(cardConfidence,geometry.confidence);

          if(!geometry.valid){
            camera.setError(geometry.reason || "Perspectiva do cartão fora do limite. Refaça a captura.");
            return;
          }

          activeHomography=buildHomography(
            actualPx,
            [{x:0,y:0},{x:CARD_WIDTH_MM,y:0},{x:CARD_WIDTH_MM,y:CARD_HEIGHT_MM},{x:0,y:CARD_HEIGHT_MM}],
          );
          activeQuad=actualQuad;

          // IMPORTANTE: a homografia serve apenas para diagnostico e validacao
          // de perspectiva. Ela NAO pode substituir a escala fisica oficial.
          // A escala continua sendo definida exclusivamente pelo segmento A-B
          // entre as intersecoes da base com as duas laterais: A-B = 85,60 mm.
        }catch{
          // Fallback seguro: mantém a calibração antiga por 85,60 mm.
          activeHomography=null;
          activeQuad=syntheticQuad;
        }
      }

      setMeasurementCardHomography(activeHomography);
      setFingerCardCalibrationStep("done");
      setCalibrationConfidence(cardConfidence);
      activateFingerMeasurement(leftPercent.x,rightPercent.x,bottomY,cardConfidence,activeQuad,pxPerMm);
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
        // Ao mover uma guia, invalida imediatamente qualquer snap anterior
        // dessa mesma borda. Assim a escala nunca usa uma geometria velha
        // enquanto a linha visual ja foi reposicionada pelo usuario.
        setCardSnapLines((current)=>{
          if(!current[edge]) return current;
          const next={...current};
          delete next[edge];
          return next;
        });
        let movedLine:Line|null=null;
        if(endpoint){
          movedLine={...cardLines[edge],[endpoint]:{x:clamp(imageX,1,99),y:clamp(imageY,1,99)}};
          setCardLines((current)=>({...current,[edge]:{...current[edge],[endpoint]:{x:clamp(imageX,1,99),y:clamp(imageY,1,99)}}}));
        } else {
          const start=cardLineDragStartRef.current;
          if(start){
            const dx=imageX-start.pointer.x, dy=imageY-start.pointer.y;
            movedLine={
              a:{x:clamp(start.line.a.x+dx,1,99),y:clamp(start.line.a.y+dy,1,99)},
              b:{x:clamp(start.line.b.x+dx,1,99),y:clamp(start.line.b.y+dy,1,99)},
            };
            setCardLines((current)=>({...current,[edge]:{
              a:{x:clamp(start.line.a.x+dx,1,99),y:clamp(start.line.a.y+dy,1,99)},
              b:{x:clamp(start.line.b.x+dx,1,99),y:clamp(start.line.b.y+dy,1,99)},
            }}));
          }
        }
        // Lupa no ponto que define a escala: cruzamento da lateral com a base.
        if(movedLine && measureRef.current){
          const r=measureRef.current.getBoundingClientRect();
          const base=edge==="bottom"?movedLine:cardLines.bottom;
          const baseY=(base.a.y+base.b.y)/2;
          let lx:number, ly:number;
          if(edge==="bottom"){ lx=(movedLine.a.x+movedLine.b.x)/2; ly=baseY; }
          else {
            const dyl=movedLine.b.y-movedLine.a.y;
            const t=Math.abs(dyl)<1e-6?0.5:(baseY-movedLine.a.y)/dyl;
            lx=movedLine.a.x+(movedLine.b.x-movedLine.a.x)*t; ly=baseY;
          }
          setFingerLoupe({side:edge==="left"?"left":"right",imageX:clamp(lx,0,100),imageY:clamp(ly,0,100),stageW:r.width,stageH:r.height,zoom});
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
      setFingerLoupe({side:"left",imageX:clamp(lineImageX,0,100),imageY:clamp(guideImageY,0,100),stageW:rect.width,stageH:rect.height,zoom});
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
      setFingerLoupe({side:"right",imageX:clamp(lineImageX,0,100),imageY:clamp(guideImageY,0,100),stageW:rect.width,stageH:rect.height,zoom});
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
    if(target==="height"){
      // A partir deste toque, nenhuma rotina anatomica pode devolver a linha
      // para o ponto automatico desta foto.
      ringGuideManualRef.current=true;
    }
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

    // V2: usa uma faixa vertical bem maior do dedo com 300 pontos de snap.
    // Os pontos existem somente sobre a linha/contorno analisado e servem para
    // estimar a borda continua com muito mais cobertura, sem "pontos soltos".
    const snapSampleCount=300;
    const snapHalfSpan=Math.min(150,Math.max(90,source.height*0.12))/Math.max(1,zoom);
    const sampleOffsets=Array.from({length:snapSampleCount},(_,index)=>{
      if(snapSampleCount<=1) return 0;
      return -snapHalfSpan+(index/(snapSampleCount-1))*snapHalfSpan*2;
    });
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

  // v21: encaixa uma linha do cartao na borda fisica (cor sem brilho para
  // cartao colorido). Mede a borda em 2 alturas e traca a reta pelos pontos.
  const snapCardEdgePhysical = (edge:"left"|"right"|"bottom", radiusPx:number, base?:Line, ctx:typeof cardLines=cardLines):Line|null => {
    const source=photoPixelsRef.current;
    if(!source) return null;
    const W=source.width, H=source.height;
    const line=base ?? ctx[edge];
    const toPx=(p:Point)=>({x:p.x/100*W,y:p.y/100*H});
    const a=toPx(line.a), b=toPx(line.b);
    const rgb={data:source.data,width:W,height:H};
    const L=toPx(ctx.left.a), R=toPx(ctx.right.a);
    const topY=Math.min(ctx.top.a.y,ctx.top.b.y)/100*H;
    const botY=(ctx.bottom.a.y+ctx.bottom.b.y)/2/100*H;
    const sat=regionSaturation(rgb,Math.min(L.x,R.x)+30,topY+20,Math.max(L.x,R.x)-30,botY-20);
    const img=sat>=CARD_CHROMA_MIN_SATURATION?chromaticityImage(rgb):rgb;
    const xAt=(y:number)=>{ const dy=b.y-a.y; return Math.abs(dy)<1e-6?(a.x+b.x)/2:a.x+(b.x-a.x)*(y-a.y)/dy; };
    if(edge==="bottom"){
      const yAtX=(x:number)=>{ const dx=b.x-a.x; return Math.abs(dx)<1e-6?(a.y+b.y)/2:a.y+(b.y-a.y)*(x-a.x)/dx; };
      const x0=Math.min(L.x,R.x), x1=Math.max(L.x,R.x), w=x1-x0;
      const p1=findCardEdge(img,{side:"bottom",expected:yAtX(x0+w*0.3),from:x0+w*0.12,to:x0+w*0.45,searchPx:radiusPx});
      const p2=findCardEdge(img,{side:"bottom",expected:yAtX(x0+w*0.7),from:x0+w*0.55,to:x0+w*0.88,searchPx:radiusPx});
      if(!p1.reliable||!p2.reliable) return null;
      const xa=x0+w*0.285, xb=x0+w*0.715;
      const k=(p2.position-p1.position)/(xb-xa);
      const yA=p1.position+k*(a.x-xa), yB=p1.position+k*(b.x-xa);
      return {a:{x:line.a.x,y:clamp(yA/H*100,1,99)},b:{x:line.b.x,y:clamp(yB/H*100,1,99)}};
    }
    const span=botY-topY;
    const yA=topY+span*0.14, yM=topY+span*0.5, yB=topY+span*0.86;
    const up=findCardEdge(img,{side:edge,expected:xAt((yA+yM)/2),from:yA,to:yM,searchPx:radiusPx});
    const lo=findCardEdge(img,{side:edge,expected:xAt((yM+yB)/2),from:yM,to:yB,searchPx:radiusPx});
    if(!up.reliable||!lo.reliable) return null;
    const yU=(yA+yM)/2, yL=(yM+yB)/2;
    let slope=(lo.position-up.position)/(yL-yU);
    if(Math.abs(slope)>CARD_EDGE_MAX_TILT) return null;
    const x=(y:number)=>up.position+slope*(y-yU);
    return {a:{x:clamp(x(a.y)/W*100,1,99),y:line.a.y},b:{x:clamp(x(b.y)/W*100,1,99),y:line.b.y}};
  };

  const autoAdjustCardLines = () => {
    const start=autoCardLinesRef.current;
    const next={...cardLines,...(start ?? {})};
    const notes:string[]=[];
    for(const edge of ["left","right","bottom"] as const){
      const snapped=snapCardEdgePhysical(edge,CARD_AUTO_RADIUS_PX,next[edge],next);
      if(snapped){ next[edge]=snapped; } else notes.push(edge==="left"?"esquerda":edge==="right"?"direita":"base");
    }
    setCardLines(next);
    setCardSnapLines({});
    setCardLineLocked({top:false,left:true,right:true,bottom:true});
    camera.setError(notes.length?`Não encontrei com segurança: ${notes.join(", ")}. Ajuste essa linha na lupa.`:"");
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
        // v18: ajuste manual fica exatamente onde o usuario soltou (o ima
        // podia puxar a linha para a sombra).
        if(MANUAL_CARD_STEP){
          // v21: ima curto na borda fisica; se nao achar, fica onde soltou.
          if(edge==="left"||edge==="right"||edge==="bottom"){
            const snapped=snapCardEdgePhysical(edge,CARD_MAGNET_RADIUS_PX);
            if(snapped) setCardLines((current)=>({...current,[edge]:snapped}));
          }
          setCardLineLocked((current)=>({...current,[edge]:true}));
        }
        else snapCardLine(edge);
      }
    }
    draggingRef.current=null;
    fingerRefineDragRef.current=null;
    fingerLineDragStartRef.current=null;
    cardLineDragStartRef.current=null;
    cardCornerDragRef.current=null;
    setFingerLoupe(null);
  };

  const fingerBandSamplesPx = (guideYPercent = ringGuideY, scanHalfSpan = 10) => {
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
      const span=Math.max(2.5,Math.min(30,scanHalfSpan));
      const off=-span+(index*((span*2)/49));
      return clamp(guideYPercent+off,6,94);
    });
    const yPercents=rawYPercents.filter((value,index,array)=>
      index===0 || Math.abs(value-array[index-1])>0.02
    );

    const findEdge=(
      side:"left"|"right",
      centerX:number,
      fingerCenterX:number,
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

      // Semente: procura do CENTRO DO DEDO para fora.
      // Assim pegamos a primeira transicao pele -> fundo e evitamos sombras
      // ou texturas externas que ficam alguns pixels alem da borda real.
      //
      // Tracking: depois da primeira borda correta, continua priorizando o
      // grupo mais proximo da borda anterior para manter continuidade.
      let chosenGroup:{x:number;strength:number;score:number}[]|undefined;
      if(previousX===null){
        const eligible=groups.filter(group=>{
          const groupCenter=group.reduce((sum,item)=>sum+item.x,0)/group.length;
          return side==="left"
            ? groupCenter<fingerCenterX
            : groupCenter>fingerCenterX;
        });

        if(eligible.length){
          chosenGroup=eligible.reduce((best,group)=>{
            const center=group.reduce((sum,item)=>sum+item.x,0)/group.length;
            const bestCenter=best.reduce((sum,item)=>sum+item.x,0)/best.length;
            // Mais perto do centro = primeira borda encontrada ao sair do dedo.
            return Math.abs(center-fingerCenterX)<Math.abs(bestCenter-fingerCenterX)
              ? group
              : best;
          },eligible[0]);
        }
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

      const fingerCenterX=(leftCenter+rightCenter)/2;
      const le=findEdge("left",leftCenter,fingerCenterX,y,previousLeft,radius);
      const re=findEdge("right",rightCenter,fingerCenterX,y,previousRight,radius);
      if(le.score<6||re.score<6||re.x<=le.x) return null;

      const guideSpan=Math.abs(rightCenter-leftCenter);
      const detectedSpan=re.x-le.x;
      // A primeira borda nao pode abrir muito alem do gabarito visual.
      // Isto corta sombras externas sem impedir a curvatura normal do dedo.
      if(previousLeft===null && previousRight===null){
        if(detectedSpan>guideSpan*1.08 || detectedSpan<guideSpan*0.72) return null;
      }

      return {
        left:{x:le.x,y,yPercent,score:le.score},
        right:{x:re.x,y,yPercent,score:re.score},
      };
    };

    // Encontra a semente perto da linha amarela. As linhas manuais continuam
    // limitando a busca durante toda a varredura.
    const centerIndex=yPercents.reduce((bestIndex,value,index)=>
      Math.abs(value-guideYPercent)<Math.abs(yPercents[bestIndex]-guideYPercent)?index:bestIndex
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
      // Depois que os snaps inclinarem as linhas, a semente acompanha a
      // geometria real do dedo naquele Y, em vez de voltar para uma vertical fixa.
      const leftGuide=toImageX(lineXAtScreenY(fingerLines.left,yPercent));
      const rightGuide=toImageX(lineXAtScreenY(fingerLines.right,yPercent));
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

        // Cada corte usa a linha ja inclinada pelos snaps como centro de busca.
        // Assim a guia segue o eixo real do dedo e nao regride para a horizontal
        // da tela quando o dedo esta alguns graus torto.
        const manualLeft=toImageX(lineXAtScreenY(fingerLines.left,yPercent));
        const manualRight=toImageX(lineXAtScreenY(fingerLines.right,yPercent));
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

    // Detecta a inclinacao pelo eixo CENTRAL do dedo, nao pela tela.
    // Isso deixa a medida transversal perpendicular ao proprio dedo mesmo
    // quando a foto entra alguns graus torta.
    const centerPoints=leftPoints.map((leftPoint,index)=>({
      x:(leftPoint.x+rightPoints[index].x)/2,
      y:(leftPoint.y+rightPoints[index].y)/2,
    }));
    const centerFit=fitXByY(centerPoints);
    const axisSlope=clamp(centerFit.slope,-0.45,0.45);
    const axisAngleDeg=Math.atan(axisSlope)*180/Math.PI;

    // Vetor unitario perpendicular ao eixo do dedo.
    const normalLength=Math.hypot(1,axisSlope);
    const nx=1/normalLength;
    const ny=-axisSlope/normalLength;

    const intersectionWithFit=(
      fit:{slope:number;intercept:number},
      center:{x:number;y:number},
    )=>{
      // reta normal: P(t)=center+t*(nx,ny)
      // borda: x=fit.slope*y+fit.intercept
      const denominator=nx-fit.slope*ny;
      if(Math.abs(denominator)<1e-8) return null;
      const t=(fit.slope*center.y+fit.intercept-center.x)/denominator;
      if(!Number.isFinite(t)) return null;
      return {
        x:center.x+t*nx,
        y:center.y+t*ny,
        t,
      };
    };

    return leftPoints.map((leftPoint,index)=>{
      const rightPoint=rightPoints[index];
      const center={
        x:(leftPoint.x+rightPoint.x)/2,
        y:(leftPoint.y+rightPoint.y)/2,
      };
      const leftHit=intersectionWithFit(leftFit,center);
      const rightHit=intersectionWithFit(rightFit,center);

      let measuredLeftX=leftPoint.x;
      let measuredLeftY=leftPoint.y;
      let measuredRightX=rightPoint.x;
      let measuredRightY=rightPoint.y;
      let width=Math.hypot(rightPoint.x-leftPoint.x,rightPoint.y-leftPoint.y);

      if(leftHit&&rightHit&&leftHit.t<rightHit.t){
        measuredLeftX=leftHit.x;
        measuredLeftY=leftHit.y;
        measuredRightX=rightHit.x;
        measuredRightY=rightHit.y;
        width=Math.abs(rightHit.t-leftHit.t);
      }else{
        // Fallback conservador para o comportamento anterior.
        width=(rightPoint.x-leftPoint.x)*Math.cos(Math.atan(axisSlope));
      }

      return {
        left:measuredLeftX,
        right:measuredRightX,
        y:measuredLeftY,
        rightY:measuredRightY,
        width:Math.abs(width),
        horizontalWidth:rightPoint.x-leftPoint.x,
        axisAngleDeg,
        yPercent:leftPoint.yPercent,
        rightYPercent:toScreenYPercent(measuredRightY),
        leftPercent:toScreenXPercent(measuredLeftX),
        rightPercent:toScreenXPercent(measuredRightX),
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

  useEffect(() => {
    if(
      !VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS ||
      !photo ||
      measurementMode!=="finger" ||
      phase!=="finger"
    ){
      if(!photo) setHandLandmarkAnalysis(null);
      return;
    }

    let cancelled=false;
    const centerX=((leftLine+rightLine)/2)/100;
    const cardForOcclusion=quadFromLines(cardLines);
    const xs=cardForOcclusion.map(p=>p.x/100);
    const ys=cardForOcclusion.map(p=>p.y/100);
    const occlusion={
      left:Math.min(...xs),
      right:Math.max(...xs),
      top:Math.min(...ys),
      bottom:Math.max(...ys),
    };
    void analyzeHandLandmarks(photo,centerX,occlusion).then((analysis)=>{
      if(cancelled) return;
      setHandLandmarkAnalysis(analysis);
    });

    return ()=>{ cancelled=true; };
  },[photo,measurementMode,phase,leftLine,rightLine,cardLines]);

  useEffect(() => {
    const anatomy=handLandmarkAnalysis?.measuredFinger;
    if(
      ringGuideManualRef.current ||
      !VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS ||
      !photo ||
      !anatomy ||
      anatomy.confidence<60 ||
      anatomy.ringRegionY===null ||
      autoAnatomyAppliedPhotoRef.current===photo
    ) return;

    const suggestedY=clamp(anatomy.ringRegionY*100,28,84);
    setRingGuideY(suggestedY);
    setMeasureY(suggestedY);
    autoAnatomyAppliedPhotoRef.current=photo;
  },[photo,handLandmarkAnalysis]);

  const cardBaseYPercent = useMemo(() => {
    try{
      const quad=quadFromLines(cardLines);
      return clamp((quad[2].y+quad[3].y)/2,4,92);
    }catch{
      return clamp(cardBottom,4,92);
    }
  },[cardLines,cardBottom]);

  const anatomicalWindow = useMemo(() => {
    // Região plausível do anel: primeiro trecho anatômico logo abaixo
    // da base física do cartão. Testes bons ficaram cerca de +5% a +8%;
    // regiões muito mais baixas estavam puxando a medida para cima.
    const minY=clamp(cardBaseYPercent+3,28,84);
    const maxY=clamp(cardBaseYPercent+12,28,84);
    return {
      minY,
      maxY,
      centerY:(minY+maxY)/2,
      halfSpan:Math.max(4,(maxY-minY)/2),
    };
  },[cardBaseYPercent]);

  const contourAnatomy = useMemo(() => {
    if(!photo || !leftLocked || !rightLocked) return null;

    // Procura APENAS o primeiro plato anatomico logo abaixo da base do cartao.
    // Nao varremos mais toda a parte inferior do dedo, porque um plato mais
    // baixo pode ser estavel, porem largo demais para representar a regiao
    // real onde o anel fica.
    const samples=fingerBandSamplesPx(
      anatomicalWindow.centerY,
      anatomicalWindow.halfSpan,
    )?.filter(sample=>
      sample.yPercent>=anatomicalWindow.minY &&
      sample.yPercent<=anatomicalWindow.maxY
    );

    if(!samples?.length) return null;

    const analysis=analyzeFingerContourAnatomy(
      samples.map(sample=>({
        yPercent:sample.yPercent,
        width:sample.width,
        confidence:sample.confidence,
      })),
      anatomicalWindow.centerY,
    );

    if(
      analysis.ringRegionY!==null &&
      (
        analysis.ringRegionY<anatomicalWindow.minY ||
        analysis.ringRegionY>anatomicalWindow.maxY
      )
    ){
      return {
        ...analysis,
        detected:false,
        ringRegionY:null,
        reason:"platô fora da janela anatômica",
      };
    }

    return analysis;
  },[
    photo,leftLocked,rightLocked,leftLine,rightLine,zoom,panX,panY,
    measurementCardHomography,
    anatomicalWindow.minY,anatomicalWindow.maxY,
    anatomicalWindow.centerY,anatomicalWindow.halfSpan,photoPixelsReady
  ]);

  // Ima anatomico da linha amarela.
  // 1) landmarks confiaveis continuam tendo prioridade;
  // 2) se landmarks nao estiverem disponiveis, usa o plato do contorno;
  // 3) depois de detectado, a linha se reposiciona sozinha e permanece
  //    no mesmo ponto anatomico para esta foto.
  useEffect(() => {
    if(!photo || phase!=="finger" || !leftLocked || !rightLocked) return;
    // Auto-posicionamento serve somente como sugestao inicial.
    // Se o usuario moveu a linha, sua escolha manual prevalece nesta foto.
    if(ringGuideManualRef.current) return;

    const landmark=handLandmarkAnalysis?.measuredFinger;
    const landmarkCandidate=
      VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS &&
      landmark &&
      landmark.confidence>=60 &&
      landmark.ringRegionY!==null
        ? clamp(landmark.ringRegionY*100,28,84)
        : null;

    const landmarkY=
      landmarkCandidate!==null &&
      landmarkCandidate>=anatomicalWindow.minY &&
      landmarkCandidate<=anatomicalWindow.maxY
        ? landmarkCandidate
        : null;

    const contourY=
      contourAnatomy?.detected &&
      contourAnatomy.score>=70 &&
      contourAnatomy.ringRegionY!==null
        ? clamp(contourAnatomy.ringRegionY,28,84)
        : null;

    const targetY=landmarkY ?? contourY;
    if(targetY===null) return;

    // Pequena zona morta evita oscilacao subpixel/visual.
    if(Math.abs(ringGuideY-targetY)<0.35 && Math.abs(measureY-targetY)<0.35) return;

    setRingGuideY(targetY);
    setMeasureY(targetY);
  },[
    photo,phase,leftLocked,rightLocked,
    handLandmarkAnalysis?.measuredFinger?.confidence,
    handLandmarkAnalysis?.measuredFinger?.ringRegionY,
    contourAnatomy?.detected,contourAnatomy?.score,contourAnatomy?.ringRegionY,
    anatomicalWindow.minY,anatomicalWindow.maxY,
    ringGuideY,measureY
  ]);

  const anatomicalRegionFusion = useMemo(() => {
    const valid=[...anatomicalRegionOffsetHistoryY].filter(v=>Number.isFinite(v)&&Math.abs(v)<=25);
    if(!VISION_FEATURE_FLAGS.ENABLE_ANATOMICAL_REGION_FUSION || valid.length<2){
      return {
        active:false,
        count:valid.length,
        medianOffsetY:valid.length ? valid[valid.length-1] : null as number|null,
        rangeOffsetY:valid.length ? 0 : null as number|null,
      };
    }

    const lastTwo=valid.slice(-2).sort((a,b)=>a-b);
    const rangeOffsetY=Math.max(...lastTwo)-Math.min(...lastTwo);
    return {
      active:rangeOffsetY<=3,
      count:lastTwo.length,
      medianOffsetY:(lastTwo[0]+lastTwo[1])/2,
      rangeOffsetY,
    };
  },[anatomicalRegionOffsetHistoryY]);

  const displayPhoto = photoHiRes && photoHiRes.forPhoto===photo ? photoHiRes.url : photo;

  // Pixels da foto em alta para o rastreamento denso das bordas do dedo.
  useEffect(() => {
    if(!photoHiRes || photoHiRes.forPhoto!==photo) return;
    let cancelled=false;
    const image=new Image();
    image.onload=()=>{
      if(cancelled) return;
      const c=document.createElement("canvas");
      c.width=image.naturalWidth; c.height=image.naturalHeight;
      const ctx=c.getContext("2d",{willReadFrequently:true});
      if(!ctx) return;
      ctx.drawImage(image,0,0);
      const d=ctx.getImageData(0,0,c.width,c.height);
      hiPixelsRef.current={forUrl:photoHiRes.url,data:d.data,width:c.width,height:c.height};
      setHiPixelsReady((v)=>v+1);
    };
    image.src=photoHiRes.url;
    return ()=>{ cancelled=true; };
  },[photoHiRes,photo]);

  const widthAnalysis = useMemo(() => {
    const empty = {
      track:null as null|{mm:number;medianMm:number;count:number;lengthMm:number;minMm:number;maxMm:number;startMm:number;angleDeg:number;edgeSpreadDeg:number;p10Mm:number;p90Mm:number;hiRes:boolean;leftPts:string;rightPts:string;imgLeft:{x:number;y:number}[];imgRight:{x:number;y:number}[];lineLeftX:number;lineRightX:number;ringY:number},
      manualMm:null as number|null,
      autoMm:null as number|null,
      manualAngleDeg:0,
      oldMm:null as number|null,
      newMm:null as number|null,
      stats:null as ReturnType<typeof robustWidthStats>|null,
      homographyMm:null as number|null,
      localScaleMm:null as number|null,
      normalizedScaleMm:null as number|null,
      geometryDisagreementMm:0,
      perspectiveScaleFactor:1,
      baseMmPerPx:pixelsPerMm ? 1/pixelsPerMm : null as number|null,
      normalizedMmPerPx:pixelsPerMm ? 1/pixelsPerMm : null as number|null,
      measurementSource:"intersection-85.60" as const,
    };
    if(!pixelsPerMm||!leftLocked||!rightLocked) return empty;

    // Distancia entre as linhas manuais (lupa), no pixel da foto.
    const manualRawMm=(()=>{
      const stage=measureRef.current;
      const source=photoPixelsRef.current;
      if(!stage||!source) return null;
      const rect=stage.getBoundingClientRect();
      if(!rect.width) return null;
      const toImageX=(p:number)=>(((p/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*source.width;
      const px=toImageX(rightLine)-toImageX(leftLine);
      return px>0 ? px/pixelsPerMm : null;
    })();

    const anatomy=handLandmarkAnalysis?.measuredFinger;
    const currentDetectedRegionY=
      VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS &&
      anatomy &&
      anatomy.confidence>=60 &&
      anatomy.ringRegionY!==null
        ? clamp(anatomy.ringRegionY*100,28,84)
        : contourAnatomy?.detected && contourAnatomy.ringRegionY!==null
          ? clamp(contourAnatomy.ringRegionY,28,84)
          : ringGuideY;

    const anatomicalGuideY=
      VISION_FEATURE_FLAGS.ENABLE_ANATOMICAL_REGION_FUSION &&
      anatomicalRegionFusion.active &&
      anatomicalRegionFusion.medianOffsetY!==null
        ? clamp(ringGuideY + anatomicalRegionFusion.medianOffsetY,28,84)
        : currentDetectedRegionY;

    // Depois que a região anatômica do anel foi encontrada, a largura
    // oficial deve ser medida SOMENTE perto dela. Não varremos mais +/-10%,
    // porque a parte inferior do dedo é naturalmente mais larga e podia
    // puxar o resultado para cima.
    // RASTREAMENTO DENSO (3000 cortes) a partir das linhas da lupa.
    const denseTrack=(()=>{
      const stage=measureRef.current;
      const base=photoPixelsRef.current;
      if(!stage||!base) return null;
      const rect=stage.getBoundingClientRect();
      if(!rect.width) return null;
      const hi=hiPixelsRef.current && photoHiRes && hiPixelsRef.current.forUrl===photoHiRes.url && photoHiRes.forPhoto===photo ? hiPixelsRef.current : null;
      const img=hi ?? base;
      const sc=img.width/base.width;
      const toImageX=(p:number)=>(((p/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*base.width;
      const toImageY=(p:number)=>(((p/100*rect.height)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*base.height;
      const toScreenX=(x:number)=>(rect.width/2+(x/base.width*rect.width-rect.width/2)*zoom+panX)/rect.width*100;
      const toScreenY=(y:number)=>(rect.height/2+(y/base.height*rect.height-rect.height/2)*zoom+panY)/rect.height*100;
      const result=trackFinger(img,toImageX(leftLine)*sc,toImageX(rightLine)*sc,toImageY(anatomicalGuideY)*sc,{
        minY:(cardBottom/100*base.height+3)*sc,
        maxY:img.height-6,
        samples:DENSE_TRACK_SAMPLES,
        scale:sc,
        windowPx:RING_ZONE_HALF_MM*pixelsPerMm*sc,
      });
      if(!result) return null;
      const pxPerMm=pixelsPerMm*sc;
      const pts=(path:{x:number;y:number}[])=>path.map(p=>`${toScreenX(p.x/sc).toFixed(2)},${toScreenY(p.y/sc).toFixed(2)}`).join(" ");
      return {
        mm:result.medianPx/pxPerMm,
        medianMm:result.medianPx/pxPerMm,
        count:result.count,
        lengthMm:(result.yEnd-result.yStart)/pxPerMm,
        minMm:result.minPx/pxPerMm,
        maxMm:result.maxPx/pxPerMm,
        startMm:result.widthAtStartPx/pxPerMm,
        angleDeg:result.axisAngleDeg,
        edgeSpreadDeg:Math.abs(result.leftAngleDeg-result.rightAngleDeg),
        p10Mm:result.p10Px/pxPerMm,
        p90Mm:result.p90Px/pxPerMm,
        hiRes:!!hi,
        leftPts:pts(result.leftPath),
        rightPts:pts(result.rightPath),
        imgLeft:result.leftPath.map(p=>({x:p.x/sc,y:p.y/sc})),
        imgRight:result.rightPath.map(p=>({x:p.x/sc,y:p.y/sc})),
        lineLeftX:toImageX(leftLine),
        lineRightX:toImageX(rightLine),
        ringY:toImageY(anatomicalGuideY),
      };
    })();
    const samples=fingerBandSamplesPx(anatomicalGuideY,2.5);
    if(!samples || samples.length<35){
      const raw0=DENSE_TRACK_PRIMARY&&denseTrack?denseTrack.mm:MANUAL_LINES_ONLY?manualRawMm:null;
      return {...empty,track:denseTrack,manualMm:manualRawMm,newMm:raw0===null?null:raw0*sharpScale};
    }
    const sortedAngles=samples.map(sample=>sample.axisAngleDeg).filter(Number.isFinite).sort((a,b)=>a-b);
    const manualAngleDeg=sortedAngles.length?sortedAngles[Math.floor(sortedAngles.length/2)]:0;
    const manualMm=manualRawMm===null?null:manualRawMm*Math.cos(manualAngleDeg*Math.PI/180);

    const baseMmPerPx=1/pixelsPerMm;

    let referenceHomographyMmPerPx:number|null=null;
    if(
      VISION_FEATURE_FLAGS.ENABLE_CARD_SCALE_PERSPECTIVE_NORMALIZATION &&
      measurementCardHomography
    ){
      try{
        const source=photoPixelsRef.current;
        if(source){
          const actualQuad=quadPixels(quadFromLines(cardLines));
          const bottomMid={
            x:(actualQuad[2].x+actualQuad[3].x)/2,
            y:(actualQuad[2].y+actualQuad[3].y)/2,
          };
          const p0=projectPoint(measurementCardHomography,bottomMid);
          const p1=projectPoint(measurementCardHomography,{x:bottomMid.x+1,y:bottomMid.y});
          const v=Math.hypot(p1.x-p0.x,p1.y-p0.y);
          if(Number.isFinite(v)&&v>0) referenceHomographyMmPerPx=v;
        }
      }catch{
        referenceHomographyMmPerPx=null;
      }
    }

    const homographyValues:number[]=[];
    const localValues:number[]=[];
    const normalizedValues:number[]=[];
    const correctionFactors:number[]=[];

    for(const sample of samples){
      const localMm=sample.width*baseMmPerPx;
      if(Number.isFinite(localMm)&&localMm>0&&localMm<45) localValues.push(localMm);

      let directHomographyMm=NaN;
      let correctionFactor=1;

      if(measurementCardHomography){
        try{
          const left=projectPoint(measurementCardHomography,{x:sample.left,y:sample.y});
          const right=projectPoint(measurementCardHomography,{x:sample.right,y:sample.rightY});
          directHomographyMm=Math.hypot(right.x-left.x,right.y-left.y);

          if(
            VISION_FEATURE_FLAGS.ENABLE_CARD_SCALE_PERSPECTIVE_NORMALIZATION &&
            referenceHomographyMmPerPx &&
            referenceHomographyMmPerPx>0
          ){
            const midX=(sample.left+sample.right)/2;
            const midY=(sample.y+sample.rightY)/2;
            const p0=projectPoint(measurementCardHomography,{x:midX,y:midY});
            const p1=projectPoint(measurementCardHomography,{x:midX+1,y:midY});
            const fingerHomographyMmPerPx=Math.hypot(p1.x-p0.x,p1.y-p0.y);
            if(Number.isFinite(fingerHomographyMmPerPx)&&fingerHomographyMmPerPx>0){
              // Homografia corrige apenas a ESCALA do cartão. Não transforma
              // as bordas do dedo. A correção é limitada a +/-3% para evitar
              // extrapolação agressiva fora do plano do cartão.
              correctionFactor=clamp(
                fingerHomographyMmPerPx/referenceHomographyMmPerPx,
                0.97,
                1.03,
              );
            }
          }
        }catch{
          directHomographyMm=NaN;
          correctionFactor=1;
        }
      }

      if(Number.isFinite(directHomographyMm)&&directHomographyMm>0&&directHomographyMm<45){
        homographyValues.push(directHomographyMm);
      }

      const normalizedMm=sample.width*baseMmPerPx*correctionFactor;
      if(Number.isFinite(normalizedMm)&&normalizedMm>0&&normalizedMm<45){
        normalizedValues.push(normalizedMm);
        correctionFactors.push(correctionFactor);
      }
    }

    const localStats=robustWidthStats(localValues);
    const homographyStats=robustWidthStats(homographyValues);
    const normalizedStats=robustWidthStats(normalizedValues);

    const localStable=selectWidestStableRun(localValues).used;
    const homographyStable=selectWidestStableRun(homographyValues).used;
    const normalizedStable=selectWidestStableRun(normalizedValues).used;

    const normalizedRobust=normalizedStats.median;
    const localRobust=localStats.median;
    const homographyRobust=homographyStats.median;

    const sortedFactors=[...correctionFactors].sort((a,b)=>a-b);
    const perspectiveScaleFactor=sortedFactors.length
      ? sortedFactors[Math.floor(sortedFactors.length/2)]
      : 1;

    const directHomographyValue=homographyRobust ?? homographyStable;
    const normalizedValue=normalizedRobust ?? normalizedStable;
    const localValue=localRobust ?? localStable;

    // Fonte oficial e deterministica da medida:
    // escala local derivada SOMENTE das intersecoes A-B da base do cartao,
    // onde A-B representa fisicamente 85,60 mm.
    //
    // Homografia e normalizacao continuam calculadas abaixo exclusivamente
    // para diagnostico/qualidade; nunca podem substituir a medida enviada
    // para a formula do aro.
    const geometryDisagreementMm=
      directHomographyValue!==null && localValue!==null
        ? Math.abs(localValue-directHomographyValue)
        : 0;

    const activeStats=localStats;
    const activeStable=localStable;
    const activeRobust=localRobust;

    const autoMm=VISION_FEATURE_FLAGS.ENABLE_MULTI_SAMPLE_WIDTH && activeRobust!==null ? activeRobust : activeStable;
    return {
      track:denseTrack,
      manualMm,
      autoMm,
      manualAngleDeg,
      oldMm:activeStable,
      newMm:(DENSE_TRACK_PRIMARY && denseTrack ? denseTrack.mm : MANUAL_LINES_ONLY && manualMm!==null ? manualMm : autoMm)===null ? null : (DENSE_TRACK_PRIMARY && denseTrack ? denseTrack.mm : MANUAL_LINES_ONLY && manualMm!==null ? manualMm! : autoMm!)*sharpScale,
      stats:activeStats,
      homographyMm:directHomographyValue,
      localScaleMm:localValue,
      normalizedScaleMm:normalizedValue,
      geometryDisagreementMm,
      perspectiveScaleFactor,
      baseMmPerPx,
      normalizedMmPerPx:baseMmPerPx*perspectiveScaleFactor,
      measurementSource:"intersection-85.60" as const,
    };
  },[
    pixelsPerMm,leftLine,rightLine,ringGuideY,zoom,panX,panY,leftLocked,rightLocked,
    measurementCardHomography,cardLines,
    handLandmarkAnalysis?.measuredFinger?.ringRegionY,
    handLandmarkAnalysis?.measuredFinger?.confidence,
    contourAnatomy?.detected,contourAnatomy?.ringRegionY,
    anatomicalRegionFusion.active,anatomicalRegionFusion.medianOffsetY,
    photoPixelsReady,hiPixelsReady,photoHiRes,photo,cardBottom,sharpScale
  ]);

  const liveWidthMm = widthAnalysis.newMm;
  // Snaps densos validos: quantidade suficiente de cortes e eixo plausivel.
  const denseTrackOk = !!widthAnalysis.track && widthAnalysis.track.count>=DENSE_TRACK_SAMPLES*0.5 && Math.abs(widthAnalysis.track.angleDeg)<=15;

  const preFormulaQuality = useMemo(() => {
    let perspectiveScore=100;
    try{
      const geometryQuad=quadPixels(quadFromLines(cardLines));
      perspectiveScore=assessCardQuadGeometry(geometryQuad,CARD_WIDTH_MM,CARD_HEIGHT_MM).confidence;
    }catch{
      perspectiveScore=72;
    }

    const edgeScore=widthAnalysis.stats?.edgeScore ?? 0;
    const finalConfidence=combineConfidenceScore({
      cardScore:calibrationConfidence,
      perspectiveScore,
      stabilityScore:captureDeviceQuality?.stabilityScore ?? null,
      segmentationScore:handLandmarkAnalysis?.detected
        ? Math.round(
            handLandmarkAnalysis.score *
            (handLandmarkAnalysis.measuredFinger?.partial ? 0.82 : 1) *
            (handLandmarkAnalysis.measuredFinger?.occludedByCard ? 0.88 : 1)
          )
        : contourAnatomy?.detected
          ? contourAnatomy.score
          : null,
      edgeScore,
      depthScore:null,
    });

    return {
      perspectiveScore,
      edgeScore,
      finalConfidence,
      label:confidenceLabel(finalConfidence),
      accepted:finalConfidence>=75,
    };
  },[
    cardLines,
    calibrationConfidence,
    captureDeviceQuality?.stabilityScore,
    widthAnalysis.stats,
    handLandmarkAnalysis?.detected,
    handLandmarkAnalysis?.score,
    contourAnatomy?.detected,
    contourAnatomy?.score,
    photo,
  ]);

  const physicalSnapRegionReady = useMemo(() => {
    if(measurementMode!=="finger" || diameterPhotoTestMode) return false;

    const plausibleMin=cardBottom+3;
    const plausibleMax=cardBottom+30;

    return (
      photoPixelsReady &&
      leftLocked &&
      rightLocked &&
      liveWidthMm!==null &&
      Number.isFinite(liveWidthMm) &&
      liveWidthMm>0 &&
      (denseTrackOk || preFormulaQuality.edgeScore>=90) &&
      calibrationConfidence>=MIN_CARD_CALIBRATION_CONFIDENCE &&
      ringGuideY>=plausibleMin &&
      ringGuideY<=plausibleMax
    );
  },[
    measurementMode,
    diameterPhotoTestMode,
    photoPixelsReady,
    leftLocked,
    rightLocked,
    liveWidthMm,
    preFormulaQuality.edgeScore,
    calibrationConfidence,
    cardBottom,
    ringGuideY,
    denseTrackOk,
  ]);

  const anatomicalRegionReady = useMemo(() => {
    if(measurementMode!=="finger" || diameterPhotoTestMode) return true;

    const landmark=handLandmarkAnalysis?.measuredFinger;
    const landmarkY=
      landmark?.ringRegionY!==null && landmark?.ringRegionY!==undefined
        ? landmark.ringRegionY*100
        : null;

    const landmarkReady=
      VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS &&
      !!landmark &&
      landmark.confidence>=60 &&
      landmarkY!==null &&
      landmarkY>=anatomicalWindow.minY &&
      landmarkY<=anatomicalWindow.maxY;

    const contourReady=
      !!contourAnatomy?.detected &&
      contourAnatomy.score>=70 &&
      contourAnatomy.ringRegionY!==null &&
      contourAnatomy.ringRegionY>=anatomicalWindow.minY &&
      contourAnatomy.ringRegionY<=anatomicalWindow.maxY;

    return landmarkReady || contourReady || physicalSnapRegionReady;
  },[
    measurementMode,
    diameterPhotoTestMode,
    handLandmarkAnalysis?.measuredFinger?.confidence,
    handLandmarkAnalysis?.measuredFinger?.ringRegionY,
    contourAnatomy?.detected,
    contourAnatomy?.score,
    contourAnatomy?.ringRegionY,
    anatomicalWindow.minY,
    anatomicalWindow.maxY,
    physicalSnapRegionReady,
  ]);

  const anatomicalRegionSource =
    measurementMode!=="finger" || diameterPhotoTestMode
      ? "não aplicável"
      : VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS &&
        handLandmarkAnalysis?.measuredFinger &&
        handLandmarkAnalysis.measuredFinger.confidence>=60 &&
        handLandmarkAnalysis.measuredFinger.ringRegionY!==null
        ? "LANDMARKS"
        : contourAnatomy?.detected &&
          contourAnatomy.score>=70 &&
          contourAnatomy.ringRegionY!==null
          ? "CONTORNO"
          : physicalSnapRegionReady
            ? "SNAPS FÍSICOS VALIDADOS"
            : "BLOQUEADO · SEM REGIÃO ANATÔMICA";

  const captureQualityGate = useMemo(() => {
    const reasons:string[]=[];
    const stability=captureDeviceQuality?.stabilityScore ?? null;

    // No fluxo de 1 foto, perspectiva/homografia sao somente diagnostico.
    // Nao podem bloquear uma medida cuja escala oficial vem das intersecoes
    // A-B do cartao (85,60 mm).
    //
    // O gate real fica coerente com a propria captura:
    // - estabilidade minima: 75
    // - bordas/refinamento: 70
    // - calibracao do cartao: 90
    if(stability!==null && stability<75){
      reasons.push(`estabilidade ${stability} < 75`);
    }
    // Pitch e roll continuam no diagnostico e no score da rajada.
    // Nao bloqueiam mais sozinhos o resultado comercial.
    // v17: com os 3000 snaps validos, a qualidade das bordas vem deles.
    if(!denseTrackOk && preFormulaQuality.edgeScore<70){
      reasons.push(`bordas ${preFormulaQuality.edgeScore} < 70`);
    }
    if(calibrationConfidence<MIN_CARD_CALIBRATION_CONFIDENCE){
      reasons.push(`calibração ${calibrationConfidence} < ${MIN_CARD_CALIBRATION_CONFIDENCE}`);
    }
    if(cardEdgeInfo && cardEdgeInfo.source.startsWith("caixa aproximada")){
      reasons.push("borda do cartão não encontrada");
    }
    if(measurementMode==="finger" && !diameterPhotoTestMode && !anatomicalRegionReady){
      reasons.push("região anatômica do anel não detectada");
    }

    return {
      accepted:reasons.length===0,
      reasons,
      perspectiveMin:null,
      stabilityMin:75,
      edgeMin:70,
      confidenceMin:null,
    };
  },[
    preFormulaQuality.edgeScore,
    captureDeviceQuality?.stabilityScore,
    captureDeviceQuality?.devicePitch,
    captureDeviceQuality?.deviceRoll,
    calibrationConfidence,
    measurementMode,
    diameterPhotoTestMode,
    anatomicalRegionReady,
    cardEdgeInfo,
    denseTrackOk,
  ]);

  useEffect(() => {
    if(measurementHistoryTimerRef.current!==null){
      window.clearTimeout(measurementHistoryTimerRef.current);
      measurementHistoryTimerRef.current=null;
    }

    if(
      !photo ||
      !leftLocked ||
      !rightLocked ||
      liveWidthMm===null ||
      !captureQualityGate.accepted ||
      !anatomicalRegionReady
    ) return;

    // Aguarda a medição parar de mudar antes de registrar a captura.
    // Se o usuário ainda ajustar as linhas na mesma foto, substituímos
    // o último valor dessa foto em vez de contar uma nova captura.
    measurementHistoryTimerRef.current=window.setTimeout(()=>{
      const stableMm=Number(liveWidthMm.toFixed(3));
      const detectedRegionY=
        handLandmarkAnalysis?.measuredFinger &&
        handLandmarkAnalysis.measuredFinger.confidence>=60 &&
        handLandmarkAnalysis.measuredFinger.ringRegionY!==null
          ? clamp(handLandmarkAnalysis.measuredFinger.ringRegionY*100,28,84)
          : contourAnatomy?.detected && contourAnatomy.ringRegionY!==null
            ? clamp(contourAnatomy.ringRegionY,28,84)
            : ringGuideY;
      const stableRegionOffsetY=Number((detectedRegionY-ringGuideY).toFixed(3));

      setStableCaptures((current)=>{
        const entry:StableCapture={
          mm:stableMm,
          regionOffsetY:stableRegionOffsetY,
          photoKey:photo,
          ts:Date.now(),
        };

        // Mesma foto: atualiza o ultimo registro em vez de contar nova captura.
        const last=current[current.length-1];
        if(last?.photoKey===photo){
          const next=[...current];
          next[next.length-1]=entry;
          return next;
        }

        recordedMeasurementPhotoRef.current=photo;
        return [...current.slice(-1),entry];
      });

      measurementHistoryTimerRef.current=null;
    },900);

    return ()=>{
      if(measurementHistoryTimerRef.current!==null){
        window.clearTimeout(measurementHistoryTimerRef.current);
        measurementHistoryTimerRef.current=null;
      }
    };
  },[
    photo,leftLocked,rightLocked,liveWidthMm,
    captureQualityGate.accepted,anatomicalRegionReady,
    handLandmarkAnalysis?.measuredFinger?.confidence,
    handLandmarkAnalysis?.measuredFinger?.ringRegionY,
    contourAnatomy?.detected,contourAnatomy?.ringRegionY,ringGuideY
  ]);

  const measurementRepeatability = useMemo(() => {
    if(!measurementHistoryMm.length) return {count:0,mean:null as number|null,sd:null as number|null,range:null as number|null};
    const mean=measurementHistoryMm.reduce((s,v)=>s+v,0)/measurementHistoryMm.length;
    const variance=measurementHistoryMm.length>1
      ? measurementHistoryMm.reduce((s,v)=>s+(v-mean)**2,0)/(measurementHistoryMm.length-1)
      : 0;
    return {
      count:measurementHistoryMm.length,
      mean,
      sd:Math.sqrt(variance),
      range:Math.max(...measurementHistoryMm)-Math.min(...measurementHistoryMm),
    };
  },[measurementHistoryMm]);

  const temporalFusion = useMemo(() => {
    const valid=[...measurementHistoryMm].filter(v=>Number.isFinite(v)&&v>0);

    if(
      !VISION_FEATURE_FLAGS.ENABLE_TEMPORAL_FUSION ||
      measurementMode!=="finger" ||
      valid.length<2
    ){
      return {
        active:false,
        count:valid.length,
        fusedMm:liveWidthMm,
        medianMm:valid.length===1 ? valid[0] : null as number|null,
        rangeMm:valid.length ? 0 : null as number|null,
      };
    }

    const lastTwo=valid.slice(-2);
    const rangeMm=Math.abs(lastTwo[1]-lastTwo[0]);
    const fusedMm=(lastTwo[0]+lastTwo[1])/2;

    return {
      active:rangeMm<=0.35,
      count:lastTwo.length,
      fusedMm:rangeMm<=0.35 ? fusedMm : liveWidthMm,
      medianMm:fusedMm,
      rangeMm,
    };
  },[
    measurementHistoryMm,
    measurementMode,
    liveWidthMm,
  ]);

  const captureFusionReady = true;

  // Cada foto e uma medicao autonoma.
  // Nenhum valor anterior pode participar do resultado atual.
  // Foto reprovada pelo gate nunca chega a formula.
  const widthSentToFormulaMm =
    captureQualityGate.accepted && anatomicalRegionReady
      ? liveWidthMm
      : null;


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
    if (widthSentToFormulaMm === null) return null;
    if (!captureQualityGate.accepted) return null;
    if (measurementMode === "anelimetro" && calibrationConfidence < MIN_CARD_CALIBRATION_CONFIDENCE) return null;
    if (diameterPhotoTestMode) return computeDiameterOnlyTestResult(widthSentToFormulaMm, calibrationConfidence);

    if (measurementMode === "finger") {
      // CURVA PRINCIPAL: curva anterior/original.
      // A curva historica fica apenas como comparacao ate nova validacao.
      const primary = classifyFingerWidthMm(widthSentToFormulaMm);
      return {
        rawWidthMm: widthSentToFormulaMm,
        widthMm: widthSentToFormulaMm,
        measurementCorrectionMm: 0,
        equivalentDiameterMm: widthSentToFormulaMm,
        fingerEquivalentMabMm: null,
        ringSize: primary.exactRingSize,
        calculationMode: "formula" as const,
        appliedRuleOffset: null,
        continuousRing: null,
        nearBoundary: false,
        boundaryDistanceMm: Math.min(
          Math.abs(widthSentToFormulaMm - primary.lowerBoundaryMm),
          Math.abs(primary.upperBoundaryMm - widthSentToFormulaMm),
        ),
      };
    }

    return computeRingResult(widthSentToFormulaMm, calibrationRules, true, calibrationConfidence);
  }, [widthSentToFormulaMm, measurementMode, calibrationRules, calibrationConfidence, diameterPhotoTestMode, captureQualityGate.accepted]);

  const experimentalHighRingResult = useMemo(() => {
    if(measurementMode!=="finger" || widthSentToFormulaMm===null) return null;
    // Comparacao privada: curva historica.
    return classifyFingerWidthMmExperimentalHigh(widthSentToFormulaMm);
  },[measurementMode,widthSentToFormulaMm]);

  const resetPhoto = () => {
    // Nova foto = nova medicao. Nao herda largura, regiao ou historico anterior.
    resetMeasurementSession();
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

  const auditGuideY =
    VISION_FEATURE_FLAGS.ENABLE_ANATOMICAL_REGION_FUSION &&
    anatomicalRegionFusion.active &&
    anatomicalRegionFusion.medianOffsetY!==null
      ? clamp(ringGuideY + anatomicalRegionFusion.medianOffsetY,28,84)
      : VISION_FEATURE_FLAGS.ENABLE_HAND_LANDMARKS &&
        handLandmarkAnalysis?.measuredFinger &&
        handLandmarkAnalysis.measuredFinger.confidence>=60 &&
        handLandmarkAnalysis.measuredFinger.ringRegionY!==null
        ? clamp(handLandmarkAnalysis.measuredFinger.ringRegionY*100,28,84)
        : contourAnatomy?.detected && contourAnatomy.ringRegionY!==null
          ? clamp(contourAnatomy.ringRegionY,28,84)
          : ringGuideY;
  const fingerMagnetSamples = phase==="finger" && leftLocked && rightLocked ? fingerBandSamplesPx(auditGuideY,2.5) : null;

  const robustFingerLineTest = (() => {
    if(!fingerMagnetSamples?.length || fingerMagnetSamples.length<12 || !photoPixelsRef.current || !pixelsPerMm || pixelsPerMm<=0){
      return null;
    }

    type FitPoint={x:number;y:number};
    type RobustFit={
      slope:number;
      intercept:number;
      inliers:FitPoint[];
      residualMad:number;
    };

    const medianNumber=(values:number[])=>{
      if(!values.length) return 0;
      const sorted=[...values].sort((a,b)=>a-b);
      const mid=Math.floor(sorted.length/2);
      return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
    };

    const fitTheilSen=(points:FitPoint[]):RobustFit|null=>{
      if(points.length<6) return null;
      const slopes:number[]=[];
      for(let i=0;i<points.length;i++){
        for(let j=i+1;j<points.length;j++){
          const dy=points[j].y-points[i].y;
          if(Math.abs(dy)<1e-6) continue;
          const slope=(points[j].x-points[i].x)/dy;
          if(Number.isFinite(slope)) slopes.push(slope);
        }
      }
      if(!slopes.length) return null;

      const slope=medianNumber(slopes);
      const intercept=medianNumber(points.map(p=>p.x-slope*p.y));
      const residuals=points.map(p=>Math.abs(p.x-(slope*p.y+intercept)));
      const residualMad=medianNumber(residuals);
      const threshold=Math.max(1.25,residualMad*3.0);
      const inliers=points.filter((p,index)=>residuals[index]<=threshold);

      if(inliers.length<5) return null;

      // Segundo passe: refaz o Theil-Sen apenas com os pontos coerentes.
      const refinedSlopes:number[]=[];
      for(let i=0;i<inliers.length;i++){
        for(let j=i+1;j<inliers.length;j++){
          const dy=inliers[j].y-inliers[i].y;
          if(Math.abs(dy)<1e-6) continue;
          refinedSlopes.push((inliers[j].x-inliers[i].x)/dy);
        }
      }
      const refinedSlope=refinedSlopes.length ? medianNumber(refinedSlopes) : slope;
      const refinedIntercept=medianNumber(inliers.map(p=>p.x-refinedSlope*p.y));
      const refinedResiduals=inliers.map(p=>Math.abs(p.x-(refinedSlope*p.y+refinedIntercept)));

      return {
        slope:refinedSlope,
        intercept:refinedIntercept,
        inliers,
        residualMad:medianNumber(refinedResiduals),
      };
    };

    const leftPoints:FitPoint[]=fingerMagnetSamples.map(sample=>({x:sample.left,y:sample.y}));
    const rightPoints:FitPoint[]=fingerMagnetSamples.map(sample=>({x:sample.right,y:sample.rightY}));
    const leftFit=fitTheilSen(leftPoints);
    const rightFit=fitTheilSen(rightPoints);
    if(!leftFit || !rightFit) return null;

    const source=photoPixelsRef.current;
    const yValues=[
      ...leftFit.inliers.map(p=>p.y),
      ...rightFit.inliers.map(p=>p.y),
    ];
    const yMin=Math.max(0,Math.min(...yValues));
    const yMax=Math.min(source.height,Math.max(...yValues));
    const yCenter=medianNumber(yValues);

    const xLeft=leftFit.slope*yCenter+leftFit.intercept;
    const xRight=rightFit.slope*yCenter+rightFit.intercept;
    if(!Number.isFinite(xLeft)||!Number.isFinite(xRight)||xRight<=xLeft) return null;

    // As duas laterais representam o formato estrutural local do dedo.
    // Usamos a direção média das retas para medir a separação perpendicular.
    const averageSlope=(leftFit.slope+rightFit.slope)/2;
    const widthPx=Math.abs(xRight-xLeft)/Math.sqrt(1+averageSlope*averageSlope);
    const widthMm=widthPx/pixelsPerMm;

    const leftAt=(y:number)=>leftFit.slope*y+leftFit.intercept;
    const rightAt=(y:number)=>rightFit.slope*y+rightFit.intercept;

    return {
      widthPx,
      widthMm,
      leftFit,
      rightFit,
      yMin,
      yMax,
      leftTopPercent:leftAt(yMin)/source.width*100,
      leftBottomPercent:leftAt(yMax)/source.width*100,
      rightTopPercent:rightAt(yMin)/source.width*100,
      rightBottomPercent:rightAt(yMax)/source.width*100,
      yTopPercent:yMin/source.height*100,
      yBottomPercent:yMax/source.height*100,
      inlierPercent:Math.round(
        ((leftFit.inliers.length+rightFit.inliers.length)/(leftPoints.length+rightPoints.length))*100
      ),
      averageResidualPx:(leftFit.residualMad+rightFit.residualMad)/2,
    };
  })();

  const physicalEdgeProfileTest = (() => {
    if(!fingerMagnetSamples?.length || fingerMagnetSamples.length<20 || !photoPixelsRef.current || !pixelsPerMm || pixelsPerMm<=0){
      return null;
    }

    const source=photoPixelsRef.current;
    const gray=(x:number,y:number)=>{
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const o=(iy*source.width+ix)*4;
      return source.data[o]*0.299+source.data[o+1]*0.587+source.data[o+2]*0.114;
    };
    const mean=(values:number[])=>values.length?values.reduce((s,v)=>s+v,0)/values.length:0;
    const median=(values:number[])=>{
      if(!values.length) return 0;
      const a=[...values].sort((x,y)=>x-y);
      const m=Math.floor(a.length/2);
      return a.length%2?a[m]:(a[m-1]+a[m])/2;
    };

    type EdgeValidation={
      valid:boolean;
      correctedX:number;
      offsetPx:number;
      transition:number;
      contrast:number;
      innerStd:number;
      outerStd:number;
    };

    const std=(values:number[])=>{
      if(values.length<2) return 0;
      const m=mean(values);
      return Math.sqrt(values.reduce((s,v)=>s+(v-m)*(v-m),0)/values.length);
    };

    const validateEdge=(side:"left"|"right",x:number,y:number):EdgeValidation=>{
      // Perfil transversal de 19 px centrado na borda candidata.
      // Procuramos o maior salto local e depois verificamos se os dois lados
      // do salto sao regioes relativamente uniformes (pele de um lado,
      // fundo do outro), em vez de uma ruga/sombra estreita.
      const offsets=Array.from({length:19},(_,i)=>i-9);
      const values=offsets.map(off=>gray(x+off,y));
      let bestIndex=1;
      let bestTransition=-Infinity;

      for(let i=1;i<values.length-1;i++){
        const leftMean=mean(values.slice(Math.max(0,i-2),i+1));
        const rightMean=mean(values.slice(i+1,Math.min(values.length,i+4)));
        const jump=Math.abs(rightMean-leftMean);
        if(jump>bestTransition){
          bestTransition=jump;
          bestIndex=i;
        }
      }

      const bestOffset=offsets[bestIndex];
      const correctedX=x+bestOffset;

      // Para a lateral esquerda, "dentro" fica à direita da borda.
      // Para a direita, "dentro" fica à esquerda.
      const innerValues:number[]=[];
      const outerValues:number[]=[];
      for(let d=3;d<=7;d++){
        innerValues.push(gray(correctedX+(side==="left"?d:-d),y));
        outerValues.push(gray(correctedX+(side==="left"?-d:d),y));
      }

      const innerMean=mean(innerValues);
      const outerMean=mean(outerValues);
      const contrast=Math.abs(innerMean-outerMean);
      const innerStd=std(innerValues);
      const outerStd=std(outerValues);

      // A borda fisica precisa:
      // 1) ter transicao perceptivel;
      // 2) estar proxima da borda rastreada;
      // 3) separar duas regioes mais uniformes do que o proprio salto.
      const nearTrackedEdge=Math.abs(bestOffset)<=4;
      const stableSides=innerStd<=Math.max(12,bestTransition*0.75) &&
        outerStd<=Math.max(12,bestTransition*0.75);
      const valid=
        bestTransition>=8 &&
        contrast>=6 &&
        nearTrackedEdge &&
        stableSides;

      return {
        valid,
        correctedX,
        offsetPx:bestOffset,
        transition:bestTransition,
        contrast,
        innerStd,
        outerStd,
      };
    };

    const validated=fingerMagnetSamples.map(sample=>{
      const left=validateEdge("left",sample.left,sample.y);
      const right=validateEdge("right",sample.right,sample.rightY);
      return {sample,left,right,valid:left.valid&&right.valid};
    });

    const validPairs=validated.filter(item=>item.valid);
    if(validPairs.length<8){
      return {
        validPairPercent:Math.round(validPairs.length/validated.length*100),
        widthPx:null as number|null,
        widthMm:null as number|null,
        medianLeftOffsetPx:median(validated.map(v=>v.left.offsetPx)),
        medianRightOffsetPx:median(validated.map(v=>v.right.offsetPx)),
        medianTransition:median(validated.flatMap(v=>[v.left.transition,v.right.transition])),
        status:"insuficiente" as const,
      };
    }

    const correctedWidths=validPairs
      .map(({left,right})=>right.correctedX-left.correctedX)
      .filter(v=>Number.isFinite(v)&&v>0);
    const widthPx=median(correctedWidths);
    const widthMm=widthPx/pixelsPerMm;
    const validPairPercent=Math.round(validPairs.length/validated.length*100);

    return {
      validPairPercent,
      widthPx,
      widthMm,
      medianLeftOffsetPx:median(validated.map(v=>v.left.offsetPx)),
      medianRightOffsetPx:median(validated.map(v=>v.right.offsetPx)),
      medianTransition:median(validated.flatMap(v=>[v.left.transition,v.right.transition])),
      status:validPairPercent>=80 ? "forte" as const : "parcial" as const,
    };
  })();

  const contourConstantTest = (() => {
    if(
      measurementMode!=="finger" ||
      phase!=="finger" ||
      !leftLocked ||
      !rightLocked ||
      !photoPixelsRef.current ||
      !pixelsPerMm ||
      pixelsPerMm<=0
    ){
      return null;
    }

    // A linha amarela e as laterais manuais apenas definem a REGIAO inicial.
    // A medida experimental varre uma faixa maior e cada ponto procura de novo
    // a fronteira fisica pele <-> fundo de forma independente.
    const samples=fingerBandSamplesPx(ringGuideY,8);
    if(!samples || samples.length<20) return null;

    const source=photoPixelsRef.current;
    const gray=(x:number,y:number)=>{
      const ix=Math.max(0,Math.min(source.width-1,Math.round(x)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(y)));
      const o=(iy*source.width+ix)*4;
      return source.data[o]*0.299+source.data[o+1]*0.587+source.data[o+2]*0.114;
    };
    const mean=(values:number[])=>values.length
      ? values.reduce((sum,value)=>sum+value,0)/values.length
      : 0;
    const median=(values:number[])=>{
      if(!values.length) return 0;
      const ordered=[...values].sort((a,b)=>a-b);
      const mid=Math.floor(ordered.length/2);
      return ordered.length%2
        ? ordered[mid]
        : (ordered[mid-1]+ordered[mid])/2;
    };
    const std=(values:number[])=>{
      if(values.length<2) return 0;
      const m=mean(values);
      return Math.sqrt(values.reduce((sum,value)=>sum+(value-m)**2,0)/values.length);
    };

    type SnapResult={
      valid:boolean;
      x:number;
      offsetPx:number;
      transition:number;
      contrast:number;
    };

    const snapPhysicalEdge=(side:"left"|"right",trackedX:number,y:number):SnapResult=>{
      // Busca deliberadamente mais larga que o teste anterior. A linha manual
      // e o rastreador sao somente sementes; o ponto final precisa provar
      // que existe pele de um lado e fundo do outro.
      const offsets=Array.from({length:25},(_,index)=>index-12);
      let best:{
        offset:number;
        score:number;
        transition:number;
        contrast:number;
        innerStd:number;
        outerStd:number;
      }|null=null;

      for(const offset of offsets){
        const x=trackedX+offset;
        const leftLocal=[-3,-2,-1].map(d=>gray(x+d,y));
        const rightLocal=[1,2,3].map(d=>gray(x+d,y));
        const transition=Math.abs(mean(rightLocal)-mean(leftLocal));

        const inner:number[]=[];
        const outer:number[]=[];
        for(let d=4;d<=9;d++){
          inner.push(gray(x+(side==="left"?d:-d),y));
          outer.push(gray(x+(side==="left"?-d:d),y));
        }

        const innerMean=mean(inner);
        const outerMean=mean(outer);
        const contrast=Math.abs(innerMean-outerMean);
        const innerStd=std(inner);
        const outerStd=std(outer);

        // Premia transicao forte e duas regioes consistentes; penaliza sair
        // demais do contorno rastreado para evitar saltos para outra textura.
        const uniformityPenalty=(innerStd+outerStd)*0.28;
        const distancePenalty=Math.abs(offset)*0.55;
        const score=transition*0.62+contrast*0.72-uniformityPenalty-distancePenalty;

        if(!best || score>best.score){
          best={offset,score,transition,contrast,innerStd,outerStd};
        }
      }

      if(!best){
        return {valid:false,x:trackedX,offsetPx:0,transition:0,contrast:0};
      }

      const valid=
        Math.abs(best.offset)<=8 &&
        best.transition>=8 &&
        best.contrast>=7 &&
        best.innerStd<=Math.max(14,best.transition*0.85) &&
        best.outerStd<=Math.max(14,best.transition*0.85);

      return {
        valid,
        x:trackedX+best.offset,
        offsetPx:best.offset,
        transition:best.transition,
        contrast:best.contrast,
      };
    };

    const ordered=[...samples].sort((a,b)=>a.yPercent-b.yPercent);
    const snapped=ordered.map((sample,index)=>{
      const left=snapPhysicalEdge("left",sample.left,sample.y);
      const right=snapPhysicalEdge("right",sample.right,sample.rightY);
      const valid=left.valid&&right.valid&&right.x>left.x;
      const widthPx=valid
        ? Math.hypot(right.x-left.x,sample.rightY-sample.y)
        : null;
      const widthMm=widthPx!==null ? widthPx/pixelsPerMm : null;

      // Converte o deslocamento em pixels da imagem para percentual da tela.
      // O fator zoom mantem o ponto visual grudado no mesmo pixel corrigido.
      const dxToScreenPercent=(dx:number)=>dx/source.width*100*zoom;

      return {
        index,
        valid,
        yPercent:sample.yPercent,
        rightYPercent:sample.rightYPercent,
        leftPercent:sample.leftPercent+dxToScreenPercent(left.x-sample.left),
        rightPercent:sample.rightPercent+dxToScreenPercent(right.x-sample.right),
        widthPx,
        widthMm,
        leftOffsetPx:left.offsetPx,
        rightOffsetPx:right.offsetPx,
        transition:(left.transition+right.transition)/2,
      };
    });

    // Procura uma CONSTANTE: 7 cortes consecutivos, todos fisicamente
    // validados, com pouca variacao. Entre os platoes validos vence o mais
    // largo, porque o anel precisa passar pela maior secao consistente.
    const windowSize=7;
    let best:{
      start:number;
      end:number;
      values:number[];
      medianMm:number;
      spreadPercent:number;
    }|null=null;

    for(let start=0;start<=snapped.length-windowSize;start++){
      const window=snapped.slice(start,start+windowSize);
      if(window.some(item=>!item.valid || item.widthMm===null)) continue;
      const values=window.map(item=>item.widthMm as number);
      const med=median(values);
      const min=Math.min(...values);
      const max=Math.max(...values);
      const spreadPercent=med>0 ? (max-min)/med*100 : 999;

      if(spreadPercent>1.35) continue;

      if(
        !best ||
        med>best.medianMm ||
        (Math.abs(med-best.medianMm)<0.03 && spreadPercent<best.spreadPercent)
      ){
        best={
          start,
          end:start+windowSize-1,
          values,
          medianMm:med,
          spreadPercent,
        };
      }
    }

    // Fallback apenas diagnostico: se nao houver constante <=1,35%,
    // encontra a janela valida de menor variacao para mostrar o problema.
    if(!best){
      for(let start=0;start<=snapped.length-windowSize;start++){
        const window=snapped.slice(start,start+windowSize);
        if(window.some(item=>!item.valid || item.widthMm===null)) continue;
        const values=window.map(item=>item.widthMm as number);
        const med=median(values);
        const min=Math.min(...values);
        const max=Math.max(...values);
        const spreadPercent=med>0 ? (max-min)/med*100 : 999;
        if(!best || spreadPercent<best.spreadPercent){
          best={start,end:start+windowSize-1,values,medianMm:med,spreadPercent};
        }
      }
    }

    const validWidthsMm=snapped
      .filter(item=>item.valid && item.widthMm!==null)
      .map(item=>item.widthMm as number);

    const validCount=validWidthsMm.length;
    const supportPercent=Math.round(validCount/snapped.length*100);
    const plateauIndexes=new Set<number>();
    if(best){
      for(let i=best.start;i<=best.end;i++) plateauIndexes.add(i);
    }

    const overallMeanMm=validWidthsMm.length
      ? validWidthsMm.reduce((sum,value)=>sum+value,0)/validWidthsMm.length
      : null;
    const overallMedianMm=validWidthsMm.length
      ? median(validWidthsMm)
      : null;

    const plateauClassification=best
      ? classifyFingerWidthMmExperimentalHigh(best.medianMm)
      : null;
    const meanClassification=overallMeanMm!==null
      ? classifyFingerWidthMmExperimentalHigh(overallMeanMm)
      : null;
    const medianClassification=overallMedianMm!==null
      ? classifyFingerWidthMmExperimentalHigh(overallMedianMm)
      : null;

    return {
      points:snapped.map((item,index)=>({
        ...item,
        inPlateau:plateauIndexes.has(index),
      })),
      totalCount:snapped.length,
      validCount,
      supportPercent,
      plateauStart:best?.start ?? -1,
      plateauEnd:best?.end ?? -1,
      plateauValuesMm:best?.values ?? [],
      widthMm:best?.medianMm ?? null,
      spreadPercent:best?.spreadPercent ?? null,
      historicalRing:plateauClassification?.exactRingSize ?? null,
      overallMeanMm,
      overallMedianMm,
      overallMeanHistoricalRing:meanClassification?.exactRingSize ?? null,
      overallMedianHistoricalRing:medianClassification?.exactRingSize ?? null,
      stable:!!best && best.spreadPercent<=1.35 && supportPercent>=80,
    };
  })();

  // Desempates experimentais desativados.
  // O aro comercial deve refletir somente a curva principal enquanto
  // comparamos a curva historica em diagnostico.
  // v16: validacao comercial (o que o cliente ve). Subconjunto objetivo das
  // regras: cartao encontrado, dedo reto e medida coerente com a borda fisica.
  const commercialValidation = (() => {
    const reasons:{code:string;text:string}[]=[];
    if(cardEdgeInfo && cardEdgeInfo.source.startsWith("caixa aproximada")){
      reasons.push({code:"card",text:"Não encontrei a borda do cartão. Deixe o cartão inteiro na foto, sem reflexo."});
    }
    const track=widthAnalysis.track;
    if(track){
      // v20: angulo e qualidade vem dos proprios 3000 snaps. A medida ja e
      // perpendicular ao eixo do dedo, entao a inclinacao e corrigida na conta.
      if(Math.abs(track.angleDeg)>COMMERCIAL_MAX_FINGER_ANGLE){
        reasons.push({code:"angle",text:`O dedo está muito inclinado (${Math.abs(track.angleDeg).toFixed(1)}°). Deixe o dedo mais alinhado com a tela.`});
      }
      if(track.edgeSpreadDeg>COMMERCIAL_MAX_EDGE_SPREAD_DEG){
        reasons.push({code:"edges",text:"Uma das linhas pegou uma curva (dobra entre os dedos ou sombra). Confira as linhas verdes na lupa, bem na altura do anel."});
      }
      if(track.p90Mm-track.p10Mm>COMMERCIAL_MAX_WIDTH_SPREAD_MM){
        reasons.push({code:"spread",text:"As bordas do dedo ficaram pouco nítidas nessa altura. Melhore a luz ou ajuste as linhas na lupa."});
      }
    }else{
      const angle=fingerMagnetSamples?.[0]?.axisAngleDeg ?? null;
      if(angle!==null && Math.abs(angle)>5){
        reasons.push({code:"angle",text:`O dedo está inclinado (${Math.abs(angle).toFixed(1)}°). Deixe o dedo reto, alinhado com a tela.`});
      }
    }
    return {accepted:reasons.length===0,reasons};
  })();

  // Divisa entre dois aros: mostra os dois ao cliente em vez de "chutar".
  const ringBoundary = (() => {
    if(widthSentToFormulaMm===null) return null;
    const c=classifyFingerWidthMm(widthSentToFormulaMm);
    const dLow=widthSentToFormulaMm-c.lowerBoundaryMm;
    const dUp=c.upperBoundaryMm-widthSentToFormulaMm;
    if(dUp<=RING_BOUNDARY_MARGIN_MM) return {low:c.exactRingSize,high:c.exactRingSize+1};
    if(dLow<=RING_BOUNDARY_MARGIN_MM) return {low:c.exactRingSize-1,high:c.exactRingSize};
    return null;
  })();

  const commercialRingResolution = {
    ringSize:commercialValidation.accepted ? (result?.ringSize ?? null) : null,
    adjusted:false,
    reason:"desempate desativado · curva principal direta",
  };
  const commercialRingSize=commercialRingResolution.ringSize;

  const methodComparisonTest = (() => {
    if(
      measurementMode!=="finger" ||
      widthSentToFormulaMm===null ||
      !pixelsPerMm ||
      pixelsPerMm<=0
    ){
      return null;
    }

    const classifyBoth=(mm:number)=>{
      const official=classifyFingerWidthMm(mm);
      const historical=classifyFingerWidthMmExperimentalHigh(mm);
      return {
        officialRing:official.exactRingSize,
        historicalRing:historical.exactRingSize,
      };
    };

    // Método A: exatamente a medida que hoje vai para a fórmula.
    const currentMm=widthSentToFormulaMm;
    const currentPx=currentMm*pixelsPerMm;
    const currentClass=classifyBoth(currentMm);

    // Método B: reproduz o antigo refino de 2,5 px para dentro em cada lado.
    // Total removido da largura = 5 px, usando a MESMA foto e a MESMA escala.
    const insetPx=Math.max(0,currentPx-5);
    const insetMm=insetPx/pixelsPerMm;
    const insetClass=classifyBoth(insetMm);

    // Método C: perfil pele <-> fundo validado.
    const physicalPx=physicalEdgeProfileTest?.widthPx ?? null;
    const physicalMm=physicalEdgeProfileTest?.widthMm ?? null;
    const physicalClass=
      physicalMm!==null && Number.isFinite(physicalMm) && physicalMm>0
        ? classifyBoth(physicalMm)
        : null;

    return {
      current:{
        px:currentPx,
        mm:currentMm,
        ...currentClass,
      },
      inset:{
        px:insetPx,
        mm:insetMm,
        ...insetClass,
      },
      physical:physicalPx!==null && physicalMm!==null && physicalClass
        ? {
            px:physicalPx,
            mm:physicalMm,
            ...physicalClass,
            support:physicalEdgeProfileTest?.validPairPercent ?? 0,
          }
        : null,
    };
  })();

  const geometricStabilityTest = (() => {
    if(
      measurementMode!=="finger" ||
      !pixelsPerMm ||
      pixelsPerMm<=0 ||
      !measurementCardLengthPx ||
      measurementCardLengthPx<=0 ||
      !fingerMagnetSamples?.length
    ){
      return null;
    }

    const currentFingerPx=
      widthSentToFormulaMm!==null
        ? widthSentToFormulaMm*pixelsPerMm
        : null;

    const physicalFingerPx=physicalEdgeProfileTest?.widthPx ?? null;

    const currentRatio=
      currentFingerPx!==null
        ? currentFingerPx/measurementCardLengthPx
        : null;

    const physicalRatio=
      physicalFingerPx!==null
        ? physicalFingerPx/measurementCardLengthPx
        : null;

    return {
      cardPx:measurementCardLengthPx,
      mmPerPx:1/pixelsPerMm,
      currentFingerPx,
      physicalFingerPx,
      currentRatio,
      physicalRatio,
      anatomyY:auditGuideY,
      pitch:captureDeviceQuality?.devicePitch ?? null,
      roll:captureDeviceQuality?.deviceRoll ?? null,
      motion:captureDeviceQuality?.deviceMotion ?? null,
      stability:captureDeviceQuality?.stabilityScore ?? null,
      fingerAngleDeg:fingerMagnetSamples[0]?.axisAngleDeg ?? null,
      perspectiveScore:preFormulaQuality.perspectiveScore,
    };
  })();

  const experimentalOperationalTest = (() => {
    if(
      measurementMode!=="finger" ||
      widthSentToFormulaMm===null ||
      !geometricStabilityTest
    ){
      return null;
    }

    const reasons:string[]=[];
    const physicalMm=physicalEdgeProfileTest?.widthMm ?? null;
    const physicalSupport=physicalEdgeProfileTest?.validPairPercent ?? 0;
    const physicalStrong=physicalEdgeProfileTest?.status==="forte";
    const physicalDeltaMm=
      physicalMm!==null
        ? Math.abs(physicalMm-widthSentToFormulaMm)
        : null;

    // Gate experimental deliberadamente mais rigoroso que o comercial.
    // Todos os critérios abaixo descrevem qualidade/geometria da captura;
    // nenhum depende do tamanho real do dedo.
    if(!physicalStrong) reasons.push("borda física não forte");
    if(physicalSupport<90) reasons.push(`suporte da borda ${physicalSupport}% < 90%`);
    if(physicalDeltaMm===null || physicalDeltaMm>0.25){
      reasons.push(`divergência borda física ${physicalDeltaMm===null?"n/d":physicalDeltaMm.toFixed(2)+" mm"} > 0,25 mm`);
    }
    if(geometricStabilityTest.stability!==null && geometricStabilityTest.stability<90){
      reasons.push(`stability ${geometricStabilityTest.stability} < 90`);
    }
    if(geometricStabilityTest.perspectiveScore<93){
      reasons.push(`perspective ${geometricStabilityTest.perspectiveScore} < 93`);
    }
    if(geometricStabilityTest.pitch!==null && Math.abs(geometricStabilityTest.pitch)>6){
      reasons.push(`pitch ${geometricStabilityTest.pitch.toFixed(1)}° > 6°`);
    }
    if(geometricStabilityTest.roll!==null && Math.abs(geometricStabilityTest.roll)>3){
      reasons.push(`roll ${geometricStabilityTest.roll.toFixed(1)}° > 3°`);
    }
    if(geometricStabilityTest.fingerAngleDeg!==null && Math.abs(geometricStabilityTest.fingerAngleDeg)>5){
      reasons.push(`ângulo do dedo ${geometricStabilityTest.fingerAngleDeg.toFixed(1)}° > 5°`);
    }

    const historical=classifyFingerWidthMmExperimentalHigh(widthSentToFormulaMm);
    const official=classifyFingerWidthMm(widthSentToFormulaMm);

    // A curva histórica é experimental apenas na faixa alta. Abaixo de 29,
    // preservamos o classificador oficial para não contaminar a faixa baixa.
    const useHistoricalHigh=
      official.exactRingSize>=29 ||
      historical.exactRingSize>=29;

    const proposedRing=
      useHistoricalHigh
        ? historical.exactRingSize
        : official.exactRingSize;

    return {
      accepted:reasons.length===0,
      reasons,
      proposedRing,
      officialRing:official.exactRingSize,
      historicalRing:historical.exactRingSize,
      useHistoricalHigh,
      physicalMm,
      physicalSupport,
      physicalDeltaMm,
    };
  })();

  const measurementAudit = (() => {
    if(!fingerMagnetSamples?.length || liveWidthMm===null) return null;

    const rawWidthsPx=fingerMagnetSamples.map((sample)=>sample.width).filter(Number.isFinite);
    if(!rawWidthsPx.length) return null;

    const widestRun=selectWidestStableRun(rawWidthsPx);
    if(widestRun.used===null) return null;

    const physicalWidthsMm=fingerMagnetSamples.map((sample)=>
      // Auditoria segue a mesma fonte oficial da formula:
      // escala das intersecoes A-B do cartao, sem correcao por homografia.
      pixelsPerMm>0 ? sample.width/pixelsPerMm : NaN
    ).filter(Number.isFinite);

    const widestPhysical=selectWidestStableRun(physicalWidthsMm);
    const activeRobust=widthAnalysis.stats;
    const spreadPx=Math.max(...rawWidthsPx)-Math.min(...rawWidthsPx);

    const perspectiveScore=preFormulaQuality.perspectiveScore;
    const finalConfidence=preFormulaQuality.finalConfidence;

    return {
      rawWidthsPx,
      usedWidthPx:widestRun.used,
      cardScaleMmPerPx:pixelsPerMm>0?1/pixelsPerMm:null,
      rawCardMm:widestPhysical.used,
      normalizedMm:liveWidthMm,
      oldMm:widthAnalysis.oldMm,
      newMm:widthAnalysis.newMm,
      correctionPercent:0,
      spreadPx,
      spreadPercent:widestRun.used>0?spreadPx/widestRun.used*100:0,
      selectedUpperWidthsPx:widestRun.selected,
      selectedRunStart:widestRun.startIndex+1,
      fingerAxisAngleDeg:fingerMagnetSamples[0]?.axisAngleDeg ?? 0,
      robustMedianMm:activeRobust?.median ?? null,
      robustTrimmedMeanMm:activeRobust?.trimmedMean ?? null,
      robustFilteredCount:activeRobust?.filtered.length ?? 0,
      robustOutlierCount:activeRobust?.outlierCount ?? 0,
      edgeScore:activeRobust?.edgeScore ?? 0,
      perspectiveScore,
      finalConfidence,
      finalConfidenceLabel:confidenceLabel(finalConfidence),
    };
  })();

  const fourMagnetWidthsMm = fingerMagnetSamples?.map((sample)=>
    pixelsPerMm>0 ? Number((sample.width/pixelsPerMm).toFixed(2)) : NaN
  ).filter(Number.isFinite) ?? [];

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
    ? (guidedStep === 1 ? "1. Fotografe cartão e dedo" :
       guidedStep === 2 ? "2. Ajuste a região mais grossa" :
       "3. Confira o resultado")
    : guidedStep === 1 ? "1. Calibre o cartão em uma base plana" :
      guidedStep === 2 ? "2. Fotografe o cartão sobre o dedo" :
      guidedStep === 3 ? "3. Ajuste as duas linhas na parte mais grossa" :
      "4. Confira os dois números";

  const guideText = singlePhotoTestMode
    ? (guidedStep === 1
        ? (phase==="card" ? "Confira as laterais do cartão: dê zoom e encoste cada linha verde na borda do cartão usando a lupa. Depois toque em Cartão ajustado." : "Fotografe o cartão sobre o dedo. Depois você confere as laterais do cartão e as bordas do dedo.")
        : guidedStep === 2
          ? "Dê zoom e encoste as linhas verdes nas bordas do dedo usando a lupa. Os 3000 snaps medem a faixa de 2 mm em volta da linha amarela."
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

  const onNativePhoto = async (file:File|undefined) => {
    if(!file) return;
    setCaptureProgress({pct:5,label:"Carregando a foto"});
    const canvas=await decodePhoto(file);
    if(!canvas){ setCaptureProgress(null); camera.setError("Não consegui abrir a foto. Tente novamente."); return; }
    externalPhotoRef.current=wholePhotoAsFrame(canvas);
    await capture();
  };

  const saveTestForReview = async () => {
    const track=widthAnalysis.track;
    if(!track || !pixelsPerMm){ setTestBusy("Posicione as linhas primeiro (os snaps precisam aparecer)."); return; }
    setTestBusy("Salvando…");
    try{
      const W=900, H=1200;
      const toImg=(l:Line)=>({a:{x:l.a.x/100*W,y:l.a.y/100*H},b:{x:l.b.x/100*W,y:l.b.y/100*H}});
      const usingHi=!!(photoHiRes && photoHiRes.forPhoto===photo);
      const crops=await makeCrops({
        photoUrl:usingHi?photoHiRes!.url:photo,
        photoWidth:usingHi?photoHiRes!.width:W,
        baseWidth:W, baseHeight:H,
        fingerLeftX:track.lineLeftX, fingerRightX:track.lineRightX, ringY:track.ringY,
        trackLeft:track.imgLeft, trackRight:track.imgRight,
        cardLeft:toImg(cardLines.left), cardRight:toImg(cardLines.right), cardBottomY:cardBottom/100*H,
      });
      const f2=(v:number|null|undefined,d=2)=>v===null||v===undefined||!Number.isFinite(v)?"n/d":v.toFixed(d);
      const g=geometricStabilityTest;
      const real=Number(realRingInput.replace(",","."));
      const lines=[
        `RESULTADO: aro ${ringBoundary?`${ringBoundary.low}/${ringBoundary.high} (divisa)`:(commercialRingSize ?? "n/d")}${commercialValidation.accepted?"":" · RECUSADA: "+commercialValidation.reasons.map(r=>r.code).join(",")} · medida usada ${f2(widthSentToFormulaMm)} mm · gate ${captureQualityGate.accepted?"ACEITA":"BLOQUEIA: "+captureQualityGate.reasons.join(" · ")}`,
        `${sharpPhoto?`Correção foto nítida ×${SHARP_PHOTO_SCALE} (snaps brutos ×1) · `:""}Snaps: média ap. ${f2(track.mm)} · mediana ${f2(track.medianMm)} · mín ${f2(track.minMm)} máx ${f2(track.maxMm)}`,
        `  ${track.count} cortes em ${f2(track.lengthMm,1)} mm · na linha amarela ${f2(track.startMm)} · eixo ${f2(track.angleDeg,1)}° · bordas diferem ${f2(track.edgeSpreadDeg,1)}° · p10–p90 ${f2(track.p90Mm-track.p10Mm)} mm`,
        `Lupa ${f2(widthAnalysis.manualMm)} · automático ${f2(widthAnalysis.autoMm)} · borda física ${f2(physicalEdgeProfileTest?.widthMm)} mm`,
        `Cartão ${f2(g?.cardPx,1)} px · ${cardEdgeInfo?.source ?? "n/d"}`,
        `Dedo ${f2(g?.currentFingerPx,1)} px · razão ${f2(g?.currentRatio,4)} · altura Y ${f2(g?.anatomyY,1)}% (${contourAnatomy?.detected?"contorno":"padrão"})`,
        `Origem ${photoSourceInfo} · câmera ${photoHiRes?`${photoHiRes.videoW}×${photoHiRes.videoH}`:"900"} · pixel ${photoHiRes?f2(1/(pixelsPerMm*photoHiRes.width/900),3):f2(1/pixelsPerMm,3)} mm`,
        `Dedo ${f2(g?.fingerAngleDeg,1)}° · celular pitch ${f2(g?.pitch,1)}° roll ${f2(g?.roll,1)}° · estab ${g?.stability ?? "n/d"}`,
        `Escala ${f2(pixelsPerMm,3)} px/mm · zoom ${zoom.toFixed(1)}×`,
      ];
      const test:SavedTest={
        id:`${Date.now()}`,
        createdAt:new Date().toLocaleString("pt-BR",{hour12:false}),
        realRing:Number.isFinite(real)&&real>0?real:null,
        lines,
        ...crops,
      };
      let next=[...savedTests,test];
      while(next.length && !storeTests(next)) next=next.slice(1);
      setSavedTests(next);
      setTestBusy(`Teste ${next.length} salvo.`);
    }catch(err){
      setTestBusy("Não consegui salvar este teste: "+String(err));
    }
  };

  const generateTestReport = async () => {
    if(!savedTests.length) return;
    setTestBusy("Montando relatório…");
    const blob=await buildReport(savedTests,`Medidor de anel · medidordedov21 · ${savedTests.length} testes`);
    if(!blob){ setTestBusy("Falha ao gerar o relatório."); return; }
    const file=new File([blob],`relatorio-medidor-${Date.now()}.jpg`,{type:"image/jpeg"});
    const nav=navigator as Navigator & {canShare?:(d:unknown)=>boolean};
    if(nav.share && nav.canShare?.({files:[file]})){
      try{ await nav.share({files:[file],title:"Relatório do medidor"}); setTestBusy("Relatório compartilhado."); return; }catch{ /* cai no download */ }
    }
    if(reportUrl) URL.revokeObjectURL(reportUrl);
    setReportUrl(URL.createObjectURL(blob));
    setTestBusy("Relatório pronto: toque em Baixar relatório.");
  };

  return (
    <main className="app">
      {captureProgress && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position:"fixed",inset:0,zIndex:2147483000,display:"grid",placeItems:"center",
            background:"#14100b",color:"#f4e7c8",padding:24,
          }}
        >
          <style>{`
            @keyframes capbar{0%,100%{transform:scaleY(.35);opacity:.45}50%{transform:scaleY(1);opacity:1}}
            @keyframes capshine{0%{transform:translateX(-100%)}100%{transform:translateX(220%)}}
          `}</style>
          <div style={{display:"grid",gap:22,justifyItems:"center",width:"min(320px,86vw)",textAlign:"center"}}>
            <div style={{width:64,height:64,borderRadius:"50%",border:"3px solid #52e0a3",display:"grid",placeItems:"center",color:"#52e0a3",fontSize:34,fontWeight:900}}>✓</div>
            <strong style={{fontSize:22,letterSpacing:".01em"}}>Foto tirada!</strong>
            <div aria-hidden="true" style={{display:"flex",gap:7,alignItems:"center",height:44}}>
              {[0,1,2,3,4].map(i=>(
                <span key={i} style={{width:8,height:44,borderRadius:4,background:"#c9a967",animation:`capbar 1s ease-in-out ${i*0.12}s infinite`,transformOrigin:"center"}} />
              ))}
            </div>
            <div style={{width:"100%",height:10,borderRadius:999,background:"#2c2318",overflow:"hidden",position:"relative"}}>
              <div style={{width:`${captureProgress.pct}%`,height:"100%",borderRadius:999,background:"linear-gradient(90deg,#c9a967,#f0cd78)",transition:"width .25s ease",position:"relative",overflow:"hidden"}}>
                <span style={{position:"absolute",inset:0,width:"45%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)",animation:"capshine 1.1s linear infinite"}} />
              </div>
            </div>
            <span style={{fontSize:14,opacity:.85}}>{captureProgress.label} {captureProgress.pct}%</span>
            <small style={{opacity:.7}}>{"Pode tirar a mão. Estamos medindo."}</small>
          </div>
        </div>
      )}
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
          <FrozenIntroScreen
            error={camera.error}
            onMeasureFinger={() => {
              resetMeasurementSession();
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
                  resetMeasurementSession();
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

      {stage === "camera" && NATIVE_CAMERA_ONLY && (
        <section className="camera-screen" style={{padding:"24px 18px",display:"grid",gap:18,justifyItems:"center",textAlign:"center"}}>
          <button type="button" className="secondary" style={{justifySelf:"start"}} onClick={() => setStage("intro")}>× Voltar</button>
          <h2 style={{margin:0}}>Tire a foto com a câmera do celular</h2>
          <ol style={{textAlign:"left",margin:0,paddingLeft:20,lineHeight:1.6,maxWidth:360}}>
            <li>Cartão sobre o dedo, mão apoiada na mesa.</li>
            <li>Celular paralelo à mesa, bem de cima.</li>
            <li>Cartão inteiro e o dedo aparecendo na foto.</li>
            <li>Deixe o flash da câmera no automático.</li>
          </ol>
          <label style={{display:"block",width:"100%",maxWidth:360,padding:"18px 16px",borderRadius:16,background:"linear-gradient(90deg,#c9a967,#f0cd78)",color:"#171109",fontWeight:900,fontSize:18,cursor:"pointer"}}>
            Abrir a câmera
            <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={(e:{currentTarget:HTMLInputElement}) => { const f=e.currentTarget.files?.[0]; e.currentTarget.value=""; void onNativePhoto(f); }} />
          </label>
          {camera.error && <p className="error">{camera.error}</p>}
        </section>
      )}
      {stage === "camera" && !NATIVE_CAMERA_ONLY && (
        <FrozenCameraScreen
          videoRef={camera.videoRef}
          torchOn={camera.torchOn}
          torchSupported={camera.torchSupported}
          onToggleTorch={() => void camera.toggleTorch()}
          cardReady={cardReady}
          calibrationStep={fingerCardCalibrationStep}
          cameraAngleGuide={cameraAngleGuide}
          liveFingerTiltDeg={measurementMode==="finger" ? liveFingerTiltDeg : null}
          liveFingerTiltConfidence={measurementMode==="finger" ? liveFingerTiltConfidence : 0}
          liveOpticalCenterOffsetPx={measurementMode==="finger" ? liveOpticalCenterOffsetPx : null}
          liveCardFingerOffsetPx={measurementMode==="finger" ? liveCardFingerOffsetPx : null}
          liveOpticalCenterConfidence={measurementMode==="finger" ? liveOpticalCenterConfidence : 0}
          devicePitch={deviceQuality.devicePitch}
          deviceRoll={deviceQuality.deviceRoll}
          cameraOpening={camera.cameraOpening}
          error={camera.error}
          referenceCardWidthPercent={fingerCardCalibrationStep === "measurement" ? referenceCardWidthPercent : null}
          referenceCardAngleDeg={fingerCardCalibrationStep === "measurement" ? referenceCardAngleDeg : null}
          singlePhotoTestMode={singlePhotoTestMode}
          onClose={() => { camera.stopCamera(); setStage("intro"); }}
          onCapture={() => void capture()}
          onNativePhoto={(f:File|undefined) => void onNativePhoto(f)}
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
            {photo && <img className="zoomable-photo" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }} src={displayPhoto} alt="Fotografia para medição" draggable={false} />}
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
            ) : null}
            {phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode && (
              <>
                {phase === "card" && fingerLoupe && photo && (
                  <div
                    aria-hidden="true"
                    style={{
                      position:"absolute",
                      left:fingerLoupe.side==="left" ? "72%" : "28%",
                      top:"18%",
                      width:`${LOUPE_SIZE_PX}px`,
                      height:`${LOUPE_SIZE_PX}px`,
                      transform:"translate(-50%,-50%)",
                      borderRadius:"50%",
                      overflow:"hidden",
                      border:"3px solid #52e0a3",
                      boxShadow:"0 8px 28px rgba(0,0,0,.55)",
                      backgroundImage:`url("${displayPhoto}")`,
                      backgroundRepeat:"no-repeat",
                      // Lupa centrada EXATAMENTE no cruzamento linha verde x linha amarela,
                      // com aumento de 2x sobre o zoom atual da tela.
                      backgroundSize:`${fingerLoupe.stageW*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px ${fingerLoupe.stageH*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px`,
                      backgroundPosition:`${LOUPE_SIZE_PX/2-fingerLoupe.imageX/100*fingerLoupe.stageW*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px ${LOUPE_SIZE_PX/2-fingerLoupe.imageY/100*fingerLoupe.stageH*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px`,
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
                    }}>CARTÃO · {(fingerLoupe.zoom*LOUPE_EXTRA_ZOOM).toFixed(1)}×</span>
                  </div>
                )}
              </>
            )}
            {phase === "card" && !(measurementMode === "finger" && !diameterPhotoTestMode) ? (
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
                      width:`${LOUPE_SIZE_PX}px`,
                      height:`${LOUPE_SIZE_PX}px`,
                      transform:"translate(-50%,-50%)",
                      borderRadius:"50%",
                      overflow:"hidden",
                      border:"3px solid #52e0a3",
                      boxShadow:"0 8px 28px rgba(0,0,0,.55)",
                      backgroundImage:`url("${displayPhoto}")`,
                      backgroundRepeat:"no-repeat",
                      // Lupa centrada EXATAMENTE no cruzamento linha verde x linha amarela,
                      // com aumento de 2x sobre o zoom atual da tela.
                      backgroundSize:`${fingerLoupe.stageW*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px ${fingerLoupe.stageH*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px`,
                      backgroundPosition:`${LOUPE_SIZE_PX/2-fingerLoupe.imageX/100*fingerLoupe.stageW*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px ${LOUPE_SIZE_PX/2-fingerLoupe.imageY/100*fingerLoupe.stageH*fingerLoupe.zoom*LOUPE_EXTRA_ZOOM}px`,
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
                    }}>BORDA · {(fingerLoupe.zoom*LOUPE_EXTRA_ZOOM).toFixed(1)}×</span>
                  </div>
                )}
                {widthAnalysis.track && (
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:9}}
                  >
                    <polyline points={widthAnalysis.track.leftPts} fill="none" stroke="#00e5ff" strokeWidth={0.35} vectorEffect="non-scaling-stroke" style={{strokeWidth:2}} />
                    <polyline points={widthAnalysis.track.rightPts} fill="none" stroke="#00e5ff" strokeWidth={0.35} vectorEffect="non-scaling-stroke" style={{strokeWidth:2}} />
                  </svg>
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
                    {debugMode && contourConstantTest && (
                      <>
                        {contourConstantTest.points.filter(point=>point.valid).map((point,index)=>(
                          <g key={`constant-snap-${index}`}>
                            <circle
                              cx={point.leftPercent}
                              cy={point.yPercent}
                              r={point.inPlateau ? "0.78" : "0.52"}
                              fill={point.inPlateau ? "#ffd86b" : "#7ec4ff"}
                              stroke="rgba(0,0,0,.55)"
                              strokeWidth="0.18"
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle
                              cx={point.rightPercent}
                              cy={point.rightYPercent}
                              r={point.inPlateau ? "0.78" : "0.52"}
                              fill={point.inPlateau ? "#ffd86b" : "#7ec4ff"}
                              stroke="rgba(0,0,0,.55)"
                              strokeWidth="0.18"
                              vectorEffect="non-scaling-stroke"
                            />
                            {point.inPlateau && (
                              <line
                                x1={point.leftPercent}
                                y1={point.yPercent}
                                x2={point.rightPercent}
                                y2={point.rightYPercent}
                                stroke="#ffd86b"
                                strokeWidth="0.55"
                                opacity="0.72"
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                          </g>
                        ))}
                      </>
                    )}
                    {debugMode && robustFingerLineTest && (
                      <>
                        <line
                          x1={robustFingerLineTest.leftTopPercent}
                          y1={robustFingerLineTest.yTopPercent}
                          x2={robustFingerLineTest.leftBottomPercent}
                          y2={robustFingerLineTest.yBottomPercent}
                          stroke="#ffd86b"
                          strokeWidth="1.05"
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={robustFingerLineTest.rightTopPercent}
                          y1={robustFingerLineTest.yTopPercent}
                          x2={robustFingerLineTest.rightBottomPercent}
                          y2={robustFingerLineTest.yBottomPercent}
                          stroke="#ffd86b"
                          strokeWidth="1.05"
                          vectorEffect="non-scaling-stroke"
                        />
                      </>
                    )}
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
            {phase === "finger" && result && commercialRingSize!==null && leftLocked && rightLocked && !tryOn && (
              <div className="ring-size-badge" style={{ left: `${visualBandCenter}%` }} aria-live="polite">
                {ringBoundary ? (<>
                  <span>SEU ARO ESTÁ NA DIVISA</span>
                  <strong>{ringBoundary.low} ou {ringBoundary.high}</strong>
                  <small>{ringBoundary.low} = mais justo · {ringBoundary.high} = mais folga</small>
                </>) : (<>
                  <span>JUSTO: {clamp(commercialRingSize - 1, 1, 40)}</span>
                  <span>NÚMERO EXATO:</span>
                  <strong>{commercialRingSize}</strong>
                  <small>Conforto: {clamp(commercialRingSize + 1, 1, 40)} · recomendado com folga</small>
                </>)}
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

          {debugMode && phase === "card" && measurementMode === "finger" && photo && (
            <>
              <div className="analysis-result">
                <strong>DETECTOR LEVE AUTOMÁTICO</strong>
                <span>Executado automaticamente após a foto. Se a confiança for suficiente, as 3 linhas são aplicadas e o fluxo segue direto para o dedo.</span>
              </div>
              <OpenCvCardTest photo={photo} />
            </>
          )}

          {analyzingCard && <p className="analysis-loading">Localizando o cartão...</p>}
          {phase === "card" && measurementMode === "finger" && !diameterPhotoTestMode && !analyzingCard && (
            <>
              {MANUAL_CARD_STEP && singlePhotoTestMode && (
                <button className="secondary" type="button" onClick={autoAdjustCardLines} style={{width:"100%",marginBottom:8}}>
                  Ajustar linhas automaticamente
                </button>
              )}
              <button
                className="primary confirm-perspective"
                type="button"
                onClick={fingerCardCalibrationStep === "reference" ? confirmReferenceCardLine : confirmMeasurementCardLine}
              >
                {singlePhotoTestMode
                  ? "Cartão ajustado · medir o dedo"
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
                  ? "Dê zoom e encoste cada linha verde lateral exatamente na borda do cartão, usando a lupa. A lupa mostra o ponto onde a lateral cruza a base, que é o que define a medida."
                  : fingerCardCalibrationStep === "reference"
                    ? "Ajuste a lateral esquerda, a lateral direita e a linha da base nas bordas reais do cartão."
                    : "Ajuste novamente as duas laterais e a base do cartão sobre o dedo. Na captura, use a guia fantasma da Foto 1 para aproximar escala e ângulo."}</span>
                <small>{singlePhotoTestMode
                  ? "A própria largura de 85,60 mm desta foto define a escala usada para medir o dedo."
                  : fingerCardCalibrationStep === "reference"
                    ? "A largura entre as duas laterais na linha da base representa os 85,60 mm do cartão."
                    : "A Foto 2 continua calculando sua própria escala, mas agora a captura é guiada para ficar o mais próxima possível da Foto 1."}</small>
                <small>{MANUAL_CARD_STEP ? "Ao soltar, a linha gruda na borda do cartão mais próxima (ímã curto). A escala usa só os pontos onde as laterais cruzam a base." : "As 3 linhas mantêm o ímã: aproxime da borda e solte para encaixar."}</small>
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

          {phase==="finger" && measurementMode==="finger" && liveWidthMm!==null && !anatomicalRegionReady && (
            <div className="analysis-result" role="alert">
              <strong>Região do anel não detectada</strong>
              <span>O aro foi bloqueado porque nem a anatomia nem os snaps físicos atingiram confiança suficiente nesta foto. Refaça a captura.</span>
            </div>
          )}
          {phase==="finger" && singlePhotoTestMode && liveWidthMm!==null && !captureQualityGate.accepted && anatomicalRegionReady && (
            <div className="analysis-result">
              <strong>Captura descartada</strong>
              <span>Esta foto não passou na validação: {captureQualityGate.reasons.join(" · ")}. Refaça a captura; a nova foto começa do zero e não será combinada com esta.</span>
            </div>
          )}
          {phase === "finger" && liveWidthMm !== null && !preFormulaQuality.accepted && (
            <div className="analysis-result">
              <strong>Medição com baixa confiança</strong>
              <span>Confiança: {preFormulaQuality.finalConfidence}/100 · {preFormulaQuality.label}.</span>
              <span>Estabilidade da captura: {captureDeviceQuality?.stabilityScore==null?"n/d":captureDeviceQuality.stabilityScore}/100.</span>
              <span>Refaça a captura com o cartão e o celular mais alinhados. Para liberar a medição, a estabilidade precisa ficar em 75 ou mais.</span>
            </div>
          )}
          {phase === "finger" && result && !commercialValidation.accepted && leftLocked && rightLocked && (
            <div className="analysis-result" role="alert">
              <strong>Vamos tirar outra foto</strong>
              {commercialValidation.reasons.map(r=><span key={r.code}>{r.text}</span>)}
              <button type="button" className="secondary" onClick={resetPhoto}>Tirar outra foto</button>
            </div>
          )}
          {phase === "finger" && result && commercialRingSize!==null && leftLocked && rightLocked && (
            <div className="analysis-result commercial-result">
              {ringBoundary ? (<>
                <span><strong>Mais justo: {ringBoundary.low}</strong></span>
                <strong>Seu dedo está na divisa: {ringBoundary.low} ou {ringBoundary.high}</strong>
                <span><strong>Mais folga: {ringBoundary.high}</strong></span>
                <small>A medida caiu exatamente entre dois aros. Se gosta de anel firme, escolha {ringBoundary.low}; se prefere folga ou o dedo incha no calor, escolha {ringBoundary.high}.</small>
              </>) : (<>
                <span><strong>Número justo: {clamp(commercialRingSize - 1, 1, 40)}</strong></span>
                <strong>Número exato: {commercialRingSize}</strong>
                <span><strong>Número de conforto: {clamp(commercialRingSize + 1, 1, 40)}</strong></span>
                <small>Justo = um aro abaixo · Exato = aro calculado · Conforto = um aro acima para maior folga.</small>
              </>)}
            </div>
          )}
          {debugMode && phase === "finger" && leftLocked && rightLocked && (
            <div className="analysis-result">
              <strong>DIAGNÓSTICO PRIVADO</strong>
              <div style={{border:"2px solid #00e5ff",borderRadius:10,padding:10,display:"grid",gap:8,margin:"6px 0"}}>
                <strong>CONFERÊNCIA EM LOTE · {savedTests.length} teste(s) salvo(s)</strong>
                <label style={{display:"flex",gap:8,alignItems:"center"}}>
                  Aro real:
                  <input inputMode="numeric" value={realRingInput} onChange={(e:{target:{value:string}})=>setRealRingInput(e.target.value)} placeholder="ex: 25" style={{width:80,padding:"6px 8px",borderRadius:6,border:"1px solid #c9a967",background:"#14100b",color:"#f4e7c8"}} />
                </label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button type="button" onClick={()=>void saveTestForReview()} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #00e5ff",background:"#0d2a30",color:"#e6fbff",fontWeight:700}}>Salvar teste</button>
                  <button type="button" disabled={!savedTests.length} onClick={()=>void generateTestReport()} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #f0cd78",background:"#2a2112",color:"#f4e7c8",fontWeight:700}}>Gerar relatório</button>
                  <button type="button" disabled={!savedTests.length} onClick={()=>{ if(window.confirm?.("Apagar todos os testes salvos?")===false) return; storeTests([]); setSavedTests([]); setReportUrl(null); setTestBusy("Testes apagados."); }} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #8a4b4b",background:"#2a1515",color:"#f4e7c8"}}>Limpar</button>
                </div>
                {reportUrl && <a href={reportUrl} download={`relatorio-medidor-${savedTests.length}-testes.jpg`} style={{color:"#00e5ff",fontWeight:700}}>Baixar relatório</a>}
                {testBusy && <small>{testBusy}</small>}
              </div>
              <span>Captura: {singlePhotoTestMode ? "1 foto (teste)" : "2 fotos"}</span>
              <span>Medida final: {(result?.widthMm ?? widthSentToFormulaMm ?? liveWidthMm)?.toFixed(2) ?? "n/d"} mm</span>
              {cardEdgeInfo && <span>Bordas do cartão: {cardEdgeInfo.source}{cardEdgeInfo.legacyFail ? ` (refino original falhou: ${cardEdgeInfo.legacyFail})` : ""}</span>}
              {measurementCardLengthPx ? <span>Escala: interseções A (esquerda×base) – B (direita×base) = {measurementCardLengthPx.toFixed(1)} px = 85,60 mm</span> : null}
              {photoSourceInfo && <span>Origem da foto: {photoSourceInfo}{sharpPhoto?` · correção foto nítida ×${SHARP_PHOTO_SCALE.toFixed(4)}`:""}</span>}
              <span>Câmera: {photoHiRes ? `${photoHiRes.videoW}×${photoHiRes.videoH} · foto alta ${photoHiRes.width}×${photoHiRes.height}` : "alta resolução indisponível (usando 900×1200)"}{photoHiRes && pixelsPerMm ? ` · pixel real ≈ ${(1/(pixelsPerMm*photoHiRes.width/900)).toFixed(3)} mm` : ""}</span>
              {widthAnalysis.track && <span>SNAPS DO DEDO ±2 mm (usado): mediana bruta {widthAnalysis.track.mm.toFixed(2)} mm{sharpPhoto?` × ${SHARP_PHOTO_SCALE} = ${(widthAnalysis.track.mm*SHARP_PHOTO_SCALE).toFixed(2)} mm`:""} → aro {classifyFingerWidthMm(widthAnalysis.track.mm*sharpScale).exactRingSize} · {widthAnalysis.track.count} cortes em {widthAnalysis.track.lengthMm.toFixed(1)} mm de dedo · mín {widthAnalysis.track.minMm.toFixed(2)} máx {widthAnalysis.track.maxMm.toFixed(2)} · na linha amarela {widthAnalysis.track.startMm.toFixed(2)} · eixo {widthAnalysis.track.angleDeg.toFixed(1)}° (bordas diferem {widthAnalysis.track.edgeSpreadDeg.toFixed(1)}°) · variação p10–p90 {(widthAnalysis.track.p90Mm-widthAnalysis.track.p10Mm).toFixed(2)} mm · {widthAnalysis.track.hiRes?"foto alta":"foto 900"}</span>}
              {!widthAnalysis.track && widthAnalysis.manualMm!==null && <span>3000 SNAPS: não conseguiu seguir a borda (usando as linhas da lupa)</span>}
              {widthAnalysis.manualMm!==null && <span>SÓ LUPA: {widthAnalysis.manualMm.toFixed(2)} mm → aro {classifyFingerWidthMm(widthAnalysis.manualMm).exactRingSize} · inclinação corrigida {widthAnalysis.manualAngleDeg.toFixed(2)}°</span>}
              {widthAnalysis.autoMm!==null && <span>Automático (comparação): {widthAnalysis.autoMm.toFixed(2)} mm → aro {classifyFingerWidthMm(widthAnalysis.autoMm).exactRingSize}</span>}
              {measurementAudit && (
                <>
                  <span>Modo híbrido: linhas manuais + 50 refinamentos automáticos</span>
                  {measurementAudit && <span>Inclinação detectada do dedo: {measurementAudit.fingerAxisAngleDeg.toFixed(2)}° · cortes corrigidos perpendicularmente</span>}
                  <span>Device na captura: pitch {captureDeviceQuality?.devicePitch==null?"n/d":captureDeviceQuality.devicePitch.toFixed(1)+"°"} · roll {captureDeviceQuality?.deviceRoll==null?"n/d":captureDeviceQuality.deviceRoll.toFixed(1)+"°"} · movimento {captureDeviceQuality?.deviceMotion==null?"n/d":captureDeviceQuality.deviceMotion.toFixed(2)}</span>
                  <span>Stability na captura: {captureDeviceQuality?.stabilityScore==null?"n/d":captureDeviceQuality.stabilityScore}</span>
                  <span>Perspective score: {measurementAudit.perspectiveScore}</span>
                  <span>Edge score: {measurementAudit.edgeScore}</span>
                  <span>Medida antiga: {measurementAudit.oldMm===null?"n/d":measurementAudit.oldMm.toFixed(2)+" mm"}</span>
                  <span>Medida nova robusta: {measurementAudit.newMm===null?"n/d":measurementAudit.newMm.toFixed(2)+" mm"}</span>
                  {measurementAudit.oldMm!==null && measurementAudit.newMm!==null && <span>Diferença old→new: {(measurementAudit.newMm-measurementAudit.oldMm>=0?"+":"")}{(measurementAudit.newMm-measurementAudit.oldMm).toFixed(2)} mm</span>}
                  <span>Mediana filtrada: {measurementAudit.robustMedianMm===null?"n/d":measurementAudit.robustMedianMm.toFixed(2)+" mm"} · média aparada: {measurementAudit.robustTrimmedMeanMm===null?"n/d":measurementAudit.robustTrimmedMeanMm.toFixed(2)+" mm"}</span>
                  <span>Cortes filtrados: {measurementAudit.robustFilteredCount} · outliers removidos: {measurementAudit.robustOutlierCount}</span>
                  <span>Confidence final: {measurementAudit.finalConfidence}/100 · {measurementAudit.finalConfidenceLabel}</span>
                  <span>Gate da captura: {captureQualityGate.accepted ? "ACEITA" : "DESCARTADA"}{!captureQualityGate.accepted ? ` · ${captureQualityGate.reasons.join(" · ")}` : ""}</span>
                  <span>Comparação geométrica: homografia direta {widthAnalysis.homographyMm?.toFixed(2) ?? "n/d"} mm · escala local {widthAnalysis.localScaleMm?.toFixed(2) ?? "n/d"} mm · escala normalizada {widthAnalysis.normalizedScaleMm?.toFixed(2) ?? "n/d"} mm</span>
                  <span>Fonte ativa: CALIBRAÇÃO 85,60 MM POR INTERSEÇÕES</span>
                  <span>Cartão automático: detector aproximado + auto-snap físico EXTERNO das laterais + base antes da escala.</span>
                  <span>Homografia: somente diagnóstico/validação de perspectiva · não altera a medida</span>
                  <span>Divergência geométrica: {widthAnalysis.geometryDisagreementMm.toFixed(2)} mm · somente diagnóstico</span>
                  <span>Medida realmente enviada à fórmula: {widthSentToFormulaMm===null ? "n/d" : widthSentToFormulaMm.toFixed(2)+" mm"}</span>
                  {robustFingerLineTest && (
                    <>
                      <span>TESTE RETAS ROBUSTAS: {robustFingerLineTest.widthMm.toFixed(2)} mm · {robustFingerLineTest.widthPx.toFixed(1)} px</span>
                      <span>Pontos aceitos nas retas: {robustFingerLineTest.inlierPercent}% · resíduo médio {robustFingerLineTest.averageResidualPx.toFixed(2)} px</span>
                      <span>Diferença retas→oficial: {widthSentToFormulaMm===null ? "n/d" : `${robustFingerLineTest.widthMm-widthSentToFormulaMm>=0?"+":""}${(robustFingerLineTest.widthMm-widthSentToFormulaMm).toFixed(2)} mm`}</span>
                      <span>Linhas amarelas finas = laterais estruturais robustas · teste somente diagnóstico.</span>
                    </>
                  )}
                  {physicalEdgeProfileTest && (
                    <>
                      <span>BORDA FÍSICA VALIDADA: {physicalEdgeProfileTest.widthMm===null ? "n/d" : physicalEdgeProfileTest.widthMm.toFixed(2)+" mm"} · suporte {physicalEdgeProfileTest.validPairPercent}% · {physicalEdgeProfileTest.status}</span>
                      <span>Offset mediano da borda: E {physicalEdgeProfileTest.medianLeftOffsetPx>=0?"+":""}{physicalEdgeProfileTest.medianLeftOffsetPx.toFixed(1)} px · D {physicalEdgeProfileTest.medianRightOffsetPx>=0?"+":""}{physicalEdgeProfileTest.medianRightOffsetPx.toFixed(1)} px</span>
                      <span>Transição física mediana: {physicalEdgeProfileTest.medianTransition.toFixed(1)} níveis de cinza</span>
                      <span>Diferença borda física→oficial: {physicalEdgeProfileTest.widthMm===null || widthSentToFormulaMm===null ? "n/d" : `${physicalEdgeProfileTest.widthMm-widthSentToFormulaMm>=0?"+":""}${(physicalEdgeProfileTest.widthMm-widthSentToFormulaMm).toFixed(2)} mm`}</span>
                      <span>Teste de perfil transversal · não altera o aro comercial.</span>
                    </>
                  )}
                  {contourConstantTest && (
                    <div
                      style={{
                        marginTop:10,
                        padding:"12px",
                        border:`2px solid ${contourConstantTest.stable?"rgba(255,216,107,.68)":"rgba(255,154,102,.62)"}`,
                        borderRadius:10,
                        display:"grid",
                        gap:6,
                        background:"rgba(31,25,16,.62)"
                      }}
                    >
                      <strong>TESTE · CONTORNO MULTIPONTO + CONSTANTE</strong>
                      <span>Snaps válidos: {contourConstantTest.validCount}/{contourConstantTest.totalCount} · suporte {contourConstantTest.supportPercent}%</span>
                      <span>Constante encontrada: {contourConstantTest.widthMm===null ? "n/d" : contourConstantTest.widthMm.toFixed(2)+" mm"} · {contourConstantTest.stable ? "PLATÔ ESTÁVEL" : "SEM PLATÔ FORTE"}</span>
                      {contourConstantTest.plateauStart>=0 && <span>Platô: pontos {contourConstantTest.plateauStart+1}–{contourConstantTest.plateauEnd+1} · variação {contourConstantTest.spreadPercent?.toFixed(2)}%</span>}
                      {!!contourConstantTest.plateauValuesMm.length && <span>Medidas do platô: {contourConstantTest.plateauValuesMm.map(value=>value.toFixed(2)).join(" / ")} mm</span>}
                      <span>PLATÔ MÁXIMO: {contourConstantTest.widthMm===null ? "n/d" : contourConstantTest.widthMm.toFixed(2)+" mm"} · histórica {contourConstantTest.historicalRing===null ? "n/d" : "aro "+contourConstantTest.historicalRing}</span>
                      <span>MÉDIA DOS SNAPS: {contourConstantTest.overallMeanMm===null ? "n/d" : contourConstantTest.overallMeanMm.toFixed(2)+" mm"} · histórica {contourConstantTest.overallMeanHistoricalRing===null ? "n/d" : "aro "+contourConstantTest.overallMeanHistoricalRing}</span>
                      <span>MEDIANA DOS SNAPS: {contourConstantTest.overallMedianMm===null ? "n/d" : contourConstantTest.overallMedianMm.toFixed(2)+" mm"} · histórica {contourConstantTest.overallMedianHistoricalRing===null ? "n/d" : "aro "+contourConstantTest.overallMedianHistoricalRing}</span>
                      <small>Azul = snap físico válido · dourado = pontos da constante escolhida. Teste apenas diagnóstico.</small>
                    </div>
                  )}
                  {methodComparisonTest && (
                    <div
                      style={{
                        marginTop:10,
                        padding:"10px 12px",
                        border:"1px solid rgba(255,216,107,.45)",
                        borderRadius:10,
                        display:"grid",
                        gap:6,
                        background:"rgba(20,20,20,.55)"
                      }}
                    >
                      <strong>COMPARAÇÃO DE MÉTODOS · MESMA FOTO</strong>
                      <span>ATUAL: {methodComparisonTest.current.px.toFixed(1)} px · {methodComparisonTest.current.mm.toFixed(2)} mm · curva atual aro {methodComparisonTest.current.officialRing} · histórica aro {methodComparisonTest.current.historicalRing}</span>
                      <span>INSET 2,5 px/lado: {methodComparisonTest.inset.px.toFixed(1)} px · {methodComparisonTest.inset.mm.toFixed(2)} mm · curva atual aro {methodComparisonTest.inset.officialRing} · histórica aro {methodComparisonTest.inset.historicalRing}</span>
                      <span>BORDA FÍSICA: {methodComparisonTest.physical ? `${methodComparisonTest.physical.px.toFixed(1)} px · ${methodComparisonTest.physical.mm.toFixed(2)} mm · curva atual aro ${methodComparisonTest.physical.officialRing} · histórica aro ${methodComparisonTest.physical.historicalRing} · suporte ${methodComparisonTest.physical.support}%` : "n/d"}</span>
                      <small>Diagnóstico somente · nenhum destes testes altera o aro comercial.</small>
                    </div>
                  )}
                  {geometricStabilityTest && (
                    <div
                      style={{
                        marginTop:10,
                        padding:"10px 12px",
                        border:"1px solid rgba(126,196,255,.42)",
                        borderRadius:10,
                        display:"grid",
                        gap:6,
                        background:"rgba(12,20,28,.55)"
                      }}
                    >
                      <strong>ESTABILIDADE GEOMÉTRICA DA FOTO</strong>
                      <span>Cartão: {geometricStabilityTest.cardPx.toFixed(1)} px · escala {geometricStabilityTest.mmPerPx.toFixed(4)} mm/px</span>
                      <span>Dedo atual: {geometricStabilityTest.currentFingerPx===null ? "n/d" : geometricStabilityTest.currentFingerPx.toFixed(1)+" px"} · razão dedo/cartão {geometricStabilityTest.currentRatio===null ? "n/d" : geometricStabilityTest.currentRatio.toFixed(4)}</span>
                      <span>Borda física: {geometricStabilityTest.physicalFingerPx===null ? "n/d" : geometricStabilityTest.physicalFingerPx.toFixed(1)+" px"} · razão física/cartão {geometricStabilityTest.physicalRatio===null ? "n/d" : geometricStabilityTest.physicalRatio.toFixed(4)}</span>
                      <span>Fonte da altura: {handLandmarkAnalysis?.measuredFinger && handLandmarkAnalysis.measuredFinger.confidence>=60 && handLandmarkAnalysis.measuredFinger.ringRegionY!==null ? "landmarks" : contourAnatomy?.detected ? "contorno anatômico" : `padrão (base + ${RING_HEIGHT_FALLBACK_OFFSET}%)`} · base do cartão {cardBaseYPercent.toFixed(1)}%</span>
                      <span>Altura anatômica Y: {geometricStabilityTest.anatomyY.toFixed(1)}% · ângulo dedo {geometricStabilityTest.fingerAngleDeg===null ? "n/d" : geometricStabilityTest.fingerAngleDeg.toFixed(2)+"°"}</span>
                      <span>Celular: pitch {geometricStabilityTest.pitch===null ? "n/d" : geometricStabilityTest.pitch.toFixed(1)+"°"} · roll {geometricStabilityTest.roll===null ? "n/d" : geometricStabilityTest.roll.toFixed(1)+"°"} · movimento {geometricStabilityTest.motion===null ? "n/d" : geometricStabilityTest.motion.toFixed(2)}</span>
                      <span>Stability {geometricStabilityTest.stability===null ? "n/d" : geometricStabilityTest.stability} · perspective {geometricStabilityTest.perspectiveScore}</span>
                      <small>Diagnóstico somente · este quadro ainda não bloqueia nem corrige o resultado.</small>
                    </div>
                  )}
                  {experimentalOperationalTest && (
                    <div
                      style={{
                        marginTop:10,
                        padding:"12px",
                        border:`2px solid ${experimentalOperationalTest.accepted?"rgba(82,224,163,.65)":"rgba(255,126,126,.65)"}`,
                        borderRadius:10,
                        display:"grid",
                        gap:6,
                        background:experimentalOperationalTest.accepted
                          ? "rgba(14,36,28,.58)"
                          : "rgba(42,18,18,.58)"
                      }}
                    >
                      <strong>VALIDAÇÃO · CURVA PRINCIPAL</strong>
                      <span>Gate geométrico: {experimentalOperationalTest.accepted ? "✓ ACEITA" : "✕ BLOQUEIA"}</span>
                      <span>Medida usada: {widthSentToFormulaMm===null?"n/d":widthSentToFormulaMm.toFixed(2)+" mm"}</span>
                      <span>Validação física: {experimentalOperationalTest.physicalMm===null?"n/d":experimentalOperationalTest.physicalMm.toFixed(2)+" mm"} · suporte {experimentalOperationalTest.physicalSupport}% · diferença {experimentalOperationalTest.physicalDeltaMm===null?"n/d":experimentalOperationalTest.physicalDeltaMm.toFixed(2)+" mm"}</span>
                      <span>Curva principal: aro {experimentalOperationalTest.officialRing} · comparação histórica: aro {experimentalOperationalTest.historicalRing}</span>
                      <span>RESULTADO DA VALIDAÇÃO: {experimentalOperationalTest.accepted ? "ARO "+(commercialRingSize ?? experimentalOperationalTest.proposedRing) : "CAPTURA REPROVADA · REFAZER FOTO"}</span>
                      {!experimentalOperationalTest.accepted && <span>Motivos: {experimentalOperationalTest.reasons.join(" · ")}</span>}
                      <small>Validação privada da curva principal e da qualidade da captura.</small>
                    </div>
                  )}
                  {measurementMode==="finger" && widthSentToFormulaMm!==null && experimentalHighRingResult && (
                    <>
                      <span>CLASSIFICADOR PRINCIPAL · CURVA ANTERIOR: aro {result?.ringSize ?? "n/d"}</span>
                      <span>ARO COMERCIAL: {commercialRingSize ?? "n/d"}</span>
                      <span>Desempate: DESATIVADO</span>
                      <span>COMPARAÇÃO · CURVA HISTÓRICA: aro {experimentalHighRingResult.exactRingSize} · alvo {experimentalHighRingResult.targetWidthMm.toFixed(3)} mm · faixa {Number.isFinite(experimentalHighRingResult.lowerBoundaryMm)?experimentalHighRingResult.lowerBoundaryMm.toFixed(3):"-∞"}–{Number.isFinite(experimentalHighRingResult.upperBoundaryMm)?experimentalHighRingResult.upperBoundaryMm.toFixed(3):"+∞"} mm</span>
                      <span>A curva histórica é apenas diagnóstico e não altera o aro comercial exibido.</span>
                    </>
                  )}
                  <span>Landmarks da mão: {handLandmarkAnalysis?.detected ? "detectados" : handLandmarkAnalysis?.available===false ? "indisponíveis" : "aguardando"}{handLandmarkAnalysis?.detected ? ` · score ${handLandmarkAnalysis.score}` : ""}</span>
                  {handLandmarkAnalysis?.error && <span>Landmark erro: {handLandmarkAnalysis.error}</span>}
                  {handLandmarkAnalysis?.measuredFinger && <span>Dedo estimado: {handLandmarkAnalysis.measuredFinger.finger} · confiança {handLandmarkAnalysis.measuredFinger.confidence}% · visíveis {handLandmarkAnalysis.measuredFinger.visibleLandmarks}/4 · {handLandmarkAnalysis.measuredFinger.partial ? "parcial" : "completo"} · cartão ocultando {handLandmarkAnalysis.measuredFinger.occludedByCard ? "sim" : "não"}</span>}
                  {handLandmarkAnalysis?.measuredFinger && <span>ringRegionY {handLandmarkAnalysis.measuredFinger.ringRegionY===null?"oculta/fallback":(handLandmarkAnalysis.measuredFinger.ringRegionY*100).toFixed(1)+"%"} · jointRegionY {handLandmarkAnalysis.measuredFinger.jointRegionY===null?"oculta":(handLandmarkAnalysis.measuredFinger.jointRegionY*100).toFixed(1)+"%"}</span>}
                  <span>Contorno anatômico: {contourAnatomy?.detected ? "detectado" : "não detectado"}{contourAnatomy ? ` · score ${contourAnatomy.score} · ${contourAnatomy.reason}` : ""}</span>
                  <span>Janela anatômica: base do cartão ${cardBaseYPercent.toFixed(1)}% · busca ${anatomicalWindow.minY.toFixed(1)}%–${anatomicalWindow.maxY.toFixed(1)}%</span>
                  {contourAnatomy?.ringRegionY!==null && contourAnatomy?.ringRegionY!==undefined && <span>Contour ringRegionY: {contourAnatomy.ringRegionY.toFixed(1)}% · jointRegionY {contourAnatomy.jointRegionY===null?"n/d":contourAnatomy.jointRegionY.toFixed(1)+"%"} · CV {contourAnatomy.widthCvPercent===null?"n/d":contourAnatomy.widthCvPercent.toFixed(2)+"%"}</span>}
                  <span>Região anatômica: somente a foto atual · sem fusão entre capturas</span>
                  <span>Região anatômica aplicada: {anatomicalRegionSource}{anatomicalRegionReady ? ` · Y ${auditGuideY.toFixed(1)}%` : ""}</span>
                  {handLandmarkAnalysis?.measuredFinger && <span>Eixo anatômico por landmarks: {handLandmarkAnalysis.measuredFinger.axisAngleDeg.toFixed(2)}°</span>}
                  <span>Modo de captura: FOTO ÚNICA AUTÔNOMA</span>
                  <span>Histórico entre fotos: DESATIVADO · nenhuma média ou fusão entre capturas</span>
                  <span>Fluxo comercial: cada nova foto recalibra pelo cartão da própria imagem e substitui integralmente a anterior.</span>
                  <span>Largura enviada à fórmula: {widthSentToFormulaMm===null?"n/d":widthSentToFormulaMm.toFixed(2)+" mm"}</span>
                  <span>Card corners (%): {JSON.stringify(quadFromLines(cardLines))}</span>
                  <span>Depth: {VISION_FEATURE_FLAGS.ENABLE_DEPTH_VALIDATION ? "habilitado/aguardando fonte" : "não disponível · fallback visão computacional"}</span>
                  <span>Varredura: {measurementAudit.rawWidthsPx.length} cortes · {measurementAudit.rawWidthsPx.map((value)=>value.toFixed(1)).join(" / ")} px</span>
                  <span>Região mais larga estável: pontos {measurementAudit.selectedRunStart}–{measurementAudit.selectedRunStart + measurementAudit.selectedUpperWidthsPx.length - 1}</span>
                  <span>Platô usado: {measurementAudit.selectedUpperWidthsPx.map((value)=>value.toFixed(1)).join(" / ")} px</span>
                  <span>Largura usada: {measurementAudit.usedWidthPx.toFixed(2)} px</span>
                  <span>Variação: {measurementAudit.spreadPx.toFixed(2)} px · {measurementAudit.spreadPercent.toFixed(2)}%</span>
                  {measurementAudit.cardScaleMmPerPx !== null && <span>Escala: {measurementAudit.cardScaleMmPerPx.toFixed(4)} mm/px</span>}
                  {measurementAudit.rawCardMm !== null && <span>Medida bruta: {measurementAudit.rawCardMm.toFixed(2)} mm</span>}
                  <span>Correção entre fotos: não aplicável no modo 1 foto</span>
                  {measurementAudit.normalizedMm !== null && <span>Medida usada pela V2: {measurementAudit.normalizedMm.toFixed(2)} mm</span>}
                  {referenceCardLengthPx !== null && <span>Cartão foto 1: {referenceCardLengthPx.toFixed(1)} px</span>}
                  {measurementCardLengthPx !== null && <span>Cartão da medição: {measurementCardLengthPx.toFixed(1)} px</span>}
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
                      cx={comparisonChart.x(clamp(commercialRingSize ?? result.ringSize,17,33))}
                      cy={comparisonChart.y(clamp(result.widthMm,comparisonChart.minMm,comparisonChart.maxMm))}
                      r="5.2"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                    <text
                      x={comparisonChart.x(clamp(commercialRingSize ?? result.ringSize,17,33))}
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
              <span>Posicione as linhas verdes aproximadamente na parte mais grossa do dedo. No diagnóstico privado, os snaps multiponto percorrem a faixa ao redor, grudam no contorno físico de cada lado e procuram a maior largura que forme uma constante estável.</span>
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

          {tryOn && result && commercialRingSize!==null && (
            <TryOnPanel
              ringSize={commercialRingSize}
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
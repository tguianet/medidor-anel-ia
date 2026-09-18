import { useEffect, useMemo, useRef, useState } from "react";
import { calibratePhoto, cardMatchesLiveGuide } from "./vision";
import AdminCalibration from "./AdminCalibration";
import { clamp, computeRingResult, type CalibrationRule } from "./ringCalculation";
import { homographyFromQuad, quadFromLines, distance, type Line, type Point } from "./perspective";
import { useCameraStream } from "./useCameraStream";
import type { CardEdge, DragTarget, FingerMeasureStep, MeasurePhase, MeasurementMode, RingMetal, RingStyle, Stage } from "./types";
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
      setCardQuad(quad.percent);
      setPerspectiveReady(true);
      const bottomY=(quad.percent[2].y+quad.percent[3].y)/2;
      setCardLeft(quad.percent[3].x);
      setCardRight(quad.percent[2].x);
      setCardBottom(bottomY);
      activateFingerMeasurement(quad.percent[3].x,quad.percent[2].x,bottomY,calibrationConfidence||92,quad.percent);
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
    setCalibrationConfidence((current)=>Math.max(current,confidence));
    setLeftLine(38);
    setRightLine(62);
    setMeasureY(clamp(baseBottom+17,42,76));
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
    if(target==="left"||target==="right") snapBoundary(target,event.clientX);
    if(typeof target==="string"&&target.startsWith("card-line-")){
      const match=/^card-line-(top|right|bottom|left)/.exec(target);
      if(match) snapCardLine(match[1] as CardEdge);
    }
    draggingRef.current=null;
    cardLineDragStartRef.current=null;
  };

  const fingerBandEdgesPx = () => {
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
    const widths: {left:number;right:number;y:number;width:number}[] = [];
    for (const offset of [-18, -12, -6, 0, 6, 12, 18]) {
      const y = Math.round(imageY + offset);
      if (y < 3 || y >= source.height - 3) continue;
      const leftEdge = findEdge(leftCenter, y);
      const rightEdge = findEdge(rightCenter, y);
      if (leftEdge.score < 10 || rightEdge.score < 10 || rightEdge.x <= leftEdge.x) continue;
      widths.push({left:leftEdge.x,right:rightEdge.x,y,width:rightEdge.x-leftEdge.x});
    }
    if (widths.length < 4) return null;
    widths.sort((a,b)=>a.width-b.width);
    return widths[Math.round((widths.length-1)*0.65)];
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
    const edge=fingerBandEdgesPx();
    const toImageX=(percent:number)=>((((percent/100*rect.width)-rect.width/2-panX)/zoom+rect.width/2)/rect.width*source.width);
    const imageY=(((measureY/100*rect.height)-rect.height/2-panY)/zoom+rect.height/2)/rect.height*source.height;
    const leftPx=edge?.left??toImageX(leftLine);
    const rightPx=edge?.right??toImageX(rightLine);
    const yPx=edge?.y??imageY;
    const fingerWidthPx=Math.abs(rightPx-leftPx);

    // MA is now normalized only by the card's projected width at the same
    // image height. Moving the camera closer/farther changes both values by
    // the same factor, so the ratio remains stable.
    const cardReferencePx=cardWidthAtImageY(yPx,source.width,source.height);
    if(cardReferencePx && cardReferencePx>0){
      return fingerWidthPx/cardReferencePx*85.6;
    }

    // Defensive fallback: use the confirmed bottom edge of the physical card,
    // never the complete image width.
    const cardBottomPx=Math.hypot(
      (cardQuad[2].x-cardQuad[3].x)/100*source.width,
      (cardQuad[2].y-cardQuad[3].y)/100*source.height,
    );
    if(cardBottomPx<=0) return null;
    return fingerWidthPx/cardBottomPx*85.6;
  },[pixelsPerMm,leftLine,rightLine,measureY,zoom,panX,panY,leftLocked,rightLocked,cardQuad,cardLines]);

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
    return computeRingResult(widthMm, calibrationRules, measurementMode === "anelimetro");
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
              <small>Os cruzamentos das linhas definem os 4 cantos usados na correção de perspectiva.</small>
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
                <>
                  <span>Modo dedo: curva do anelímetro não aplicada</span>
                  {result.fingerFitOffset !== 0 && <span>Ajuste de dedo real: +{result.fingerFitOffset} aro</span>}
                </>
              )}
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

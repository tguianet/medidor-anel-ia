export type NormalizedLandmark = {
  x:number;
  y:number;
  z:number;
  visibility?:number;
};

export type FingerName = "index"|"middle"|"ring"|"pinky";

export type FingerAnatomy = {
  finger:FingerName;
  confidence:number;
  ringRegionY:number;
  jointRegionY:number;
  axisAngleDeg:number;
  mcp:NormalizedLandmark;
  pip:NormalizedLandmark;
  dip:NormalizedLandmark;
  tip:NormalizedLandmark;
};

export type HandLandmarkAnalysis = {
  available:boolean;
  detected:boolean;
  score:number;
  handedness:string|null;
  landmarks:NormalizedLandmark[];
  measuredFinger:FingerAnatomy|null;
  error:string|null;
};

type MediaPipeModule = {
  FilesetResolver:{
    forVisionTasks:(url:string)=>Promise<unknown>;
  };
  HandLandmarker:{
    createFromOptions:(vision:unknown, options:unknown)=>Promise<{
      detect:(image:HTMLImageElement)=>{
        landmarks?:NormalizedLandmark[][];
        handednesses?:{categoryName?:string;score?:number}[][];
      };
      close?:()=>void;
    }>;
  };
};

const MP_VERSION="0.10.22";
const MP_ESM_URL=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/+esm`;
const MP_WASM_URL=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const HAND_MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let modulePromise:Promise<MediaPipeModule>|null=null;
let landmarkerPromise:Promise<Awaited<ReturnType<MediaPipeModule["HandLandmarker"]["createFromOptions"]>>>|null=null;

const dynamicImport=(url:string)=>
  (new Function("url","return import(url)") as (url:string)=>Promise<MediaPipeModule>)(url);

const getModule=()=>{
  if(!modulePromise) modulePromise=dynamicImport(MP_ESM_URL);
  return modulePromise;
};

const getLandmarker=async()=>{
  if(!landmarkerPromise){
    landmarkerPromise=(async()=>{
      const mp=await getModule();
      const vision=await mp.FilesetResolver.forVisionTasks(MP_WASM_URL);
      return mp.HandLandmarker.createFromOptions(vision,{
        baseOptions:{
          modelAssetPath:HAND_MODEL_URL,
          delegate:"GPU",
        },
        runningMode:"IMAGE",
        numHands:1,
        minHandDetectionConfidence:0.45,
        minHandPresenceConfidence:0.45,
        minTrackingConfidence:0.45,
      });
    })();
  }
  return landmarkerPromise;
};

const loadImage=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(new Error("image-load-failed"));
  image.src=src;
});

const FINGER_IDS:Record<FingerName,[number,number,number,number]>={
  index:[5,6,7,8],
  middle:[9,10,11,12],
  ring:[13,14,15,16],
  pinky:[17,18,19,20],
};

const dist=(a:NormalizedLandmark,b:NormalizedLandmark)=>
  Math.hypot(a.x-b.x,a.y-b.y);

const pointOnSegment=(a:NormalizedLandmark,b:NormalizedLandmark,t:number):NormalizedLandmark=>({
  x:a.x+(b.x-a.x)*t,
  y:a.y+(b.y-a.y)*t,
  z:a.z+(b.z-a.z)*t,
});

const angleFromVertical=(a:NormalizedLandmark,b:NormalizedLandmark)=>
  Math.atan2(b.x-a.x,b.y-a.y)*180/Math.PI;

export const inferFingerAnatomy = (
  landmarks:NormalizedLandmark[],
  measurementCenterX:number,
):FingerAnatomy|null => {
  if(landmarks.length<21) return null;

  const candidates=(Object.keys(FINGER_IDS) as FingerName[]).map((finger)=>{
    const [mcpId,pipId,dipId,tipId]=FINGER_IDS[finger];
    const mcp=landmarks[mcpId];
    const pip=landmarks[pipId];
    const dip=landmarks[dipId];
    const tip=landmarks[tipId];

    // Região onde um anel repousa: terço proximal entre MCP e PIP.
    // Junta usada apenas como informação anatômica: PIP.
    const ringPoint=pointOnSegment(mcp,pip,0.38);
    const fingerLength=Math.max(0.001,dist(mcp,tip));
    const xDistance=Math.abs(ringPoint.x-measurementCenterX);
    const geometryScore=Math.max(0,1-xDistance/Math.max(0.08,fingerLength*0.6));

    return {
      finger,
      confidence:Math.round(geometryScore*100),
      ringRegionY:ringPoint.y,
      jointRegionY:pip.y,
      axisAngleDeg:angleFromVertical(mcp,pip),
      mcp,pip,dip,tip,
    };
  }).sort((a,b)=>b.confidence-a.confidence);

  return candidates[0]?.confidence>=35 ? candidates[0] : null;
};

export const analyzeHandLandmarks = async(
  imageSrc:string,
  measurementCenterX:number,
):Promise<HandLandmarkAnalysis>=>{
  try{
    const image=await loadImage(imageSrc);
    const landmarker=await getLandmarker();
    const result=landmarker.detect(image);
    const landmarks=result.landmarks?.[0] ?? [];
    const handedness=result.handednesses?.[0]?.[0] ?? null;

    if(landmarks.length<21){
      return {
        available:true,
        detected:false,
        score:0,
        handedness:null,
        landmarks:[],
        measuredFinger:null,
        error:"Mão não detectada por landmarks nesta captura.",
      };
    }

    const anatomy=inferFingerAnatomy(landmarks,measurementCenterX);
    const handedScore=Math.round((handedness?.score ?? .75)*100);
    const anatomyScore=anatomy?.confidence ?? 0;
    const score=Math.round(handedScore*.45+anatomyScore*.55);

    return {
      available:true,
      detected:true,
      score,
      handedness:handedness?.categoryName ?? null,
      landmarks,
      measuredFinger:anatomy,
      error:null,
    };
  }catch(error){
    return {
      available:false,
      detected:false,
      score:0,
      handedness:null,
      landmarks:[],
      measuredFinger:null,
      error:error instanceof Error ? error.message : "hand-landmarker-unavailable",
    };
  }
};

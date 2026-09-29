import type { Point } from "../perspective";

export type CameraQualityAssessment = {
  available:boolean;
  score:number|null;
  centerOffsetPercent:number|null;
  edgeStretchPercent:number|null;
  aspectErrorPercent:number|null;
  warning:string|null;
};

// Camada diagnostica: avalia risco geometrico da captura sem alterar a medida.
// O cartao continua sendo a referencia metrica oficial.
export const assessCameraCaptureQuality = (
  quad:[Point,Point,Point,Point] | null,
  imageWidth:number,
  imageHeight:number,
):CameraQualityAssessment => {
  if(!quad || imageWidth<=0 || imageHeight<=0){
    return {
      available:false,
      score:null,
      centerOffsetPercent:null,
      edgeStretchPercent:null,
      aspectErrorPercent:null,
      warning:null,
    };
  }

  const [tl,tr,br,bl]=quad;
  const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
  const top=dist(tl,tr);
  const bottom=dist(bl,br);
  const left=dist(tl,bl);
  const right=dist(tr,br);
  const avgW=(top+bottom)/2;
  const avgH=(left+right)/2;

  const centerX=(tl.x+tr.x+br.x+bl.x)/4;
  const centerY=(tl.y+tr.y+br.y+bl.y)/4;
  const centerOffsetPercent=Math.hypot(
    (centerX-imageWidth/2)/(imageWidth/2),
    (centerY-imageHeight/2)/(imageHeight/2),
  )*100;

  const widthPerspective=Math.abs(top-bottom)/Math.max(1e-6,avgW);
  const heightPerspective=Math.abs(left-right)/Math.max(1e-6,avgH);
  const edgeStretchPercent=Math.max(widthPerspective,heightPerspective)*100;

  const expectedAspect=85.6/53.98;
  const observedAspect=avgW/Math.max(1e-6,avgH);
  const aspectErrorPercent=Math.abs(observedAspect-expectedAspect)/expectedAspect*100;

  const penalty=
    Math.min(30,centerOffsetPercent*.22)+
    Math.min(38,edgeStretchPercent*1.45)+
    Math.min(32,aspectErrorPercent*1.15);

  const score=Math.max(0,Math.min(100,Math.round(100-penalty)));

  let warning:string|null=null;
  if(edgeStretchPercent>16) warning="Perspectiva forte: alinhe melhor o celular.";
  else if(aspectErrorPercent>24) warning="Geometria do cartão fora do esperado.";
  else if(centerOffsetPercent>45) warning="Mantenha cartão e dedo mais próximos do centro da câmera.";

  return {
    available:true,
    score,
    centerOffsetPercent,
    edgeStretchPercent,
    aspectErrorPercent,
    warning,
  };
};

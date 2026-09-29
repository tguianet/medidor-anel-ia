import { useState } from "react";

type Point={x:number;y:number};

type DetectionResult={
  corners:[Point,Point,Point,Point];
  confidence:number;
  aspectRatio:number;
  areaPercent:number;
  widthPx:number;
  heightPx:number;
  mmPerPx:number;
};

declare global {
  interface Window {
    cv?: any;
    __opencvCardPromise?: Promise<any>;
  }
}

const OPENCV_URL="https://docs.opencv.org/4.x/opencv.js";
const CARD_RATIO=85.6/53.98;

const withTimeout=<T,>(promise:Promise<T>,ms:number,message:string)=>
  new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error(message)),ms);
    promise.then(
      value=>{ window.clearTimeout(timer); resolve(value); },
      error=>{ window.clearTimeout(timer); reject(error); },
    );
  });

const waitForOpenCvRuntime=async()=>{
  const started=Date.now();

  while(Date.now()-started<18000){
    const current=window.cv;

    if(current?.Mat) return current;

    if(current && typeof current.then==="function"){
      const ready=await withTimeout(
        Promise.resolve(current),
        15000,
        "OpenCV carregou o script, mas o runtime não iniciou.",
      );
      if(ready?.Mat) return ready;
    }

    await new Promise(resolve=>window.setTimeout(resolve,100));
  }

  throw new Error("OpenCV não iniciou em até 18 segundos. Toque em tentar novamente.");
};

const loadOpenCv=async()=>{
  if(window.cv?.Mat) return window.cv;
  if(window.__opencvCardPromise) return window.__opencvCardPromise;

  window.__opencvCardPromise=(async()=>{
    let script=document.querySelector<HTMLScriptElement>('script[data-opencv-card-test="1"]');

    if(!script){
      script=document.createElement("script");
      script.src=OPENCV_URL;
      script.async=true;
      script.dataset.opencvCardTest="1";

      const loaded=new Promise<void>((resolve,reject)=>{
        script!.addEventListener("load",()=>resolve(),{once:true});
        script!.addEventListener("error",()=>reject(new Error("Falha ao baixar OpenCV.js.")),{once:true});
      });

      document.head.appendChild(script);

      // Não dependemos só do evento load. Em alguns celulares o runtime WASM
      // termina depois do script; em outros o script pode estar em cache.
      await withTimeout(loaded,12000,"OpenCV.js demorou para baixar.");
    }

    // Se o script já existia, o evento load pode ter acontecido antes deste
    // clique. Por isso SEMPRE verificamos diretamente o runtime aqui.
    return waitForOpenCvRuntime();
  })();

  try{
    return await window.__opencvCardPromise;
  }catch(error){
    // Permite uma nova tentativa limpa depois de qualquer falha.
    window.__opencvCardPromise=undefined;
    const stale=document.querySelector<HTMLScriptElement>('script[data-opencv-card-test="1"]');
    if(stale && !window.cv?.Mat) stale.remove();
    throw error;
  }
};

const imageFromSrc=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>resolve(img);
  img.onerror=()=>reject(new Error("Não foi possível abrir a foto."));
  img.src=src;
});

const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);

const orderCorners=(points:Point[]):[Point,Point,Point,Point]=>{
  const bySum=[...points].sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const tl=bySum[0];
  const br=bySum[bySum.length-1];
  const remaining=points.filter(p=>p!==tl&&p!==br);
  const [tr,bl]=remaining[0].x>remaining[1].x
    ? [remaining[0],remaining[1]]
    : [remaining[1],remaining[0]];
  return [tl,tr,br,bl];
};

const detectCard=async(photo:string):Promise<DetectionResult>=>{
  const cv=await loadOpenCv();
  const image=await imageFromSrc(photo);

  const source=cv.imread(image);
  const scale=Math.min(1,900/Math.max(source.cols,source.rows));
  const work=new cv.Mat();

  if(scale<1){
    cv.resize(
      source,
      work,
      new cv.Size(Math.round(source.cols*scale),Math.round(source.rows*scale)),
      0,0,
      cv.INTER_AREA,
    );
  }else{
    source.copyTo(work);
  }

  const gray=new cv.Mat();
  const blur=new cv.Mat();
  const edges=new cv.Mat();
  const closed=new cv.Mat();
  const contours=new cv.MatVector();
  const hierarchy=new cv.Mat();
  const kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));

  try{
    cv.cvtColor(work,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);
    cv.Canny(blur,edges,55,155,3,false);
    cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
    cv.findContours(closed,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);

    const imageArea=work.cols*work.rows;
    let best:{score:number;corners:[Point,Point,Point,Point];ratio:number;area:number;width:number;height:number}|null=null;

    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      const area=Math.abs(cv.contourArea(contour,false));
      if(area<imageArea*0.025 || area>imageArea*0.92){
        contour.delete();
        continue;
      }

      const perimeter=cv.arcLength(contour,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(contour,approx,perimeter*0.02,true);

      if(approx.rows===4 && cv.isContourConvex(approx)){
        const raw=approx.data32S;
        const pts:Point[]=[];
        for(let j=0;j<8;j+=2) pts.push({x:raw[j],y:raw[j+1]});
        const corners=orderCorners(pts);
        const [tl,tr,br,bl]=corners;

        const width=(distance(tl,tr)+distance(bl,br))/2;
        const height=(distance(tl,bl)+distance(tr,br))/2;
        const ratioRaw=width/Math.max(1,height);
        const ratio=ratioRaw>=1?ratioRaw:1/ratioRaw;
        const ratioError=Math.abs(ratio-CARD_RATIO)/CARD_RATIO;
        const areaPercent=area/imageArea*100;

        // O cartão real é 85,60 x 53,98 mm. Mantemos tolerância larga aqui
        // porque este campo é experimental e precisa mostrar candidatos mesmo
        // com alguma perspectiva.
        if(ratioError<0.42){
          const ratioScore=Math.max(0,1-ratioError/0.42);
          const areaScore=Math.min(1,areaPercent/22);
          const score=ratioScore*72+areaScore*28;
          if(!best || score>best.score){
            best={score,corners,ratio,area:areaPercent,width,height};
          }
        }
      }

      approx.delete();
      contour.delete();
    }

    if(!best) throw new Error("Nenhum quadrilátero compatível com cartão foi encontrado.");

    const toOriginal=(p:Point):Point=>({x:p.x/scale,y:p.y/scale});
    const corners=best.corners.map(toOriginal) as [Point,Point,Point,Point];
    const widthPx=best.width/scale;
    const heightPx=best.height/scale;

    return {
      corners,
      confidence:Math.round(Math.min(100,best.score)),
      aspectRatio:best.ratio,
      areaPercent:best.area,
      widthPx,
      heightPx,
      mmPerPx:85.6/Math.max(1,widthPx),
    };
  }finally{
    source.delete();
    work.delete();
    gray.delete();
    blur.delete();
    edges.delete();
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
};

export default function OpenCvCardTest({photo}:{photo:string}){
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState("");
  const [result,setResult]=useState<DetectionResult|null>(null);
  const [error,setError]=useState("");

  const run=async()=>{
    if(!photo) return;
    setLoading(true);
    setStatus("Carregando OpenCV...");
    setError("");
    setResult(null);
    try{
      const detected=await withTimeout(
        detectCard(photo),
        25000,
        "A análise excedeu 25 segundos e foi cancelada.",
      );
      setStatus("Análise concluída.");
      setResult(detected);
    }catch(err){
      setStatus("");
      setError(err instanceof Error?err.message:"Falha na detecção OpenCV.");
    }finally{
      setLoading(false);
    }
  };

  const points=result?.corners.map(p=>`${p.x},${p.y}`).join(" ");

  return (
    <section style={{
      marginTop:14,
      padding:14,
      border:"1px solid rgba(82,224,163,.42)",
      borderRadius:16,
      background:"rgba(7,20,17,.94)",
      display:"grid",
      gap:10,
    }}>
      <div>
        <strong style={{display:"block"}}>TESTE OPENCV · CARTÃO AUTOMÁTICO</strong>
        <small style={{opacity:.78}}>Canny + fechamento morfológico + contornos + approxPolyDP. Este teste não altera a medição atual.</small>
      </div>

      <button className="secondary" type="button" onClick={()=>void run()} disabled={!photo||loading}>
        {loading?"Analisando cartão...":"Detectar cartão com OpenCV"}
      </button>

      {loading && <span style={{opacity:.76,fontSize:13}}>{status || "Processando imagem..."}</span>}
      {error && (
        <div style={{display:"grid",gap:8}}>
          <span style={{color:"#ffb0a8"}}>{error}</span>
          <button className="secondary" type="button" onClick={()=>void run()}>
            Tentar novamente
          </button>
        </div>
      )}

      {result && (
        <>
          <div style={{position:"relative",overflow:"hidden",borderRadius:12,background:"#000"}}>
            <img src={photo} alt="Teste OpenCV do cartão" style={{display:"block",width:"100%",height:"auto"}} />
            <svg
              viewBox={`0 0 ${Math.max(...result.corners.map(p=>p.x))*1.001} ${Math.max(...result.corners.map(p=>p.y))*1.001}`}
              preserveAspectRatio="none"
              style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}
            >
              <polygon points={points} fill="rgba(82,224,163,.12)" stroke="#52e0a3" strokeWidth="5" vectorEffect="non-scaling-stroke" />
              {result.corners.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="8" fill="#ffd86b" />)}
            </svg>
          </div>
          <div style={{display:"grid",gap:4,fontSize:13}}>
            <span>Confiança experimental: <strong>{result.confidence}/100</strong></span>
            <span>Proporção detectada: <strong>{result.aspectRatio.toFixed(3)}</strong> · cartão real {CARD_RATIO.toFixed(3)}</span>
            <span>Área na imagem: <strong>{result.areaPercent.toFixed(1)}%</strong></span>
            <span>Largura detectada: <strong>{result.widthPx.toFixed(1)} px</strong></span>
            <span>Escala candidata: <strong>{result.mmPerPx.toFixed(4)} mm/px</strong></span>
            <small style={{opacity:.72}}>Por enquanto é diagnóstico. Não substitui as interseções A-B de 85,60 mm.</small>
          </div>
        </>
      )}
    </section>
  );
}

import { useRef, useState } from "react";

type Point={x:number;y:number};

type DetectionResult={
  corners:[Point,Point,Point,Point];
  confidence:number;
  aspectRatio:number;
  areaPercent:number;
  widthPx:number;
  heightPx:number;
  mmPerPx:number;
  imageWidth:number;
  imageHeight:number;
};

const CARD_RATIO=85.6/53.98;

const imageFromSrc=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>resolve(img);
  img.onerror=()=>reject(new Error("Não foi possível abrir a foto."));
  img.src=src;
});

const prepareImageData=async(photo:string)=>{
  const img=await imageFromSrc(photo);

  // Mantem o processamento leve no celular. O OpenCV recebe no maximo 640 px
  // no maior lado, suficiente para detectar o quadrilatero do cartao.
  const scale=Math.min(1,640/Math.max(img.naturalWidth,img.naturalHeight));
  const width=Math.max(1,Math.round(img.naturalWidth*scale));
  const height=Math.max(1,Math.round(img.naturalHeight*scale));

  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx) throw new Error("Canvas indisponível.");

  ctx.drawImage(img,0,0,width,height);
  return ctx.getImageData(0,0,width,height);
};

const detectInWorker=async(photo:string,onStatus:(text:string)=>void):Promise<DetectionResult>=>{
  onStatus("Preparando imagem...");
  const imageData=await prepareImageData(photo);

  onStatus("OpenCV trabalhando em segundo plano...");

  return new Promise<DetectionResult>((resolve,reject)=>{
    const worker=new Worker("/opencv-card-worker.js");
    const timer=window.setTimeout(()=>{
      worker.terminate();
      reject(new Error("A análise excedeu 30 segundos e foi encerrada."));
    },30000);

    const finish=()=>{
      window.clearTimeout(timer);
      worker.terminate();
    };

    worker.onerror=()=>{
      finish();
      reject(new Error("Falha ao iniciar o processador OpenCV."));
    };

    worker.onmessage=(event)=>{
      const data=event.data;
      if(data?.type==="result"){
        finish();
        resolve(data.result as DetectionResult);
      }else if(data?.type==="error"){
        finish();
        reject(new Error(data.message || "Falha no OpenCV."));
      }
    };

    worker.postMessage({
      type:"detect",
      width:imageData.width,
      height:imageData.height,
      buffer:imageData.data.buffer,
    },[imageData.data.buffer]);
  });
};

export default function OpenCvCardTest({photo}:{photo:string}){
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState("");
  const [result,setResult]=useState<DetectionResult|null>(null);
  const [error,setError]=useState("");
  const runIdRef=useRef(0);

  const run=async()=>{
    if(!photo || loading) return;

    const runId=++runIdRef.current;
    setLoading(true);
    setStatus("Iniciando teste...");
    setError("");
    setResult(null);

    try{
      const detected=await detectInWorker(photo,(text)=>{
        if(runIdRef.current===runId) setStatus(text);
      });
      if(runIdRef.current!==runId) return;
      setResult(detected);
      setStatus("Análise concluída.");
    }catch(err){
      if(runIdRef.current!==runId) return;
      setStatus("");
      setError(err instanceof Error?err.message:"Falha na detecção OpenCV.");
    }finally{
      if(runIdRef.current===runId) setLoading(false);
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
        <small style={{opacity:.78}}>Agora roda em Web Worker separado. O teste não altera a medição atual.</small>
      </div>

      <button className="secondary" type="button" onClick={()=>void run()} disabled={!photo||loading}>
        {loading?"Analisando em segundo plano...":"Detectar cartão com OpenCV"}
      </button>

      {loading && <span style={{opacity:.76,fontSize:13}}>{status}</span>}

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
              viewBox={`0 0 ${result.imageWidth} ${result.imageHeight}`}
              preserveAspectRatio="none"
              style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}
            >
              <polygon points={points} fill="rgba(82,224,163,.12)" stroke="#52e0a3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              {result.corners.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="5" fill="#ffd86b" />)}
            </svg>
          </div>
          <div style={{display:"grid",gap:4,fontSize:13}}>
            <span>Confiança experimental: <strong>{result.confidence}/100</strong></span>
            <span>Proporção detectada: <strong>{result.aspectRatio.toFixed(3)}</strong> · cartão real {CARD_RATIO.toFixed(3)}</span>
            <span>Área na imagem: <strong>{result.areaPercent.toFixed(1)}%</strong></span>
            <span>Largura detectada: <strong>{result.widthPx.toFixed(1)} px</strong></span>
            <span>Escala candidata: <strong>{result.mmPerPx.toFixed(4)} mm/px</strong></span>
            <small style={{opacity:.72}}>Somente diagnóstico. Não substitui a calibração A-B de 85,60 mm.</small>
          </div>
        </>
      )}
    </section>
  );
}

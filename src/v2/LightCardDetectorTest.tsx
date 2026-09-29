import { useState } from "react";
import { calibratePhoto } from "../vision";

type LightResult={
  confidence:number;
  pixelsPerMm:number;
  mmPerPx:number;
  cardBox:{x:number;y:number;width:number;height:number};
  elapsedMs:number;
  naturalWidth:number;
  naturalHeight:number;
};

const imageSize=(src:string)=>new Promise<{width:number;height:number}>((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});
  img.onerror=()=>reject(new Error("Não foi possível abrir a foto."));
  img.src=src;
});

export type LightCardDetectionPayload={
  confidence:number;
  cardBox:{x:number;y:number;width:number;height:number};
};

export default function LightCardDetectorTest({
  photo,
  onApply,
}:{
  photo:string;
  onApply?:(payload:LightCardDetectionPayload)=>void;
}){
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<LightResult|null>(null);
  const [error,setError]=useState("");

  const run=async()=>{
    if(!photo || loading) return;
    setLoading(true);
    setError("");
    setResult(null);

    const started=performance.now();
    try{
      const [calibration,size]=await Promise.all([
        calibratePhoto(photo),
        imageSize(photo),
      ]);
      const elapsedMs=performance.now()-started;
      setResult({
        confidence:calibration.confidence,
        pixelsPerMm:calibration.pixelsPerMm,
        mmPerPx:1/calibration.pixelsPerMm,
        cardBox:calibration.cardBox,
        elapsedMs,
        naturalWidth:size.width,
        naturalHeight:size.height,
      });
    }catch(err){
      setError(err instanceof Error?err.message:"Falha no detector leve.");
    }finally{
      setLoading(false);
    }
  };

  const box=result?.cardBox;
  const widthPx=result&&box ? box.width*result.naturalWidth : null;
  const heightPx=result&&box ? box.height*result.naturalHeight : null;
  const ratio=widthPx&&heightPx ? Math.max(widthPx,heightPx)/Math.max(1,Math.min(widthPx,heightPx)) : null;

  return (
    <section style={{
      marginTop:14,
      padding:14,
      border:"1px solid rgba(255,216,107,.48)",
      borderRadius:16,
      background:"rgba(30,24,12,.94)",
      display:"grid",
      gap:10,
    }}>
      <div>
        <strong style={{display:"block"}}>TESTE · DETECTOR LEVE DO CARTÃO</strong>
        <small style={{opacity:.78}}>
          JavaScript puro · bordas + forma retangular + proporção 85,60 × 53,98 mm. Sem OpenCV.
        </small>
      </div>

      <button className="secondary" type="button" onClick={()=>void run()} disabled={!photo||loading}>
        {loading?"Analisando...":"Testar detector leve"}
      </button>

      {error && <span style={{color:"#ffb0a8"}}>{error}</span>}

      {result && box && (
        <>
          <div style={{position:"relative",overflow:"hidden",borderRadius:12,background:"#000"}}>
            <img src={photo} alt="Detecção leve do cartão" style={{display:"block",width:"100%",height:"auto"}} />
            <div
              aria-hidden="true"
              style={{
                position:"absolute",
                left:`${box.x*100}%`,
                top:`${box.y*100}%`,
                width:`${box.width*100}%`,
                height:`${box.height*100}%`,
                border:"3px solid #ffd86b",
                boxShadow:"0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.45)",
                background:"rgba(255,216,107,.08)",
                pointerEvents:"none",
              }}
            />
          </div>

          <div style={{display:"grid",gap:4,fontSize:13}}>
            <span>Tempo: <strong>{result.elapsedMs.toFixed(0)} ms</strong></span>
            <span>Confiança: <strong>{result.confidence}/100</strong></span>
            <span>Caixa detectada: <strong>{(box.width*100).toFixed(1)}% × {(box.height*100).toFixed(1)}%</strong></span>
            <span>Proporção aparente: <strong>{ratio?.toFixed(3) ?? "n/d"}</strong> · cartão real 1,586</span>
            <span>Largura candidata: <strong>{widthPx?.toFixed(1) ?? "n/d"} px</strong></span>
            <span>Escala candidata: <strong>{result.mmPerPx.toFixed(4)} mm/px</strong></span>
            <small style={{opacity:.72}}>
              A detecção ainda não altera a fórmula. Você pode aplicar a caixa encontrada somente nas 3 linhas do cartão.
            </small>
          </div>

          <button
            className="primary"
            type="button"
            disabled={result.confidence<90}
            onClick={()=>onApply?.({
              confidence:result.confidence,
              cardBox:result.cardBox,
            })}
          >
            {result.confidence>=90
              ? "Aplicar detecção nas 3 linhas"
              : "Confiança insuficiente para aplicar"}
          </button>
        </>
      )}
    </section>
  );
}

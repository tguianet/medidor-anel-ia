import { useMemo, useRef, useState, type ReactNode } from "react";
import { calibratePhoto } from "../vision";
import { useCameraStream } from "../useCameraStream";
import { scaleFromLockedCardSides } from "./cardCalibration";
import { classifyFingerWidthMm, FINGER_REFERENCE_CURVE, INITIAL_REFERENCE_FINGER_WIDTH_MM } from "./ringClassifier";
import { PHYSICAL_RING_TABLE } from "./physicalRingTable";

type CapturedPhoto = {
  src: string;
  width: number;
  height: number;
};

export default function AppV2() {
  const camera=useCameraStream();
  const [fingerMm,setFingerMm]=useState(INITIAL_REFERENCE_FINGER_WIDTH_MM.toFixed(2));
  const [photo,setPhoto]=useState<CapturedPhoto|null>(null);
  const [cardLeftPct,setCardLeftPct]=useState(15);
  const [cardRightPct,setCardRightPct]=useState(85);
  const [cardTopPct,setCardTopPct]=useState(25);
  const [cardBottomPct,setCardBottomPct]=useState(70);
  const [fingerLeftPct,setFingerLeftPct]=useState(42);
  const [fingerRightPct,setFingerRightPct]=useState(58);
  const [fingerMeasureYPct,setFingerMeasureYPct]=useState(62);
  const [mmPerPx,setMmPerPx]=useState<number|null>(null);
  const [cardConfidence,setCardConfidence]=useState<number|null>(null);
  const [status,setStatus]=useState("Abra a camera e tire uma foto com o cartao junto do dedo.");
  const resultRef=useRef<HTMLElement|null>(null);

  const numericMm=Number(fingerMm.replace(",","."));
  const result=useMemo(()=>{
    try{
      return classifyFingerWidthMm(numericMm);
    }catch{
      return null;
    }
  },[numericMm]);

  const capturePhoto=async()=>{
    const video=camera.videoRef.current;
    if(!video?.videoWidth || !video.videoHeight){
      setStatus("A camera ainda nao esta pronta.");
      return;
    }

    const canvas=document.createElement("canvas");
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    const context=canvas.getContext("2d");
    if(!context){
      setStatus("Nao foi possivel ler a imagem.");
      return;
    }
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const src=canvas.toDataURL("image/jpeg",0.95);
    setPhoto({src,width:canvas.width,height:canvas.height});
    setMmPerPx(null);
    camera.stopCamera();
    setStatus("Localizando o cartao...");

    try{
      const calibration=await calibratePhoto(src);
      const left=Math.max(1,Math.min(97,calibration.cardBox.x*100));
      const right=Math.max(left+2,Math.min(99,(calibration.cardBox.x+calibration.cardBox.width)*100));
      const top=Math.max(1,Math.min(95,calibration.cardBox.y*100));
      const bottom=Math.max(top+2,Math.min(99,(calibration.cardBox.y+calibration.cardBox.height)*100));

      setCardLeftPct(left);
      setCardRightPct(right);
      setCardTopPct(top);
      setCardBottomPct(bottom);
      setCardConfidence(calibration.confidence);

      const center=(left+right)/2;
      const visualFingerWidth=Math.min(18,Math.max(8,(right-left)*0.22));
      setFingerLeftPct(Math.max(1,center-visualFingerWidth/2));
      setFingerRightPct(Math.min(99,center+visualFingerWidth/2));
      setFingerMeasureYPct(Math.max(38,Math.min(88,bottom+18)));
      setStatus("Cartao localizado. Ajuste somente se precisar e calibre.");
    }catch{
      setCardConfidence(null);
      setStatus("Nao localizei o cartao automaticamente. Ajuste as duas linhas azuis nas laterais do cartao.");
    }
  };

  const calibrateCard=()=>{
    if(!photo) return;
    const top=cardTopPct/100*photo.height;
    const bottom=cardBottomPct/100*photo.height;
    const leftX=cardLeftPct/100*photo.width;
    const rightX=cardRightPct/100*photo.width;

    try{
      const scale=scaleFromLockedCardSides(
        {a:{x:leftX,y:top},b:{x:leftX,y:bottom}},
        {a:{x:rightX,y:top},b:{x:rightX,y:bottom}},
      );
      setMmPerPx(scale.mmPerPx);
      setStatus("Cartao calibrado. Agora posicione as duas linhas verdes nas bordas reais do dedo.");
    }catch{
      setMmPerPx(null);
      setStatus("As laterais do cartao nao formaram uma referencia valida.");
    }
  };

  const measureFinger=async()=>{
    if(!photo || !mmPerPx){
      setStatus("Calibre o cartao primeiro.");
      return;
    }

    setStatus("Detectando automaticamente as duas bordas do dedo...");

    try{
      const image=new Image();
      image.src=photo.src;
      await image.decode();

      const canvas=document.createElement("canvas");
      canvas.width=photo.width;
      canvas.height=photo.height;
      const context=canvas.getContext("2d",{willReadFrequently:true});
      if(!context) throw new Error("pixels");
      context.drawImage(image,0,0,photo.width,photo.height);
      const pixels=context.getImageData(0,0,photo.width,photo.height).data;

      const gray=(x:number,y:number)=>{
        const ix=Math.max(0,Math.min(photo.width-1,Math.round(x)));
        const iy=Math.max(0,Math.min(photo.height-1,Math.round(y)));
        const o=(iy*photo.width+ix)*4;
        return pixels[o]*0.299+pixels[o+1]*0.587+pixels[o+2]*0.114;
      };

      const seedLeft=fingerLeftPct/100*photo.width;
      const seedRight=fingerRightPct/100*photo.width;
      const centerY=fingerMeasureYPct/100*photo.height;
      const searchRadius=Math.max(18,Math.round(photo.width*0.075));
      const rowStep=Math.max(2,Math.round(photo.height*0.006));
      const rowOffsets=[-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6].map(v=>v*rowStep);

      const findEdge=(seedX:number,y:number)=>{
        let bestX=seedX;
        let bestScore=-Infinity;
        for(let x=Math.round(seedX-searchRadius);x<=Math.round(seedX+searchRadius);x++){
          if(x<5||x>=photo.width-5) continue;
          const contrast=Math.abs(gray(x-3,y)-gray(x+3,y));
          const distancePenalty=Math.abs(x-seedX)*0.18;
          const score=contrast-distancePenalty;
          if(score>bestScore){
            bestScore=score;
            bestX=x;
          }
        }
        return {x:bestX,score:bestScore};
      };

      const samples:{left:number;right:number;width:number;score:number}[]=[];
      for(const off of rowOffsets){
        const y=Math.round(centerY+off);
        if(y<6||y>=photo.height-6) continue;
        const left=findEdge(seedLeft,y);
        const right=findEdge(seedRight,y);
        if(left.score<6||right.score<6||right.x<=left.x) continue;
        samples.push({
          left:left.x,
          right:right.x,
          width:right.x-left.x,
          score:(left.score+right.score)/2,
        });
      }

      if(samples.length<7){
        throw new Error("not-enough-edges");
      }

      const median=(values:number[])=>{
        const ordered=[...values].sort((a,b)=>a-b);
        const mid=Math.floor(ordered.length/2);
        return ordered.length%2?ordered[mid]:(ordered[mid-1]+ordered[mid])/2;
      };

      const medianWidth=median(samples.map(s=>s.width));
      const stable=samples.filter(s=>Math.abs(s.width-medianWidth)<=Math.max(3,medianWidth*0.035));
      if(stable.length<5) throw new Error("unstable-edge");

      const measuredWidthPx=median(stable.map(s=>s.width));
      const detectedLeft=median(stable.map(s=>s.left));
      const detectedRight=median(stable.map(s=>s.right));
      const measuredMm=measuredWidthPx*mmPerPx;

      if(!Number.isFinite(measuredMm) || measuredMm<=0){
        throw new Error("invalid-mm");
      }

      setFingerLeftPct(detectedLeft/photo.width*100);
      setFingerRightPct(detectedRight/photo.width*100);
      setFingerMm(measuredMm.toFixed(3));

      const classification=classifyFingerWidthMm(measuredMm);
      setStatus(`Medicao automatica: ${measuredWidthPx.toFixed(1)} px = ${measuredMm.toFixed(3)} mm -> aro ${classification.exactRingSize} (conforto ${classification.comfortRingSize}).`);
      window.setTimeout(()=>{
        resultRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
      },80);
    }catch{
      setStatus("Nao consegui travar as duas bordas automaticamente. Ajuste as linhas verdes mais perto das laterais do dedo e tente novamente.");
    }
  };

  return (
    <main className="v2-page" style={{fontFamily:"Inter,system-ui,sans-serif",maxWidth:980,margin:"0 auto",padding:"24px"}}>
      <style>{`
        .v2-page *{box-sizing:border-box}\n        .v2-page{color:#f7f1e6;background:#0d0b08;min-height:100vh}\n        .v2-card{background:#17130f;border:1px solid #6f5b39!important;color:#f7f1e6}\n        .v2-light{background:#f7f7f7!important;color:#111!important}\n        .v2-result-banner{background:#1d1811;border:2px solid #d5a84f;border-radius:16px;padding:18px;margin-bottom:16px;color:#fff}\n        .v2-result-number{font-size:52px;font-weight:900;line-height:1;color:#f2c35f}
        .v2-camera-wrap{position:relative;width:100%;background:#111;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center}
        .v2-camera-video{display:block;width:100%;height:auto;max-height:72vh;object-fit:contain;background:#111}
        .v2-photo{display:block;width:100%;height:auto;max-height:72vh;object-fit:contain}
        .v2-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
        .v2-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.7fr);gap:18px;align-items:start}
        .v2-ranges{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
        .v2-metrics{margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        @media (max-width:700px){
          .v2-page{padding:12px!important}
          .v2-page h1{font-size:26px!important;line-height:1.08}
          .v2-grid{grid-template-columns:1fr}
          .v2-ranges{grid-template-columns:1fr}
          .v2-metrics{grid-template-columns:1fr 1fr}
          .v2-actions{display:grid;grid-template-columns:1fr 1fr}
          .v2-actions button:last-child:nth-child(odd){grid-column:1/-1}
          .v2-camera-video,.v2-photo{max-height:68vh}
        }
        @media (max-width:430px){
          .v2-actions{grid-template-columns:1fr}
          .v2-actions button{width:100%}
          .v2-actions button:last-child:nth-child(odd){grid-column:auto}
          .v2-metrics{grid-template-columns:1fr}
        }
      `}</style>
      <header style={{marginBottom:24}}>
        <div style={{fontSize:12,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",opacity:.6}}>Medidor de Anel 2.0</div>
        <h1 style={{margin:"6px 0 8px",fontSize:32}}>Laboratorio limpo V2</h1>
        <p style={{margin:0,opacity:.72,lineHeight:1.5}}>
          Camera e cartao medem apenas milimetros. Depois, uma funcao separada converte mm em aro pela tabela fisica.
        </p>
      </header>

      <section className="v2-card" style={{borderRadius:16,padding:20,marginBottom:20}}>
        <h2 style={{marginTop:0,fontSize:22}}>1. Camera + calibracao do cartao</h2>

        {!photo && (
          <>
            <div className="v2-camera-wrap">
              <video ref={camera.videoRef} playsInline muted className="v2-camera-video" />
              {camera.cameraOpening && <OverlayText>Abrindo camera...</OverlayText>}
            </div>
            <div className="v2-actions">
              <button onClick={()=>void camera.startCameraStream()} style={buttonStyle}>Abrir camera</button>
              <button onClick={()=>void capturePhoto()} style={buttonStyle}>Tirar foto</button>
              {camera.torchSupported && <button onClick={()=>void camera.toggleTorch()} style={buttonStyle}>{camera.torchOn?"Desligar flash":"Ligar flash"}</button>}
            </div>
          </>
        )}

        {photo && (
          <>
            <div className="v2-camera-wrap">
              <img src={photo.src} alt="Captura V2" className="v2-photo" />
              <Guide pct={cardLeftPct} color="#1976d2" label="cartao E" />
              <Guide pct={cardRightPct} color="#1976d2" label="cartao D" />
              <Guide pct={fingerLeftPct} color="#00a86b" label="dedo E" />
              <Guide pct={fingerRightPct} color="#00a86b" label="dedo D" />
              <HorizontalGuide pct={fingerMeasureYPct} />
            </div>

            <div className="v2-ranges">
              <Range label="Cartao esquerda" value={cardLeftPct} onChange={setCardLeftPct} />
              <Range label="Cartao direita" value={cardRightPct} onChange={setCardRightPct} />
              <Range label="Dedo esquerda" value={fingerLeftPct} onChange={setFingerLeftPct} />
              <Range label="Dedo direita" value={fingerRightPct} onChange={setFingerRightPct} />
              <Range label="Altura da medicao" value={fingerMeasureYPct} onChange={setFingerMeasureYPct} />
            </div>

            <div className="v2-actions">
              <button onClick={calibrateCard} style={buttonStyle}>Calibrar cartao</button>
              <button onClick={()=>void measureFinger()} style={buttonStyle}>Medir dedo automaticamente</button>
              <button onClick={()=>{setPhoto(null);setMmPerPx(null);setStatus("Abra a camera e tire uma nova foto.");}} style={buttonStyle}>Nova foto</button>
            </div>

            <div className="v2-light" style={{marginTop:14,padding:12,borderRadius:12,fontSize:14,lineHeight:1.5}}>
              <strong>Status:</strong> {status}<br/>
              {cardConfidence!==null && <>Confianca da localizacao inicial: {cardConfidence.toFixed(0)}%<br/></>}
              {mmPerPx!==null && <>Escala: {mmPerPx.toFixed(5)} mm/px</>}
            </div>
          </>
        )}

        {camera.error && <div style={{marginTop:12,padding:12,borderRadius:10,background:"#fff3f3"}}>{camera.error}</div>}
      </section>

      <section ref={resultRef} className="v2-grid">
        <div className="v2-card" style={{borderRadius:16,padding:20}}>
          <label style={{display:"block",fontWeight:700,marginBottom:8}}>2. Largura final do dedo (mm)</label>
          <input
            value={fingerMm}
            onChange={(event)=>setFingerMm(event.target.value)}
            inputMode="decimal"
            style={{width:"100%",boxSizing:"border-box",fontSize:28,padding:"14px 16px",borderRadius:12,border:"1px solid #bbb",background:"#fff",color:"#111"}}
          />

          {result ? (
            <>
              <div className="v2-result-banner">
                <div style={{fontSize:13,fontWeight:800,letterSpacing:1,textTransform:"uppercase",opacity:.75}}>Resultado V2</div>
                <div className="v2-result-number">{result.exactRingSize}</div>
                <div style={{fontSize:18,fontWeight:700,marginTop:6}}>Conforto: {result.comfortRingSize}</div>
                <div style={{fontSize:14,opacity:.8,marginTop:6}}>Medida do dedo: {numericMm.toFixed(3)} mm</div>
              </div>
              <div className="v2-metrics">
              <Metric label="Aro exato" value={String(result.exactRingSize)} />
              <Metric label="Aro conforto" value={String(result.comfortRingSize)} />
              <Metric label="Centro deste aro" value={result.targetWidthMm.toFixed(3)+" mm"} />
              <Metric label="Diferenca para o centro" value={(result.distanceFromTargetMm>=0?"+":"")+result.distanceFromTargetMm.toFixed(3)+" mm"} />
              <Metric label="Limite inferior" value={Number.isFinite(result.lowerBoundaryMm)?result.lowerBoundaryMm.toFixed(3)+" mm":"-∞"} />
              <Metric label="Limite superior" value={Number.isFinite(result.upperBoundaryMm)?result.upperBoundaryMm.toFixed(3)+" mm":"+∞"} />
            </div>
            </>
          ) : (
            <div className="v2-light" style={{marginTop:16,padding:14,borderRadius:12}}>Digite uma medida valida em mm.</div>
          )}
        </div>

        <aside className="v2-card" style={{borderRadius:16,padding:20}}>
          <div style={{fontWeight:700,marginBottom:10}}>Marco inicial</div>
          <div style={{fontSize:28,fontWeight:800}}>Aro 29 = {INITIAL_REFERENCE_FINGER_WIDTH_MM.toFixed(2)} mm</div>
          <p style={{opacity:.7,lineHeight:1.5}}>
            Os demais aros sao construidos acumulando apenas o crescimento fisico medido no paquimetro.
          </p>
        </aside>
      </section>

      <section style={{marginTop:24}}>
        <h2 style={{fontSize:22}}>Regua V2</h2>
        <div style={{overflowX:"auto",border:"1px solid #6f5b39",borderRadius:16,background:"#fff",color:"#111"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:720}}>
            <thead>
              <tr style={{textAlign:"left",background:"#f1f1f1",color:"#111"}}>
                <Th>Aro</Th><Th>Centro dedo</Th><Th>Limite inferior</Th><Th>Limite superior</Th><Th>Media anel fisico</Th><Th>Crescimento fisico</Th>
              </tr>
            </thead>
            <tbody>
              {FINGER_REFERENCE_CURVE.map((entry)=>{
                const ring=PHYSICAL_RING_TABLE.find((item)=>item.size===entry.ringSize);
                return (
                  <tr key={entry.ringSize} style={{borderTop:"1px solid #eee"}}>
                    <Td>{entry.ringSize}</Td>
                    <Td>{entry.targetWidthMm.toFixed(3)} mm</Td>
                    <Td>{Number.isFinite(entry.lowerBoundaryMm)?entry.lowerBoundaryMm.toFixed(3):"-∞"}</Td>
                    <Td>{Number.isFinite(entry.upperBoundaryMm)?entry.upperBoundaryMm.toFixed(3):"+∞"}</Td>
                    <Td>{ring?.meanDiameterMm.toFixed(3)} mm</Td>
                    <Td>{ring?.growthFromPreviousMm==null?"—":(ring.growthFromPreviousMm>=0?"+":"")+ring.growthFromPreviousMm.toFixed(3)+" mm"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const buttonStyle={
  border:"1px solid #bbb",
  background:"#fff",
  borderRadius:10,
  padding:"10px 14px",
  fontWeight:700,
  cursor:"pointer",
} as const;

function Range({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
  return (
    <label style={{display:"block",fontSize:13,fontWeight:700}}>
      {label}: {value.toFixed(1)}%
      <input type="range" min={1} max={99} step={0.1} value={value} onChange={(event)=>onChange(Number(event.target.value))} style={{width:"100%"}} />
    </label>
  );
}

function Guide({pct,color,label}:{pct:number;color:string;label:string}){
  return (
    <div style={{position:"absolute",left:pct+"%",top:0,bottom:0,width:0,borderLeft:"2px solid "+color,pointerEvents:"none"}}>
      <span style={{position:"absolute",top:8,left:4,background:"rgba(0,0,0,.65)",color:"#fff",fontSize:10,padding:"2px 4px",borderRadius:4,whiteSpace:"nowrap"}}>{label}</span>
    </div>
  );
}

function HorizontalGuide({pct}:{pct:number}){
  return (
    <div style={{position:"absolute",left:0,right:0,top:pct+"%",height:0,borderTop:"2px dashed #f2c35f",pointerEvents:"none"}}>
      <span style={{position:"absolute",left:6,top:4,background:"rgba(0,0,0,.7)",color:"#f2c35f",fontSize:10,padding:"2px 4px",borderRadius:4}}>altura de medicao</span>
    </div>
  );
}

function OverlayText({children}:{children:ReactNode}){
  return <div style={{position:"absolute",inset:0,display:"grid",placeItems:"center",color:"#fff",background:"rgba(0,0,0,.25)",fontWeight:700}}>{children}</div>;
}

function Metric({label,value}:{label:string;value:string}){
  return <div className="v2-light" style={{padding:14,borderRadius:12}}><div style={{fontSize:12,opacity:.65,marginBottom:4}}>{label}</div><div style={{fontSize:22,fontWeight:800}}>{value}</div></div>;
}
function Th({children}:{children:ReactNode}){ return <th style={{padding:"12px 14px",fontSize:13}}>{children}</th>; }
function Td({children}:{children:ReactNode}){ return <td style={{padding:"11px 14px",fontSize:14}}>{children}</td>; }

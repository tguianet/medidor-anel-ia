import { useState } from "react";
export type UniversalCardBox = { x:number; y:number; width:number; height:number };
type Result = {box:UniversalCardBox; channel:string; score:number};
const channels = ["R","G","B","Luma"] as const;
type Channel = typeof channels[number];
const loadPixels = (photo:string):Promise<{data:Uint8ClampedArray;w:number;h:number}> => new Promise((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>{
    const canvas=document.createElement("canvas");
    const factor=Math.min(1,640/img.naturalWidth,640/img.naturalHeight);
    canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    if(!ctx){reject(new Error("Canvas indisponivel"));return;}
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    resolve({data:ctx.getImageData(0,0,canvas.width,canvas.height).data,w:canvas.width,h:canvas.height});
  };
  img.onerror=()=>reject(new Error("Foto indisponivel"));
  img.src=photo;
});
export async function detectUniversalCard(photo:string):Promise<Result|null>{
  const {data,w,h}=await loadPixels(photo);
  if(w<100||h<100) return null;
  const pixels=new Float32Array(w*h*4);
  for(let i=0;i<w*h;i++){
    pixels[i*4]=data[i*4];pixels[i*4+1]=data[i*4+1];pixels[i*4+2]=data[i*4+2];
    pixels[i*4+3]=0.299*data[i*4]+0.587*data[i*4+1]+0.114*data[i*4+2];
  }
  const val=(x:number,y:number,c:number)=>pixels[(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4+c];
  let best:Result|null=null;
  // Sample many horizontal and vertical scanlines. Accumulate gradients from each RGB channel
  // independently, so printed graphics do not automatically dominate the geometry.
  for(let ch=0;ch<4;ch++){
    const vertical=new Float32Array(w),horizontal=new Float32Array(h);
    for(let y=Math.round(h*.12);y<h*.88;y+=Math.max(2,Math.round(h/90))){
      for(let x=4;x<w-4;x+=2) vertical[x]+=Math.abs(val(x+3,y,ch)-val(x-3,y,ch));
    }
    for(let x=Math.round(w*.12);x<w*.88;x+=Math.max(2,Math.round(w/90))){
      for(let y=4;y<h-4;y+=2) horizontal[y]+=Math.abs(val(x,y+3,ch)-val(x,y-3,ch));
    }
    const candidates=(arr:Float32Array,min:number,max:number)=>{
      const candidates:{i:number;v:number}[]=[];
      for(let i=min;i<max;i+=2){
        const v=(arr[i-1]+arr[i]+arr[i+1])/3;
        if(v>0 && v>=((arr[i-3]||0)+(arr[i+3]||0))/2) candidates.push({i,v});
      }
      return candidates.sort((a,b)=>b.v-a.v).slice(0,22);
    };
    const xs=candidates(vertical,Math.round(w*.06),Math.round(w*.94));
    const ys=candidates(horizontal,Math.round(h*.06),Math.round(h*.94));
    for(const left of xs)for(const right of xs){
      if(right.i<=left.i) continue;
      const spanX=right.i-left.i;
      if(spanX<w*.25||spanX>w*.92)continue;
      for(const top of ys)for(const bottom of ys){
        if(bottom.i<=top.i)continue;
        const spanY=bottom.i-top.i;
        if(spanY<h*.12||spanY>h*.82)continue;
        const ratio=spanX/spanY;
        // The expected aspect is 85.60/53.98; allow modest camera perspective.
        if(ratio<1.25||ratio>2.05)continue;
        const aspectPenalty=Math.exp(-Math.pow(Math.log(ratio/(85.6/53.98))/.23,2));
        const edgeStrength=Math.min(left.v,right.v,top.v,bottom.v);
        const centerPenalty=Math.exp(-Math.pow(((left.i+right.i)/2-w/2)/(w*.60),2));
        const score=edgeStrength*aspectPenalty*centerPenalty;
        if(!best||score>best.score)best={box:{x:left.i/w,y:top.i/h,width:spanX/w,height:spanY/h},channel:channels[ch],score};
      }
    }
  }
  return best;
}
export default function UniversalCardDetectorV2({photo,onApply}:{photo:string;onApply:(box:UniversalCardBox)=>void}){
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const detect=async()=>{
    setBusy(true);setError("");setResult(null);
    try{
      const next=await detectUniversalCard(photo);
      if(!next)setError("Nao foi possivel localizar um retangulo confiavel. Ajuste as linhas manualmente.");
      else setResult(next);
    }catch(e){setError(e instanceof Error?e.message:"Falha na leitura da foto.");}
    finally{setBusy(false);}
  };
  return <section className="card-base-status" style={{marginTop:12,display:"grid",gap:8}}>
    <strong>DETECTOR RGB UNIVERSAL · TESTE V2</strong>
    <span>Compara canais R, G, B e brilho para sugerir bordas fisicas. Confirme visualmente; nao altera a formula.</span>
    <button className="secondary" type="button" disabled={busy} onClick={()=>void detect()}>{busy?"Analisando canais...":"Procurar bordas pelo RGB"}</button>
    {result&&<div style={{display:"grid",gap:8}}>
      <span>Canal: {result.channel} · largura {(result.box.width*100).toFixed(1)}% · altura {(result.box.height*100).toFixed(1)}%. Confira se as bordas correspondem ao cartao.</span>
      <button className="secondary" type="button" onClick={()=>onApply(result.box)}>Aplicar linhas sugeridas</button>
    </div>}
    {error&&<span role="status">{error}</span>}
  </section>;
}

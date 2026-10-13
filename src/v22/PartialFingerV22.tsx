import {useState} from "react";
type P={x:number;y:number};
type Scan={y:number;left:number;right:number;quality:number};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
async function analyze(src:string,leftSeed:number,rightSeed:number,base:number):Promise<{width:number;height:number;scans:Scan[];confidence:number}>{
 const img=new Image();img.src=src;await img.decode();
 const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;
 const ctx=c.getContext("2d",{willReadFrequently:true});if(!ctx)throw Error("Canvas indisponivel");
 ctx.drawImage(img,0,0);const {data}=ctx.getImageData(0,0,c.width,c.height),w=c.width,h=c.height;
 const gray=(x:number,y:number)=>{x=clamp(Math.round(x),0,w-1);y=clamp(Math.round(y),0,h-1);const i=(y*w+x)*4;return data[i]*.299+data[i+1]*.587+data[i+2]*.114;};
 const scans:Scan[]=[];const start=Math.round(base*h),span=Math.max(10,Math.min(h*.24,h*(.89-base)));
 const cx=(leftSeed+rightSeed)*w/2;const expected=Math.max(w*.018,(rightSeed-leftSeed)*w);
 let prevL=leftSeed*w,prevR=rightSeed*w;
 for(let i=0;i<32;i++){
   const y=clamp(Math.round(start+span*(i+1)/33),5,h-6);
   const find=(guess:number,side:-1|1)=>{
     const rad=Math.max(7,Math.min(w*.065,expected*.37));
     let best={x:guess,score:0};
     for(let x=Math.round(guess-rad);x<=Math.round(guess+rad);x+=1){
       if(x<5||x>=w-5||Math.abs(x-cx)>expected*.85)continue;
       const contrast=Math.abs(gray(x+3,y)-gray(x-3,y));
       const background=gray(x+side*5,y),inside=gray(x-side*5,y);
       const score=contrast*.8+Math.abs(background-inside)*.2-Math.abs(x-guess)*.35;
       if(score>best.score)best={x,score};
     }
     return best;
   };
   const l=find(prevL,-1),r=find(prevR,1);
   const width=r.x-l.x;
   if(width>expected*.45&&width<expected*1.65&&l.score>5&&r.score>5){
     scans.push({y:y/h,left:l.x/w,right:r.x/w,quality:Math.min(100,(l.score+r.score)*1.2)});
     prevL=l.x;prevR=r.x;
   }
 }
 const avg=scans.reduce((s,p)=>s+p.quality,0)/Math.max(1,scans.length);
 return {width:w,height:h,scans,confidence:Math.round(Math.min(99,scans.length/32*65+Math.min(35,avg*.35)))};
}
export default function AppV22(){
 const [photo,setPhoto]=useState("");const [busy,setBusy]=useState(false);
 const [left,setLeft]=useState(.42),[right,setRight]=useState(.58),[base,setBase]=useState(.43);
 const [result,setResult]=useState<Awaited<ReturnType<typeof analyze>>|null>(null);
 const [msg,setMsg]=useState("Fotografe o cartao sobre o dedo. Ajuste as guias se necessario.");
 const load=(f?:File)=>{if(!f)return;const r=new FileReader();r.onload=()=>{setPhoto(String(r.result));setResult(null);};r.readAsDataURL(f);};
 const run=async()=>{setBusy(true);setMsg("Procurando contornos sob o cartao...");try{const v=await analyze(photo,left,right,base);setResult(v);setMsg(v.scans.length>=18?"Contornos candidatos encontrados. Confira as linhas na foto.":"Leitura insuficiente. Ajuste as guias verdes e tente novamente.");}catch(e){setMsg(e instanceof Error?e.message:"Erro de leitura");}finally{setBusy(false);}};
 const summary=result?.scans.length?result.scans.map(s=>s.right-s.left).sort((a,b)=>a-b)[Math.floor(result.scans.length/2)]*100:null;
 return <main className="app" style={{maxWidth:740,margin:"auto",padding:16}}>
 <header className="brand"><div><strong>Medidor de Anel V2-2</strong><small>Detector experimental de dedo parcial</small></div></header>
 <section className="panel" style={{display:"grid",gap:14}}>
 <h2>Cartao sobre o dedo · 1 foto</h2>
 <p>Primeiro teste: verificar se as bordas verdes acompanham o dedo visivel abaixo do cartao. Nao calcula aro nesta fase.</p>
 <label className="primary" style={{padding:14,textAlign:"center",cursor:"pointer"}}>Fotografar ou escolher imagem<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>load(e.target.files?.[0])}/></label>
 {photo&&<>
 <div style={{position:"relative",width:"100%",touchAction:"auto"}}>
 <img src={photo} alt="Foto para deteccao do dedo" style={{width:"100%",height:"auto",display:"block"}}/>
 <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
 <line x1={left*1000} y1="0" x2={left*1000} y2="1000" stroke="#3cf1b4" strokeWidth="4" strokeDasharray="12 8"/>
 <line x1={right*1000} y1="0" x2={right*1000} y2="1000" stroke="#3cf1b4" strokeWidth="4" strokeDasharray="12 8"/>
 <line x1="0" y1={base*1000} x2="1000" y2={base*1000} stroke="#ffe08a" strokeWidth="4"/>
 {result?.scans.map((s,i)=><g key={i}>
 <circle cx={s.left*1000} cy={s.y*1000} r="4" fill="#42ffb7"/><circle cx={s.right*1000} cy={s.y*1000} r="4" fill="#42ffb7"/>
 {i%4===0&&<line x1={s.left*1000} y1={s.y*1000} x2={s.right*1000} y2={s.y*1000} stroke="#ffe08a" strokeWidth="2"/>}
 </g>)}
 </svg></div>
 <label>Guia esquerda: {Math.round(left*100)}%<input type="range" min=".05" max={Math.max(.06,right-.03)} step=".002" value={left} onChange={e=>{setLeft(+e.target.value);setResult(null);}} style={{width:"100%"}}/></label>
 <label>Guia direita: {Math.round(right*100)}%<input type="range" min={Math.min(.94,left+.03)} max=".95" step=".002" value={right} onChange={e=>{setRight(+e.target.value);setResult(null);}} style={{width:"100%"}}/></label>
 <label>Base do cartao: {Math.round(base*100)}%<input type="range" min=".10" max=".75" step=".002" value={base} onChange={e=>{setBase(+e.target.value);setResult(null);}} style={{width:"100%"}}/></label>
 <button type="button" className="primary" disabled={busy} onClick={()=>void run()}>{busy?"Detectando...":"Detectar bordas do dedo"}</button>
 </>}
 <p role="status">{msg}</p>
 {result&&<div style={{display:"grid",gap:4}}>
 <strong>{result.scans.length} cortes válidos de 32 · confiança experimental {result.confidence}%</strong>
 <span>Largura mediana na imagem: {summary===null?"indisponivel":summary.toFixed(2)+"% da foto"}</span>
 <small>As bordas sao candidatas, nao medidas em mm. Sombras e impressos podem causar falsos positivos. Validar visualmente antes de acrescentar calibracao.</small>
 </div>}
 </section></main>;
}
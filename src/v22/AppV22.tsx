import {useEffect,useRef,useState} from "react";
import {analyzeHandLandmarks,type NormalizedLandmark} from "../v2/handLandmarks";
type Edge={id:number;name:string;left:{x:number;y:number}[];right:{x:number;y:number}[];valid:boolean};
const fingers=[{id:1,name:"Polegar",pts:[1,2,3,4]},{id:2,name:"Indicador",pts:[5,6,7,8]},{id:3,name:"Medio",pts:[9,10,11,12]},{id:4,name:"Anelar",pts:[13,14,15,16]},{id:5,name:"Minimo",pts:[17,18,19,20]}];
const paths=[[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[5,9,13,17]];
function toData(file:File):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error("Erro lendo imagem"));r.readAsDataURL(file);});}
async function findFingerEdges(photo:string,points:NormalizedLandmark[]):Promise<Edge[]>{
 const image=new Image();image.src=photo;await image.decode();
 const c=document.createElement("canvas");c.width=image.naturalWidth;c.height=image.naturalHeight;
 const ctx=c.getContext("2d",{willReadFrequently:true})!;ctx.drawImage(image,0,0);
 const {data}=ctx.getImageData(0,0,c.width,c.height),w=c.width,h=c.height;
 const lum=(x:number,y:number)=>{const px=Math.min(w-1,Math.max(0,Math.round(x))),py=Math.min(h-1,Math.max(0,Math.round(y))),i=(py*w+px)*4;return data[i]*.299+data[i+1]*.587+data[i+2]*.114;};
 const sample=(x:number,y:number,nx:number,ny:number,dir:number)=>{
   const cx=x*w,cy=y*h,step=Math.max(w,h)*.002,rad=Math.max(8,Math.min(w,h)*.085);
   let best=0,bestScore=0;
   for(let d=step*2;d<rad;d+=step){
     const px=cx+nx*d*dir,py=cy+ny*d*dir;
     if(px<6||py<6||px>=w-6||py>=h-6)break;
     const diff=Math.abs(lum(px+nx*step*dir,py+ny*step*dir)-lum(px-nx*step*dir,py-ny*step*dir));
     // Favor closer physical boundaries over background texture.
     const score=diff/(1+d/rad);
     if(score>bestScore){bestScore=score;best=d;}
   }
   return {point:{x:(cx+nx*best*dir)/w,y:(cy+ny*best*dir)/h},ok:bestScore>10};
 };
 return fingers.map(f=>{
   const a=points[f.pts[0]],b=points[f.pts[1]];
   const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
   const left:Edge["left"]=[],right:Edge["right"]=[];
   let hits=0;
   for(let k=0;k<12;k++){
     const t=.20+k/11*.60,x=a.x+dx*t,y=a.y+dy*t;
     const l=sample(x,y,nx,ny,-1),r=sample(x,y,nx,ny,1);
     if(l.ok&&r.ok)hits++;
     left.push(l.point);right.push(r.point);
   }
   return {id:f.id,name:f.name,left,right,valid:hits>=8};
 });
}
export default function AppV22(){
 const [photo,setPhoto]=useState("");const [points,setPoints]=useState<NormalizedLandmark[]>([]);
 const [edges,setEdges]=useState<Edge[]>([]);const [state,setState]=useState("Escolha uma foto da mao aberta, sem cartao.");
 const [busy,setBusy]=useState(false);const [step,setStep]=useState(1);const [second,setSecond]=useState("");
 const [opacity,setOpacity]=useState(.43);const [cameraError,setCameraError]=useState("");
 const video=useRef<HTMLVideoElement>(null);const stream=useRef<MediaStream|null>(null);
 const stop=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};
 useEffect(()=>()=>stop(),[]);
 const read=async(file:File|undefined)=>{
  if(!file)return;setBusy(true);setState("Carregando MediaPipe e analisando a mao...");
  setStep(1);setPoints([]);setEdges([]);setSecond("");
  try{
   const src=await toData(file);setPhoto(src);
   const result=await analyzeHandLandmarks(src,.5);
   if(!result.detected){setState(result.error||"Mao nao reconhecida. Tente fundo liso e luz uniforme.");return;}
   setPoints(result.landmarks);setState("21 pontos detectados. Procurando bordas fisicas...");
   const contours=await findFingerEdges(src,result.landmarks);setEdges(contours);
   const valid=contours.filter(c=>c.valid).length;
   setState("MediaPipe detectou 21 pontos. Contornos experimentais: "+valid+"/5 com contraste suficiente. Confira as linhas antes de usar.");
  }catch(e){setState(e instanceof Error?e.message:"Erro desconhecido");}finally{setBusy(false);}
 };
 const openCamera=async()=>{
  stop();setCameraError("");
  try{
   const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});stream.current=s;setStep(2);
   requestAnimationFrame(()=>{if(video.current){video.current.srcObject=s;void video.current.play().catch(()=>setCameraError("Toque na tela para iniciar a camera."));}});
  }catch(e){setCameraError(e instanceof Error?e.message:"Nao foi possivel abrir a camera");}
 };
 const capture=()=>{if(!video.current||!video.current.videoWidth)return;const c=document.createElement("canvas");c.width=video.current.videoWidth;c.height=video.current.videoHeight;c.getContext("2d")?.drawImage(video.current,0,0,c.width,c.height);setSecond(c.toDataURL("image/jpeg",.92));stop();};
 const overlay=(showEdges=true)=><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
  {paths.map((p,i)=><polyline key={i} points={p.map(id=>`${points[id]?.x*1000},${points[id]?.y*1000}`).join(" ")} fill="none" stroke="#ffe18a" strokeWidth="3"/>)}
  {points.map((p,i)=><circle key={i} cx={p.x*1000} cy={p.y*1000} r="6" fill="#fee9a9"/>)}
  {showEdges&&edges.map(e=><g key={e.id}><polyline points={e.left.map(p=>`${p.x*1000},${p.y*1000}`).join(" ")} stroke={e.valid?"#46f0bd":"#fa7a75"} fill="none" strokeWidth="4"/><polyline points={e.right.map(p=>`${p.x*1000},${p.y*1000}`).join(" ")} stroke={e.valid?"#46f0bd":"#fa7a75"} fill="none" strokeWidth="4"/></g>)}
 </svg>;
 const photoBox=(src:string,children?:React.ReactNode)=><div style={{position:"relative",width:"100%",maxWidth:560,margin:"auto",overflow:"hidden",borderRadius:14,background:"#131c20"}}><img src={src} alt="Mao capturada" style={{width:"100%",display:"block"}}/>{children}</div>;
 return <main className="app" style={{maxWidth:800,margin:"auto",padding:16}}>
  <header className="brand"><div><strong>Medidor de Anel · V2-2</strong><small>Laboratorio de mao e foto fantasma — sem calculo do aro</small></div></header>
  {step===1?<section className="panel" style={{display:"grid",gap:14}}>
    <h2>Foto 1 · reconhecer a mao</h2>
    <p>Abra os cinco dedos, use fundo uniforme e fotografe sem cartao. O teste identifica os 21 pontos e estima contornos laterais; bordas verdes nao significam precisao em milimetros.</p>
    <label className="primary" style={{display:"block",textAlign:"center",padding:15,cursor:"pointer"}}>Tirar ou escolher foto<input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>void read(e.target.files?.[0])}/></label>
    <p role="status">{busy?"Processando... ":null}{state}</p>
    {photo&&photoBox(photo,points.length===21?overlay():null)}
    {points.length===21&&<><strong>Reconhecimento dos cinco dedos</strong><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{edges.map(e=><span key={e.id} style={{padding:8,borderRadius:8,background:e.valid?"#1b5549":"#613735"}}>{e.name}: {e.valid?"borda candidata":"revisar borda"}</span>)}</div>
    <button className="primary" type="button" onClick={()=>void openCamera()}>Abrir camera com fantasma</button></>}
    {cameraError&&<p role="alert">{cameraError}</p>}
  </section>:<section className="panel" style={{display:"grid",gap:12}}>
   <h2>Foto 2 · encaixar a mao no fantasma</h2><p>Alinhe a mao e mantenha distancia e angulo da camera. Este primeiro teste mostra sobreposicao visual; nao certifica alinhamento nem mede aros.</p>
   <label>Transparencia do fantasma: {Math.round(opacity*100)}%<input type="range" min="0" max="0.8" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label>
   <div style={{position:"relative",width:"100%",maxWidth:560,margin:"auto",aspectRatio:"3/4",background:"#0b1115",overflow:"hidden",borderRadius:14}}>
   {!second?<video ref={video} playsInline muted autoPlay style={{height:"100%",width:"100%",objectFit:"fill"}}/>:<img src={second} alt="Segunda foto" style={{height:"100%",width:"100%",objectFit:"fill"}}/>}
   <img src={photo} alt="" style={{position:"absolute",inset:0,height:"100%",width:"100%",objectFit:"fill",opacity,pointerEvents:"none"}}/>
   </div>
   {cameraError&&<p role="alert">{cameraError}</p>}
   {!second?<button className="primary" onClick={capture}>Capturar foto 2</button>:<p>Foto 2 registrada. Compare visualmente com o fantasma. A calibracao do cartao sera integrada depois.</p>}
   <button className="secondary" onClick={()=>{stop();setStep(1);setSecond("");}}>Voltar para foto 1</button>
  </section>}
 </main>;
}

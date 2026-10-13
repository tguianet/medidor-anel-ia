// Experimental V2-1 photographic preprocessing. Preserve pixel geometry and dimensions.
export async function grayShadowCorrect(photo:string):Promise<string>{
 const img=new Image();
 img.src=photo;
 await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error("Imagem indisponivel"));});
 const canvas=document.createElement("canvas");
 canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
 const ctx=canvas.getContext("2d",{willReadFrequently:true});
 if(!ctx)throw new Error("Canvas indisponivel");
 ctx.drawImage(img,0,0);
 const src=ctx.getImageData(0,0,canvas.width,canvas.height);
 const w=canvas.width,h=canvas.height, data=src.data;
 const levels=new Float32Array(w*h);
 for(let i=0;i<w*h;i++){
   const r=data[4*i],g=data[4*i+1],b=data[4*i+2];
   // Robust color-independent luminance, same coordinates as original photo.
   levels[i]=0.299*r+0.587*g+0.114*b;
 }
 // Low frequency illumination estimate (resolution independent, bounded cost).
 const sw=Math.min(96,w),sh=Math.min(128,h);
 const shadowCanvas=document.createElement("canvas");
 shadowCanvas.width=sw;shadowCanvas.height=sh;
 const shadowCtx=shadowCanvas.getContext("2d",{willReadFrequently:true});
 if(!shadowCtx)throw new Error("Canvas de iluminacao indisponivel");
 shadowCtx.drawImage(img,0,0,sw,sh);
 const p=shadowCtx.getImageData(0,0,sw,sh);
 const small=new Float32Array(sw*sh);
 for(let i=0;i<small.length;i++)small[i]=.299*p.data[i*4]+.587*p.data[i*4+1]+.114*p.data[i*4+2];
 const radius=8;
 const integral=new Float64Array((sw+1)*(sh+1));
 for(let y=1;y<=sh;y++)for(let x=1;x<=sw;x++){
   integral[y*(sw+1)+x]=small[(y-1)*sw+x-1]+integral[(y-1)*(sw+1)+x]+integral[y*(sw+1)+x-1]-integral[(y-1)*(sw+1)+x-1];
 }
 const illum=new Float32Array(sw*sh);
 for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
   const x0=Math.max(0,x-radius),x1=Math.min(sw-1,x+radius),y0=Math.max(0,y-radius),y1=Math.min(sh-1,y+radius);
   const sum=integral[(y1+1)*(sw+1)+x1+1]-integral[y0*(sw+1)+x1+1]-integral[(y1+1)*(sw+1)+x0]+integral[y0*(sw+1)+x0];
   illum[y*sw+x]=sum/((x1-x0+1)*(y1-y0+1));
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const sx=Math.min(sw-1,Math.floor(x*sw/w)),sy=Math.min(sh-1,Math.floor(y*sh/h));
   const base=illum[sy*sw+sx];
   // Limited correction reduces soft shadow; preserve physical edge contrast.
   const adjusted=Math.max(0,Math.min(255,128+(levels[y*w+x]-base)*1.30+(base-128)*.52));
   const value=Math.round(adjusted);
   const o=(y*w+x)*4;data[o]=value;data[o+1]=value;data[o+2]=value;
 }
 ctx.putImageData(src,0,0);
 return canvas.toDataURL("image/jpeg",.94);
}

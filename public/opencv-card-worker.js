/* OpenCV card detector runs entirely off the UI thread. */
self.importScripts("https://docs.opencv.org/4.x/opencv.js");

const CARD_RATIO=85.6/53.98;

const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);

const orderCorners=(points)=>{
  const bySum=[...points].sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const tl=bySum[0];
  const br=bySum[bySum.length-1];
  const remaining=points.filter(p=>p!==tl&&p!==br);
  const pair=remaining[0].x>remaining[1].x
    ? [remaining[0],remaining[1]]
    : [remaining[1],remaining[0]];
  return [tl,pair[0],br,pair[1]];
};

const waitForCv=async()=>{
  const started=Date.now();
  while(Date.now()-started<20000){
    if(self.cv?.Mat) return self.cv;
    if(self.cv && typeof self.cv.then==="function"){
      const ready=await self.cv;
      if(ready?.Mat) return ready;
    }
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("OpenCV nao iniciou no worker.");
};

self.onmessage=async(event)=>{
  if(!event.data || event.data.type!=="detect") return;
  const {width,height,buffer}=event.data;

  let source,gray,blur,edges,closed,contours,hierarchy,kernel;
  try{
    const cv=await waitForCv();
    const imageData=new ImageData(new Uint8ClampedArray(buffer),width,height);
    source=cv.matFromImageData(imageData);
    gray=new cv.Mat();
    blur=new cv.Mat();
    edges=new cv.Mat();
    closed=new cv.Mat();
    contours=new cv.MatVector();
    hierarchy=new cv.Mat();
    kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));

    cv.cvtColor(source,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);
    cv.Canny(blur,edges,55,155,3,false);
    cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
    cv.findContours(closed,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);

    const imageArea=width*height;
    let best=null;

    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      const area=Math.abs(cv.contourArea(contour,false));

      if(area>=imageArea*0.025 && area<=imageArea*0.92){
        const perimeter=cv.arcLength(contour,true);
        const approx=new cv.Mat();
        cv.approxPolyDP(contour,approx,perimeter*0.02,true);

        if(approx.rows===4 && cv.isContourConvex(approx)){
          const raw=approx.data32S;
          const pts=[];
          for(let j=0;j<8;j+=2) pts.push({x:raw[j],y:raw[j+1]});
          const corners=orderCorners(pts);
          const [tl,tr,br,bl]=corners;
          const cardWidth=(distance(tl,tr)+distance(bl,br))/2;
          const cardHeight=(distance(tl,bl)+distance(tr,br))/2;
          const ratioRaw=cardWidth/Math.max(1,cardHeight);
          const ratio=ratioRaw>=1?ratioRaw:1/ratioRaw;
          const ratioError=Math.abs(ratio-CARD_RATIO)/CARD_RATIO;
          const areaPercent=area/imageArea*100;

          if(ratioError<0.42){
            const ratioScore=Math.max(0,1-ratioError/0.42);
            const areaScore=Math.min(1,areaPercent/22);
            const score=ratioScore*72+areaScore*28;
            if(!best || score>best.score){
              best={score,corners,ratio,areaPercent,widthPx:cardWidth,heightPx:cardHeight};
            }
          }
        }
        approx.delete();
      }

      contour.delete();
    }

    if(!best) throw new Error("Nenhum quadrilatero compativel com cartao foi encontrado.");

    self.postMessage({
      type:"result",
      result:{
        corners:best.corners,
        confidence:Math.round(Math.min(100,best.score)),
        aspectRatio:best.ratio,
        areaPercent:best.areaPercent,
        widthPx:best.widthPx,
        heightPx:best.heightPx,
        mmPerPx:85.6/Math.max(1,best.widthPx),
        imageWidth:width,
        imageHeight:height,
      }
    });
  }catch(error){
    self.postMessage({
      type:"error",
      message:error instanceof Error?error.message:"Falha no processamento OpenCV."
    });
  }finally{
    try{ source?.delete(); }catch{}
    try{ gray?.delete(); }catch{}
    try{ blur?.delete(); }catch{}
    try{ edges?.delete(); }catch{}
    try{ closed?.delete(); }catch{}
    try{ contours?.delete(); }catch{}
    try{ hierarchy?.delete(); }catch{}
    try{ kernel?.delete(); }catch{}
  }
};

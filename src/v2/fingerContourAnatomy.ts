export type FingerContourSample = {
  yPercent:number;
  width:number;
  confidence:number;
};

export type FingerContourAnatomy = {
  detected:boolean;
  score:number;
  ringRegionY:number|null;
  jointRegionY:number|null;
  stableRunStart:number|null;
  stableRunEnd:number|null;
  widthCvPercent:number|null;
  reason:string;
};

const median=(values:number[])=>{
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};

const movingMedian=(samples:FingerContourSample[],radius=2)=>
  samples.map((sample,index)=>{
    const window=samples
      .slice(Math.max(0,index-radius),Math.min(samples.length,index+radius+1))
      .map(item=>item.width);
    return {...sample,width:median(window) ?? sample.width};
  });

export const analyzeFingerContourAnatomy = (
  rawSamples:FingerContourSample[],
  _manualGuideY:number,
):FingerContourAnatomy => {
  const samples=movingMedian(
    rawSamples
      .filter(s=>Number.isFinite(s.width)&&s.width>0&&s.confidence>=45)
      .sort((a,b)=>a.yPercent-b.yPercent)
  );

  if(samples.length<18){
    return {
      detected:false,score:0,ringRegionY:null,jointRegionY:null,
      stableRunStart:null,stableRunEnd:null,widthCvPercent:null,
      reason:"contorno insuficiente",
    };
  }

  const widths=samples.map(s=>s.width);
  const globalMedian=median(widths) ?? 0;
  const runs:{start:number;end:number;score:number;cv:number;centerY:number}[]=[];

  for(let start=0;start<samples.length;start++){
    for(let end=start+6;end<Math.min(samples.length,start+18);end++){
      const run=samples.slice(start,end+1);
      const mean=run.reduce((s,x)=>s+x.width,0)/run.length;
      if(mean<=0) continue;
      const variance=run.reduce((s,x)=>s+(x.width-mean)**2,0)/run.length;
      const sd=Math.sqrt(variance);
      const cv=sd/mean*100;
      const y0=run[0].yPercent;
      const y1=run[run.length-1].yPercent;
      const centerY=(y0+y1)/2;
      const span=Math.max(.001,y1-y0);
      const slope=Math.abs(run[run.length-1].width-run[0].width)/span;
      const averageConfidence=run.reduce((s,x)=>s+x.confidence,0)/run.length;

      // A regiao do anel agora e 100% anatomica: a posicao manual da linha
      // amarela NAO participa mais do score. Isso evita que a mesma foto
      // produza regioes diferentes apenas porque o usuario moveu a guia.
      // Procuramos o plato mais continuo, confiavel e geometricamente estavel.
      const score=
        averageConfidence
        -cv*9
        -slope*5
        +Math.min(10,run.length*.6);

      runs.push({start,end,score,cv,centerY});
    }
  }

  if(!runs.length){
    return {
      detected:false,score:0,ringRegionY:null,jointRegionY:null,
      stableRunStart:null,stableRunEnd:null,widthCvPercent:null,
      reason:"nenhum platô anatômico",
    };
  }

  runs.sort((a,b)=>b.score-a.score);
  const best=runs[0];
  const ringRegionY=best.centerY;

  // Junta é apenas diagnóstica: procura um máximo local acima da região do anel
  // com largura maior que a mediana global. Nunca altera o aro.
  const above=samples.filter(s=>s.yPercent<ringRegionY-2);
  let jointRegionY:number|null=null;
  if(above.length>=5){
    const candidate=[...above].sort((a,b)=>b.width-a.width)[0];
    if(candidate.width>globalMedian*1.015) jointRegionY=candidate.yPercent;
  }

  const score=Math.max(0,Math.min(100,Math.round(best.score)));
  return {
    detected:score>=60,
    score,
    ringRegionY:score>=60 ? ringRegionY : null,
    jointRegionY,
    stableRunStart:best.start,
    stableRunEnd:best.end,
    widthCvPercent:best.cv,
    reason:score>=60 ? "platô estável do contorno" : "confiança baixa",
  };
};

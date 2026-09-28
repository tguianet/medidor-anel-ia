export type RobustWidthStats = {
  input: number[];
  filtered: number[];
  median: number | null;
  trimmedMean: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  outlierCount: number;
  retainedRatio: number;
  spreadPercent: number;
  edgeScore: number;
};

const quantile = (sorted:number[], q:number) => {
  if(!sorted.length) return null;
  const pos=(sorted.length-1)*q;
  const base=Math.floor(pos);
  const rest=pos-base;
  const next=sorted[Math.min(sorted.length-1,base+1)];
  return sorted[base]+(next-sorted[base])*rest;
};

export const robustWidthStats = (values:number[]):RobustWidthStats => {
  const input=values.filter(v=>Number.isFinite(v)&&v>0);
  if(!input.length){
    return {
      input:[],filtered:[],median:null,trimmedMean:null,q1:null,q3:null,iqr:null,
      outlierCount:0,retainedRatio:0,spreadPercent:999,edgeScore:0,
    };
  }

  const sorted=[...input].sort((a,b)=>a-b);
  const q1=quantile(sorted,.25)!;
  const median=quantile(sorted,.5)!;
  const q3=quantile(sorted,.75)!;
  const iqr=q3-q1;

  const lower=q1-1.5*iqr;
  const upper=q3+1.5*iqr;
  let filtered=sorted.filter(v=>v>=lower&&v<=upper);
  if(filtered.length<Math.max(5,Math.round(sorted.length*.55))) filtered=sorted;

  const trim=Math.floor(filtered.length*.1);
  const trimmed=filtered.length-trim*2>=3 ? filtered.slice(trim,filtered.length-trim) : filtered;
  const trimmedMean=trimmed.reduce((sum,v)=>sum+v,0)/trimmed.length;
  const min=Math.min(...filtered);
  const max=Math.max(...filtered);
  const spreadPercent=median>0 ? ((max-min)/median)*100 : 999;
  const retainedRatio=filtered.length/input.length;

  // Score only describes contour consistency. It never changes ring size.
  const spreadPenalty=Math.min(55,spreadPercent*10);
  const outlierPenalty=(1-retainedRatio)*45;
  const sampleBonus=Math.min(8,Math.max(0,(filtered.length-20)/4));
  const edgeScore=Math.max(0,Math.min(100,Math.round(100-spreadPenalty-outlierPenalty+sampleBonus)));

  return {
    input,
    filtered,
    median,
    trimmedMean,
    q1,
    q3,
    iqr,
    outlierCount:input.length-filtered.length,
    retainedRatio,
    spreadPercent,
    edgeScore,
  };
};

export type ConfidenceInputs = {
  cardScore:number;
  perspectiveScore:number;
  stabilityScore:number | null;
  segmentationScore:number | null;
  edgeScore:number;
  depthScore:number | null;
};

export const combineConfidenceScore = (scores:ConfidenceInputs) => {
  const weighted:{value:number;weight:number}[]=[
    {value:scores.cardScore,weight:.28},
    {value:scores.perspectiveScore,weight:.26},
    {value:scores.edgeScore,weight:.30},
  ];
  if(scores.stabilityScore!==null) weighted.push({value:scores.stabilityScore,weight:.16});
  if(scores.segmentationScore!==null) weighted.push({value:scores.segmentationScore,weight:.14});
  if(scores.depthScore!==null) weighted.push({value:scores.depthScore,weight:.10});

  const totalWeight=weighted.reduce((s,x)=>s+x.weight,0);
  if(totalWeight<=0) return 0;
  return Math.round(weighted.reduce((s,x)=>s+x.value*x.weight,0)/totalWeight);
};

export const confidenceLabel = (score:number) =>
  score>=90 ? "excelente" :
  score>=80 ? "boa" :
  score>=70 ? "aceitável" :
  "refazer";

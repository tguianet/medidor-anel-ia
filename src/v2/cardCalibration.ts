export type Point = { x: number; y: number };
export type Line = { a: Point; b: Point };

export const CARD_WIDTH_MM = 85.6;

// V2: calibracao do cartao isolada.
// Regra central: somente as DUAS laterais travadas participam da escala.
// A linha de 85,60 mm e criada automaticamente perpendicularmente a direcao
// media das laterais. Nenhuma linha manual de base entra no calculo.

const midpoint = (line: Line): Point => ({
  x: (line.a.x + line.b.x) / 2,
  y: (line.a.y + line.b.y) / 2,
});

const direction = (line: Line) => {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) throw new Error("card-side-too-short");
  return { x: dx / length, y: dy / length };
};

const intersection = (first: Line, second: Line): Point => {
  const x1=first.a.x, y1=first.a.y, x2=first.b.x, y2=first.b.y;
  const x3=second.a.x, y3=second.a.y, x4=second.b.x, y4=second.b.y;
  const denominator=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
  if(Math.abs(denominator)<1e-9) throw new Error("parallel-lines");
  const det1=x1*y2-y1*x2;
  const det2=x3*y4-y3*x4;
  return {
    x:(det1*(x3-x4)-(x1-x2)*det2)/denominator,
    y:(det1*(y3-y4)-(y1-y2)*det2)/denominator,
  };
};

export const buildAutomaticCardReferenceLine = (left: Line, right: Line): Line => {
  const leftMid=midpoint(left);
  const rightMid=midpoint(right);
  const dl=direction(left);
  const drRaw=direction(right);

  const dot=dl.x*drRaw.x+dl.y*drRaw.y;
  const dr=dot<0 ? {x:-drRaw.x,y:-drRaw.y} : drRaw;

  const avgX=dl.x+dr.x;
  const avgY=dl.y+dr.y;
  const avgLength=Math.hypot(avgX,avgY);
  if(avgLength<1e-6) return {a:leftMid,b:rightMid};

  const ux=avgX/avgLength;
  const uy=avgY/avgLength;
  const nx=-uy;
  const ny=ux;
  const center={
    x:(leftMid.x+rightMid.x)/2,
    y:(leftMid.y+rightMid.y)/2,
  };

  const crossLine:Line={
    a:{x:center.x-nx*10000,y:center.y-ny*10000},
    b:{x:center.x+nx*10000,y:center.y+ny*10000},
  };

  try{
    const a=intersection(left,crossLine);
    const b=intersection(right,crossLine);
    if(
      Number.isFinite(a.x) && Number.isFinite(a.y) &&
      Number.isFinite(b.x) && Number.isFinite(b.y) &&
      Math.hypot(b.x-a.x,b.y-a.y)>1
    ){
      return {a,b};
    }
  }catch{
    // fallback geometricamente seguro
  }

  return {a:leftMid,b:rightMid};
};

export type CardScale = {
  referenceLine: Line;
  referenceLengthPx: number;
  pxPerMm: number;
  mmPerPx: number;
};

export const scaleFromLockedCardSides = (left: Line, right: Line): CardScale => {
  const referenceLine=buildAutomaticCardReferenceLine(left,right);
  const referenceLengthPx=Math.hypot(
    referenceLine.b.x-referenceLine.a.x,
    referenceLine.b.y-referenceLine.a.y,
  );

  if(!Number.isFinite(referenceLengthPx) || referenceLengthPx<=0){
    throw new Error("invalid-card-reference");
  }

  return {
    referenceLine,
    referenceLengthPx,
    pxPerMm: referenceLengthPx/CARD_WIDTH_MM,
    mmPerPx: CARD_WIDTH_MM/referenceLengthPx,
  };
};

export const compareCardCaptures = (
  referenceLengthPx:number,
  measurementLengthPx:number,
) => {
  if(
    !Number.isFinite(referenceLengthPx) || referenceLengthPx<=0 ||
    !Number.isFinite(measurementLengthPx) || measurementLengthPx<=0
  ) return null;

  return {
    signedPercent:(measurementLengthPx/referenceLengthPx-1)*100,
    absolutePercent:Math.abs((measurementLengthPx/referenceLengthPx-1)*100),
  };
};

import { INITIAL_REFERENCE_RING, PHYSICAL_RING_TABLE } from "./physicalRingTable";

export type FingerRingReference = {
  ringSize: number;
  targetWidthMm: number;
  lowerBoundaryMm: number;
  upperBoundaryMm: number;
};

export type RingClassification = {
  measuredWidthMm: number;
  exactRingSize: number;
  comfortRingSize: number;
  targetWidthMm: number;
  distanceFromTargetMm: number;
  lowerBoundaryMm: number;
  upperBoundaryMm: number;
};

// Ancora inicial da V2.
// O aro 29 foi escolhido como marco zero porque e a faixa com mais repeticoes
// confirmadas no sistema anterior. Esta constante pode ser recalibrada depois
// sem alterar a tabela fisica dos aneis.
export const INITIAL_REFERENCE_FINGER_WIDTH_MM = 21.15;

const bySize = new Map(PHYSICAL_RING_TABLE.map((ring) => [ring.size, ring]));

const physicalGrowthBetween = (lowerRingSize: number, upperRingSize: number) => {
  const lower=bySize.get(lowerRingSize);
  const upper=bySize.get(upperRingSize);
  if(!lower || !upper || upperRingSize-lowerRingSize!==1){
    throw new Error("physical-ring-step-not-found");
  }
  return upper.meanDiameterMm-lower.meanDiameterMm;
};

// Constroi a regua do dedo acumulando EXCLUSIVAMENTE os crescimentos fisicos
// observados no paquimetro. A largura do dedo do aro 29 e somente a ancora.
// Exemplo:
// 29 = 21,15 mm
// 28 = 21,15 - crescimento fisico 28->29
// 30 = 21,15 + crescimento fisico 29->30
export const buildFingerReferenceCurve = (
  anchorRingSize = INITIAL_REFERENCE_RING,
  anchorFingerWidthMm = INITIAL_REFERENCE_FINGER_WIDTH_MM,
): FingerRingReference[] => {
  const sizes=PHYSICAL_RING_TABLE.map((ring)=>ring.size).sort((a,b)=>a-b);
  if(!sizes.includes(anchorRingSize)) throw new Error("anchor-ring-not-found");

  const targets=new Map<number,number>();
  targets.set(anchorRingSize,anchorFingerWidthMm);

  for(let size=anchorRingSize-1;size>=sizes[0];size--){
    const next=targets.get(size+1);
    if(next===undefined) throw new Error("missing-next-target");
    const growth=physicalGrowthBetween(size,size+1);
    targets.set(size,next-growth);
  }

  for(let size=anchorRingSize+1;size<=sizes[sizes.length-1];size++){
    const previous=targets.get(size-1);
    if(previous===undefined) throw new Error("missing-previous-target");
    const growth=physicalGrowthBetween(size-1,size);
    targets.set(size,previous+growth);
  }

  return sizes.map((size,index)=>{
    const targetWidthMm=targets.get(size)!;
    const previousSize=sizes[index-1];
    const nextSize=sizes[index+1];
    const previousTarget=previousSize===undefined ? null : targets.get(previousSize)!;
    const nextTarget=nextSize===undefined ? null : targets.get(nextSize)!;

    return {
      ringSize:size,
      targetWidthMm:Number(targetWidthMm.toFixed(3)),
      lowerBoundaryMm:previousTarget===null
        ? Number.NEGATIVE_INFINITY
        : Number(((previousTarget+targetWidthMm)/2).toFixed(3)),
      upperBoundaryMm:nextTarget===null
        ? Number.POSITIVE_INFINITY
        : Number(((targetWidthMm+nextTarget)/2).toFixed(3)),
    };
  });
};

export const FINGER_REFERENCE_CURVE = buildFingerReferenceCurve();

export const classifyFingerWidthMm = (
  measuredWidthMm:number,
  comfortOffset=1,
):RingClassification => {
  if(!Number.isFinite(measuredWidthMm) || measuredWidthMm<=0){
    throw new Error("invalid-finger-width-mm");
  }

  const match=FINGER_REFERENCE_CURVE.find((entry)=>
    measuredWidthMm>=entry.lowerBoundaryMm &&
    measuredWidthMm<entry.upperBoundaryMm
  ) ?? FINGER_REFERENCE_CURVE[FINGER_REFERENCE_CURVE.length-1];

  const minSize=FINGER_REFERENCE_CURVE[0].ringSize;
  const maxSize=FINGER_REFERENCE_CURVE[FINGER_REFERENCE_CURVE.length-1].ringSize;
  const comfortRingSize=Math.max(minSize,Math.min(maxSize,match.ringSize+comfortOffset));

  return {
    measuredWidthMm,
    exactRingSize:match.ringSize,
    comfortRingSize,
    targetWidthMm:match.targetWidthMm,
    distanceFromTargetMm:Number((measuredWidthMm-match.targetWidthMm).toFixed(3)),
    lowerBoundaryMm:match.lowerBoundaryMm,
    upperBoundaryMm:match.upperBoundaryMm,
  };
};

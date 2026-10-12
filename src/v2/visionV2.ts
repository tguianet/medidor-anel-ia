export type CardCalibration = {
  pixelsPerMm: number;
  confidence: number;
  cardBox: { x: number; y: number; width: number; height: number };
};

// Checagem em tempo real (sobre o preview da câmera) para encaixar o cartão
// e orientar o ângulo da câmera antes da foto.
export type LiveCardAngleGuide = "forward" | "backward" | "aligned" | "unknown";

export type LiveCardGuideAnalysis = {
  frameAligned: boolean;
  angle: LiveCardAngleGuide;
  skew: number;
  ready: boolean;
  fingerTiltDeg: number | null;
  fingerTiltConfidence: number;
  opticalCenterOffsetPx: number | null;
  cardFingerOffsetPx: number | null;
  opticalCenterConfidence: number;
  cardWidthPx: number | null;
  fingerWidthPx: number | null;
  fingerCardRatio: number | null;
};

export const analyzeLiveCardGuide = (video: HTMLVideoElement): LiveCardGuideAnalysis => {
  const fallback: LiveCardGuideAnalysis = {
    frameAligned: false,
    angle: "unknown",
    skew: 0,
    ready: false,
    fingerTiltDeg: null,
    fingerTiltConfidence: 0,
    opticalCenterOffsetPx: null,
    cardFingerOffsetPx: null,
    opticalCenterConfidence: 0,
    cardWidthPx: null,
    fingerWidthPx: null,
    fingerCardRatio: null,
  };
  if (!video.videoWidth || !video.videoHeight) return fallback;

  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 400;
  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = video.videoWidth / video.videoHeight;
  let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
  if (sourceRatio > targetRatio) {
    sw = video.videoHeight * targetRatio;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / targetRatio;
    sy = (video.videoHeight - sh) / 2;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return fallback;
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  const grayAt = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    const offset = (iy * canvas.width + ix) * 4;
    return pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
  };

  const left = canvas.width * 0.11;
  const right = canvas.width * 0.89;
  const top = canvas.height * 0.1;
  const bottom = top + (canvas.width * 0.78) / 1.586;

  const verticalScore = (x: number, insideDirection: number) => {
    let total = 0;
    let count = 0;
    let continuous = 0;
    for (let y = top + 12; y <= bottom - 12; y += 5) {
      const difference = Math.abs(grayAt(x + insideDirection * 4, y) - grayAt(x - insideDirection * 4, y));
      total += difference;
      if (difference >= 12) continuous++;
      count++;
    }
    const average = total / Math.max(1, count);
    const coverage = continuous / Math.max(1, count);
    return average * (0.35 + coverage * 0.65);
  };

  const horizontalScore = (y: number, insideDirection: number) => {
    let total = 0;
    let count = 0;
    let continuous = 0;
    for (let x = left + 14; x <= right - 14; x += 5) {
      const difference = Math.abs(grayAt(x, y + insideDirection * 4) - grayAt(x, y - insideDirection * 4));
      total += difference;
      if (difference >= 12) continuous++;
      count++;
    }
    const average = total / Math.max(1, count);
    const coverage = continuous / Math.max(1, count);
    return average * (0.35 + coverage * 0.65);
  };

  const bestNear = (position: number, score: (value: number) => number) => {
    let best = 0;
    for (let shift = -9; shift <= 9; shift += 3) best = Math.max(best, score(position + shift));
    return best;
  };

  const scores = [
    bestNear(left, (value) => verticalScore(value, 1)),
    bestNear(right, (value) => verticalScore(value, -1)),
    bestNear(top, (value) => horizontalScore(value, 1)),
    bestNear(bottom, (value) => horizontalScore(value, -1)),
  ];
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const frameAligned = scores.every((score) => score >= 14) && average >= 17;

  // Mede a largura aparente do cartão perto da borda superior e inferior.
  // Se uma delas fica maior, a câmera não está paralela ao plano do cartão.
  const edgeXAt = (expectedX: number, y: number) => {
    let bestX = expectedX;
    let best = -Infinity;
    for (let x = expectedX - 22; x <= expectedX + 22; x += 1) {
      let score = 0;
      let samples = 0;
      for (let yy = y - 7; yy <= y + 7; yy += 3) {
        const contrast = Math.abs(grayAt(x - 3, yy) - grayAt(x + 3, yy));
        score += contrast;
        samples++;
      }
      score /= Math.max(1, samples);
      score -= Math.abs(x - expectedX) * 0.28;
      if (score > best) { best = score; bestX = x; }
    }
    return { x: bestX, score: best };
  };

  const topY = top + 22;
  const bottomY = bottom - 22;
  const lt = edgeXAt(left, topY);
  const rt = edgeXAt(right, topY);
  const lb = edgeXAt(left, bottomY);
  const rb = edgeXAt(right, bottomY);

  const edgeReliable = Math.min(lt.score, rt.score, lb.score, rb.score) >= 7;
  let angle: LiveCardAngleGuide = "unknown";
  let skew = 0;
  let cardWidthPx:number|null=null;

  if (edgeReliable) {
    const topWidth = rt.x - lt.x;
    const bottomWidth = rb.x - lb.x;
    const averageWidth = (topWidth + bottomWidth) / 2;
    if (averageWidth > 80) {
      cardWidthPx=averageWidth;
      skew = (topWidth - bottomWidth) / averageWidth;

      // 2,2% de diferença entre topo/base já é visível na calibração final.
      // Topo mais largo = câmera apontada demais para a parte de cima:
      // orientar o usuário a inclinar o aparelho para trás. E vice-versa.
      if (Math.abs(skew) <= 0.022) angle = "aligned";
      else angle = skew > 0 ? "backward" : "forward";
    }
  }

  // Guia leve de inclinacao do dedo em tempo real.
  // Usa a regiao logo abaixo da base do cartao e acompanha o centro do dedo
  // em varios cortes. Isto serve apenas para orientar o usuario ANTES da foto.
  const fingerCenters:{x:number;y:number;score:number;width:number}[]=[];
  const fingerCenterX=canvas.width/2;
  const fingerTop=Math.min(canvas.height-40,bottom+10);
  const fingerBottom=Math.min(canvas.height-18,bottom+canvas.height*0.30);

  for(let y=fingerTop;y<=fingerBottom;y+=10){
    const candidates:{x:number;score:number}[]=[];
    for(let x=Math.round(canvas.width*0.16);x<=Math.round(canvas.width*0.84);x+=2){
      const contrast=Math.abs(grayAt(x-3,y)-grayAt(x+3,y));
      if(contrast>=10) candidates.push({x,score:contrast});
    }

    const leftCandidates=candidates
      .filter(c=>c.x<fingerCenterX-8)
      .sort((a,b)=>
        (Math.abs(a.x-fingerCenterX)-Math.abs(b.x-fingerCenterX)) ||
        (b.score-a.score)
      );
    const rightCandidates=candidates
      .filter(c=>c.x>fingerCenterX+8)
      .sort((a,b)=>
        (Math.abs(a.x-fingerCenterX)-Math.abs(b.x-fingerCenterX)) ||
        (b.score-a.score)
      );

    let bestPair:{left:number;right:number;score:number}|null=null;
    for(const l of leftCandidates.slice(0,12)){
      for(const r of rightCandidates.slice(0,12)){
        const width=r.x-l.x;
        if(width<canvas.width*0.12 || width>canvas.width*0.48) continue;
        const center=(l.x+r.x)/2;
        const centerPenalty=Math.abs(center-fingerCenterX)*0.18;
        const pairScore=l.score+r.score-centerPenalty;
        if(!bestPair || pairScore>bestPair.score){
          bestPair={left:l.x,right:r.x,score:pairScore};
        }
      }
    }
    if(bestPair){
      fingerCenters.push({
        x:(bestPair.left+bestPair.right)/2,
        y,
        score:bestPair.score,
        width:bestPair.right-bestPair.left,
      });
    }
  }

  let fingerTiltDeg:number|null=null;
  let fingerTiltConfidence=0;
  let opticalCenterOffsetPx:number|null=null;
  let cardFingerOffsetPx:number|null=null;
  let opticalCenterConfidence=0;
  let fingerWidthPx:number|null=null;
  let fingerCardRatio:number|null=null;

  if(fingerCenters.length>=6){
    const meanY=fingerCenters.reduce((s,p)=>s+p.y,0)/fingerCenters.length;
    const meanX=fingerCenters.reduce((s,p)=>s+p.x,0)/fingerCenters.length;
    let numerator=0;
    let denominator=0;
    for(const p of fingerCenters){
      numerator+=(p.y-meanY)*(p.x-meanX);
      denominator+=(p.y-meanY)*(p.y-meanY);
    }
    const slope=denominator>1e-6 ? numerator/denominator : 0;
    const intercept=meanX-slope*meanY;
    const residuals=fingerCenters.map(p=>Math.abs(p.x-(slope*p.y+intercept)));
    const meanResidual=residuals.reduce((s,v)=>s+v,0)/Math.max(1,residuals.length);
    fingerTiltDeg=Math.atan(slope)*180/Math.PI;

    const coverage=Math.min(1,fingerCenters.length/11);
    const residualQuality=Math.max(0,1-meanResidual/8);
    fingerTiltConfidence=Math.round(100*(coverage*0.55+residualQuality*0.45));

    // Largura robusta do dedo no frame ao vivo. Usamos a mediana dos
    // cortes válidos para reduzir textura/sombra local. A razão dedo/cartão
    // permite comparar frames da mesma rajada sem depender da distância.
    const widths=fingerCenters.map(p=>p.width).sort((a,b)=>a-b);
    const mid=Math.floor(widths.length/2);
    fingerWidthPx=widths.length%2
      ? widths[mid]
      : (widths[mid-1]+widths[mid])/2;
    if(cardWidthPx!==null && cardWidthPx>0){
      fingerCardRatio=fingerWidthPx/cardWidthPx;
    }

    // TESTE DE CENTRALIZACAO OPTICA:
    // 1) centro do dedo deve coincidir com o centro optico da imagem;
    // 2) centro do dedo e centro do cartao devem coincidir para reduzir
    //    paralaxe lateral quando o cartao esta sobre o dedo.
    const fittedFingerCenterAtBand=intercept+slope*((fingerTop+fingerBottom)/2);
    const cardCenterTop=(lt.x+rt.x)/2;
    const cardCenterBottom=(lb.x+rb.x)/2;
    const fittedCardCenter=(cardCenterTop+cardCenterBottom)/2;

    opticalCenterOffsetPx=fittedFingerCenterAtBand-canvas.width/2;
    cardFingerOffsetPx=fittedFingerCenterAtBand-fittedCardCenter;

    const cardQuality=edgeReliable ? 1 : 0.35;
    opticalCenterConfidence=Math.round(
      100*Math.min(1,coverage*0.45+residualQuality*0.35+cardQuality*0.20)
    );

    if(fingerTiltConfidence<45 || Math.abs(fingerTiltDeg)>18){
      fingerTiltDeg=null;
      fingerTiltConfidence=0;
    }
    if(opticalCenterConfidence<45){
      opticalCenterOffsetPx=null;
      cardFingerOffsetPx=null;
      opticalCenterConfidence=0;
    }
  }

  return {
    frameAligned,
    angle,
    skew,
    ready: frameAligned && angle === "aligned",
    fingerTiltDeg,
    fingerTiltConfidence,
    opticalCenterOffsetPx,
    cardFingerOffsetPx,
    opticalCenterConfidence,
    cardWidthPx,
    fingerWidthPx,
    fingerCardRatio,
  };
};

export const cardMatchesLiveGuide = (video: HTMLVideoElement) => analyzeLiveCardGuide(video).ready;

export type Box = { minX: number; minY: number; maxX: number; maxY: number; count: number };

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

// Cor NAO e criterio de validade do cartao.
// O cartao e reconhecido prioritariamente pelas bordas, proporcao e tamanho
// padrao 85,60 x 53,98 mm. Esta leitura existe somente como plano B quando
// as bordas estiverem pouco visiveis.
//
// Aceitamos qualquer matiz (azul, verde, vermelho, amarelo, roxo etc.) e
// tambem superficies neutras claras/escuras (cartoes brancos, cinza e pretos).
// A etapa posterior de forma/proporcao impede que a cor, sozinha, valide algo
// que nao tenha geometria de cartao.
export const isChromaticCardSurface = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  const saturation = (max - min) / Math.max(1, max);

  const coloredSurface = max > 35 && saturation >= 0.16;
  const lightNeutralSurface = saturation < 0.16 && brightness >= 175;
  const darkNeutralSurface = saturation < 0.16 && brightness <= 72;

  return coloredSurface || lightNeutralSurface || darkNeutralSurface;
};

export const percentile = (values: number[], amount: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.round((ordered.length - 1) * amount)))];
};

// Plano B para imagens de pouco contraste. Mesmo aqui, só aceitamos algo com
// proporção de cartão; a tonalidade nunca define se o cartão é válido.
const findCardByChromaticRuns = (pixels: Uint8ClampedArray, width: number, height: number): Box | null => {
  type Row = { y: number; left: number; right: number; center: number; runWidth: number };
  const rows: Row[] = [];

  for (let y = 0; y < height; y += 2) {
    let bestStart = -1;
    let bestEnd = -1;
    let start = -1;
    let lastColor = -1;
    // Letras e logotipos criam pequenos espaços na cor do cartão; eles não
    // devem quebrar uma mesma faixa.
    const gapAllowance = Math.max(5, Math.round(width * 0.018));
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (isChromaticCardSurface(pixels[offset], pixels[offset + 1], pixels[offset + 2])) {
        if (start < 0) start = x;
        lastColor = x;
      } else if (start >= 0 && x - lastColor > gapAllowance) {
        if (lastColor - start > bestEnd - bestStart) { bestStart = start; bestEnd = lastColor; }
        start = -1;
        lastColor = -1;
      }
    }
    if (start >= 0 && lastColor - start > bestEnd - bestStart) { bestStart = start; bestEnd = lastColor; }
    const runWidth = bestEnd - bestStart + 1;
    if (runWidth < width * 0.28 || runWidth > width * 0.94) continue;
    rows.push({ y, left: bestStart, right: bestEnd, center: (bestStart + bestEnd) / 2, runWidth });
  }

  let best: Box | null = null;
  let bestScore = 0;
  for (let start = 0; start < rows.length; start++) {
    const group = [rows[start]];
    for (let next = start + 1; next < rows.length; next++) {
      const previous = group[group.length - 1];
      const candidate = rows[next];
      if (candidate.y - previous.y > 6) break;
      if (Math.abs(candidate.center - previous.center) > width * 0.1 || Math.abs(candidate.runWidth - previous.runWidth) > width * 0.16) break;
      group.push(candidate);
    }
    if (group.length < 8) continue;
    const boxWidth = percentile(group.map((row) => row.runWidth), 0.5);
    const boxHeight = group[group.length - 1].y - group[0].y + 2;
    const ratio = boxWidth / Math.max(1, boxHeight);
    if (ratio < 1.2 || ratio > 2.15) continue;
    const averageCenter = group.reduce((sum, row) => sum + row.center, 0) / group.length;
    const left = Math.round(averageCenter - boxWidth / 2);
    const top = group[0].y;
    const ratioQuality = 1 - Math.min(1, Math.abs(ratio - 1.586) / 0.45);
    const score = group.length * boxWidth * (0.35 + ratioQuality * 0.65);
    if (score > bestScore) {
      best = { minX: Math.max(0, left), maxX: Math.min(width - 1, left + boxWidth - 1), minY: top, maxY: Math.min(height - 1, top + boxHeight - 1), count: group.length * boxWidth };
      bestScore = score;
    }
  }
  return best;
};

const findCardByEdges = (pixels: Uint8ClampedArray, width: number, height: number): Box | null => {
  const total = width * height;
  const gray = new Uint8Array(total);
  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    gray[index] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }

  const strength = new Uint16Array(total);
  const samples: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gx = gray[index + 1] - gray[index - 1];
      const gy = gray[index + width] - gray[index - width];
      const value = Math.abs(gx) + Math.abs(gy);
      strength[index] = value;
      if ((x + y) % 3 === 0) samples.push(value);
    }
  }
  const threshold = Math.max(28, percentile(samples, 0.84));
  let mask = new Uint8Array(total);
  for (let index = 0; index < total; index++) mask[index] = strength[index] >= threshold ? 1 : 0;

  // Une bordas interrompidas por reflexos, letras e cantos arredondados.
  for (let pass = 0; pass < 4; pass++) {
    const expanded = new Uint8Array(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (mask[index]) continue;
        if (mask[index - 1] || mask[index + 1] || mask[index - width] || mask[index + width]) expanded[index] = 1;
      }
    }
    mask = expanded;
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let best: Box | null = null;
  let bestScore = 0;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const box: Box = { minX: width, minY: height, maxX: 0, maxY: 0, count: 0 };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.count++;
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        if (Math.abs((next % width) - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;
    const area = boxWidth * boxHeight;
    const areaShare = area / total;
    const ratio = Math.max(boxWidth, boxHeight) / Math.max(1, Math.min(boxWidth, boxHeight));
    if (areaShare < 0.012 || areaShare > 0.58 || ratio < 1.25 || ratio > 2.02) continue;
    const ratioQuality = 1 - Math.min(1, Math.abs(ratio - 1.586) / 0.5);
    const density = Math.min(1, box.count / Math.max(1, area * 0.18));
    const score = areaShare * (0.35 + ratioQuality * 0.65) * (0.4 + density * 0.6);
    if (score > bestScore) { best = box; bestScore = score; }
  }
  return best;
};

const refineCardBoxByKnownRatio = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seed: Box,
): Box => {
  const gray=new Uint8Array(width*height);
  for(let i=0;i<width*height;i++){
    const o=i*4;
    gray[i]=Math.round(pixels[o]*0.299+pixels[o+1]*0.587+pixels[o+2]*0.114);
  }

  const grayAt=(x:number,y:number)=>{
    const xx=Math.max(0,Math.min(width-1,Math.round(x)));
    const yy=Math.max(0,Math.min(height-1,Math.round(y)));
    return gray[yy*width+xx];
  };

  const seedW=Math.max(20,seed.maxX-seed.minX+1);
  const seedH=Math.max(12,seed.maxY-seed.minY+1);

  const verticalScore=(x:number,y0:number,y1:number)=>{
    let total=0, strong=0, count=0;
    const step=Math.max(1,Math.round((y1-y0)/70));
    for(let y=y0;y<=y1;y+=step){
      const d=Math.abs(grayAt(x-2,y)-grayAt(x+2,y));
      total+=d;
      if(d>=16) strong++;
      count++;
    }
    const avg=total/Math.max(1,count);
    const coverage=strong/Math.max(1,count);
    return avg*(0.45+coverage*0.55);
  };

  const horizontalScore=(y:number,x0:number,x1:number)=>{
    let total=0, strong=0, count=0;
    const step=Math.max(1,Math.round((x1-x0)/90));
    for(let x=x0;x<=x1;x+=step){
      const d=Math.abs(grayAt(x,y-2)-grayAt(x,y+2));
      total+=d;
      if(d>=16) strong++;
      count++;
    }
    const avg=total/Math.max(1,count);
    const coverage=strong/Math.max(1,count);
    return avg*(0.40+coverage*0.60);
  };

  // 1) Refina as laterais em torno da caixa candidata.
  const sideSearch=Math.max(5,Math.round(seedW*0.055));
  const y0=Math.max(2,Math.round(seed.minY+seedH*0.16));
  const y1=Math.min(height-3,Math.round(seed.maxY-seedH*0.10));

  let leftX=seed.minX, leftBest=-Infinity;
  for(let x=Math.max(2,seed.minX-sideSearch);x<=Math.min(width-3,seed.minX+sideSearch);x++){
    const score=verticalScore(x,y0,y1)-Math.abs(x-seed.minX)*0.22;
    if(score>leftBest){leftBest=score;leftX=x;}
  }

  let rightX=seed.maxX, rightBest=-Infinity;
  for(let x=Math.max(2,seed.maxX-sideSearch);x<=Math.min(width-3,seed.maxX+sideSearch);x++){
    const score=verticalScore(x,y0,y1)-Math.abs(x-seed.maxX)*0.22;
    if(score>rightBest){rightBest=score;rightX=x;}
  }

  if(rightX-leftX<width*0.35){
    leftX=seed.minX;
    rightX=seed.maxX;
  }

  const cardW=Math.max(20,rightX-leftX+1);

  // 2) Procura TOPO + BASE como um par físico.
  // Não usamos mais seed.maxY como âncora, porque dedos, régua ou outros
  // objetos podem estar conectados ao componente de borda e puxar a caixa.
  const x0=Math.max(2,Math.round(leftX+cardW*0.07));
  const x1=Math.min(width-3,Math.round(rightX-cardW*0.07));
  const expectedH=cardW/1.586;

  let topY=Math.max(2,Math.round(seed.minY));
  let bottomY=Math.min(height-3,Math.round(topY+expectedH));
  let pairBest=-Infinity;

  // Permite pequena perspectiva vertical: altura aparente entre 92% e 108%
  // do valor previsto pela proporção física do cartão.
  for(let factor=0.92;factor<=1.081;factor+=0.02){
    const candidateH=expectedH*factor;
    const maxTop=Math.min(height-3-Math.round(candidateH),Math.round(height*0.78));

    for(let yTop=2;yTop<=maxTop;yTop+=1){
      const yBottom=Math.round(yTop+candidateH);
      if(yBottom>=height-2) continue;

      const topEdge=horizontalScore(yTop,x0,x1);
      const bottomEdge=horizontalScore(yBottom,x0,x1);

      // As laterais também precisam existir ENTRE o topo e a base candidatos.
      // Isso derruba linhas internas de texto, juntas dos dedos e objetos
      // estreitos que não formam um cartão completo.
      const leftSide=verticalScore(leftX,yTop+3,yBottom-3);
      const rightSide=verticalScore(rightX,yTop+3,yBottom-3);

      const edgeMin=Math.min(topEdge,bottomEdge);
      const sideMin=Math.min(leftSide,rightSide);

      // Prefere pares com quatro bordas contínuas e com centro próximo da
      // região do candidato original, mas a proximidade tem peso pequeno.
      const candidateCenter=(yTop+yBottom)/2;
      const seedCenter=(seed.minY+seed.maxY)/2;
      const centerPenalty=Math.abs(candidateCenter-seedCenter)*0.025;

      const score=
        topEdge*0.30+
        bottomEdge*0.30+
        leftSide*0.20+
        rightSide*0.20+
        edgeMin*0.18+
        sideMin*0.12-
        centerPenalty;

      if(score>pairBest){
        pairBest=score;
        topY=yTop;
        bottomY=yBottom;
      }
    }
  }

  // Segurança final: o par aceito precisa continuar compatível com o formato
  // físico do cartão. Se algo extremo escapar, força a altura teórica.
  const refinedH=Math.max(1,bottomY-topY+1);
  const refinedRatio=cardW/refinedH;
  if(refinedRatio<1.42 || refinedRatio>1.76){
    const center=(topY+bottomY)/2;
    topY=Math.max(0,Math.round(center-expectedH/2));
    bottomY=Math.min(height-1,Math.round(center+expectedH/2));
  }

  return {
    minX:Math.max(0,leftX),
    maxX:Math.min(width-1,rightX),
    minY:Math.max(0,topY),
    maxY:Math.min(height-1,bottomY),
    count:seed.count,
  };
};

// Detector primario independente de cor e pouco sensivel ao fundo.
// A camera ja possui uma guia geometrica conhecida: o cartao deve ocupar
// aproximadamente 78% da largura, centralizado. Usamos essa geometria apenas
// como SEMENTE e depois refinamos nas bordas fisicas reais.
const findCardFromCameraGuide = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Box | null => {
  if(width<40 || height<40) return null;

  const guideLeft=Math.round(width*0.11);
  const guideRight=Math.round(width*0.89);
  const guideWidth=Math.max(20,guideRight-guideLeft);
  const expectedHeight=guideWidth/1.586;
  const guideTop=Math.round(height*0.10);
  const guideBottom=Math.min(height-1,Math.round(guideTop+expectedHeight));

  const seed:Box={
    minX:guideLeft,
    maxX:guideRight,
    minY:guideTop,
    maxY:guideBottom,
    count:guideWidth*Math.max(1,guideBottom-guideTop),
  };

  const refined=refineCardBoxByKnownRatio(pixels,width,height,seed);
  const refinedWidth=refined.maxX-refined.minX+1;
  const refinedHeight=refined.maxY-refined.minY+1;
  if(refinedWidth<=0 || refinedHeight<=0) return null;

  const ratio=refinedWidth/refinedHeight;
  const widthShare=refinedWidth/width;
  const center=((refined.minX+refined.maxX)/2)/width;

  // A semente da guia so e aceita quando o refinamento continua fisicamente
  // plausivel para um cartao inteiro. Nenhuma informacao de cor entra aqui.
  if(
    widthShare<0.50 || widthShare>0.94 ||
    ratio<1.40 || ratio>1.78 ||
    Math.abs(center-0.5)>0.13
  ){
    return null;
  }

  return refined;
};

// A câmera já pede que o cartão ocupe quase toda a largura da guia. Portanto,
// um trecho curto de texto, logotipo ou brilho nunca pode virar a base.
export const scoreCardShape = (box: Box, imageWidth: number, imageHeight: number) => {
  const boxWidth = box.maxX - box.minX + 1;
  const boxHeight = box.maxY - box.minY + 1;
  const widthShare = boxWidth / imageWidth;
  const heightShare = boxHeight / imageHeight;
  const ratio = boxWidth / Math.max(1, boxHeight);
  const ratioQuality = 1 - Math.min(1, Math.abs(ratio - 1.586) / 0.42);
  const guideWidthQuality = 1 - Math.min(1, Math.abs(widthShare - 0.78) / 0.36);
  const center = (box.minX + box.maxX) / 2 / imageWidth;
  const centerQuality = 1 - Math.min(1, Math.abs(center - 0.5) / 0.36);
  const heightQuality = heightShare >= 0.14 && heightShare <= 0.62 ? 1 : 0.35;
  return ratioQuality * 0.52 + guideWidthQuality * 0.34 + centerQuality * 0.1 + heightQuality * 0.04;
};

export async function calibratePhoto(photo: string): Promise<CardCalibration> {
  const image = await loadImage(photo);
  const work = document.createElement("canvas");
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  work.width = Math.max(1, Math.round(image.naturalWidth * scale));
  work.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, work.width, work.height);
  const pixels = ctx.getImageData(0, 0, work.width, work.height).data;
  const total = work.width * work.height;
  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    mask[index] = isChromaticCardSurface(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ? 1 : 0;
  }
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let colorCandidate: Box | null = null;
  let colorScore = 0;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const box: Box = { minX: work.width, minY: work.height, maxX: 0, maxY: 0, count: 0 };
    while (head < tail) {
      const index = queue[head++];
      const x = index % work.width;
      const y = (index / work.width) | 0;
      box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y); box.count++;
      for (const next of [index - 1, index + 1, index - work.width, index + work.width]) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue;
        if (Math.abs((next % work.width) - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    const width = box.maxX - box.minX + 1;
    const height = box.maxY - box.minY + 1;
    const areaShare = width * height / total;
    const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    const density = box.count / Math.max(1, width * height);
    if (areaShare < 0.008 || areaShare > 0.48 || ratio < 1.25 || ratio > 2.15 || density < 0.12) continue;
    const score = box.count * density * (1 - Math.min(1, Math.abs(ratio - 1.586) / 0.8));
    if (score > colorScore) { colorCandidate = box; colorScore = score; }
  }
  const runCandidate = findCardByChromaticRuns(pixels, work.width, work.height);

  // PRIORIDADE 1: a propria guia da camera fornece uma semente geometrica.
  // Isso torna a deteccao principal independente da cor do cartao e reduz
  // drasticamente a influencia da cor/textura do fundo.
  const guideCandidate = findCardFromCameraGuide(pixels, work.width, work.height);

  // PRIORIDADE 2: detector global de bordas, mantido como redundancia.
  const edgeCandidate = findCardByEdges(pixels, work.width, work.height);

  // Cada candidato bruto passa por um refinamento baseado nas quatro bordas
  // e na proporção física real 85,60 x 53,98 mm. Assim elementos conectados
  // acima/abaixo do cartão não entram na caixa final.
  // PRIORIDADE DE DETECCAO:
  // 1) bordas fisicas refinadas a partir da guia da camera;
  // 2) detector global de bordas;
  // 3) somente se ambos falharem, cor/faixas entram como fallback.
  //
  // O fundo nao participa da escolha principal.
  const guideRefined = guideCandidate;

  const guideScore = guideRefined
    ? scoreCardShape(guideRefined,work.width,work.height)
    : 0;

  const guideWidthShare = guideRefined
    ? (guideRefined.maxX-guideRefined.minX+1)/work.width
    : 0;

  const guideReliable =
    guideRefined !== null &&
    guideWidthShare >= 0.50 &&
    guideScore >= 0.48;

  const edgeRefined = edgeCandidate
    ? refineCardBoxByKnownRatio(pixels,work.width,work.height,edgeCandidate)
    : null;

  const edgeScore = edgeRefined
    ? scoreCardShape(edgeRefined,work.width,work.height)
    : 0;

  const edgeWidthShare = edgeRefined
    ? (edgeRefined.maxX-edgeRefined.minX+1)/work.width
    : 0;

  // Consideramos a borda fisica confiavel quando a geometria esta coerente
  // com o cartao inteiro na guia. Nessa condicao, ignoramos completamente a cor.
  const edgeReliable =
    edgeRefined !== null &&
    edgeWidthShare >= 0.42 &&
    edgeScore >= 0.42;

  let best: Box | null = null;

  if(guideReliable && guideRefined){
    best=guideRefined;
  }else if(edgeReliable && edgeRefined){
    best=edgeRefined;
  }else{
    // Fallback final: cor/faixas apenas fornecem uma semente.
    // A caixa ainda precisa ser refinada pelas quatro bordas e pela proporcao.
    const fallbackRaw = [runCandidate,colorCandidate]
      .filter((candidate): candidate is Box => candidate !== null);

    const fallbackCandidates = fallbackRaw.map(candidate =>
      refineCardBoxByKnownRatio(pixels,work.width,work.height,candidate)
    );

    best = fallbackCandidates.sort(
      (a,b)=>scoreCardShape(b,work.width,work.height)-scoreCardShape(a,work.width,work.height)
    )[0] ?? null;

    if(!best && guideRefined) best=guideRefined;
    if(!best && edgeRefined) best=edgeRefined;
  }
  const bestWidthShare = best ? (best.maxX - best.minX + 1) / work.width : 0;
  if (!best || bestWidthShare < 0.42) throw new Error("Não encontrei a base inteira do cartão. Deixe os dois cantos inferiores visíveis e alinhe o cartão na guia.");

  let axisA = best.maxX - best.minX + 1;
  let axisB = best.maxY - best.minY + 1;
  const longPx = Math.max(axisA, axisB) / scale;
  const shortPx = Math.min(axisA, axisB) / scale;
  const longScale = longPx / 85.6;
  const observedRatio = longPx / Math.max(1, shortPx);
  const ratioError = Math.abs(observedRatio - 1.586) / 1.586;

  return {
    pixelsPerMm: longScale,
    confidence: Math.max(70, Math.min(98, Math.round(98 - ratioError * 45))),
    cardBox: {
      x: best.minX / work.width,
      y: best.minY / work.height,
      width: (best.maxX - best.minX + 1) / work.width,
      height: (best.maxY - best.minY + 1) / work.height,
    },
  };
}

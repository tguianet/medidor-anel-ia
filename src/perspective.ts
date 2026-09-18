export type Point = { x: number; y: number };
export type Line = { a: Point; b: Point };

const solve = (a: number[][], b: number[]) => {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col];
    if (Math.abs(d) < 1e-10) throw new Error("Quadrilátero inválido");
    for (let j = col; j <= n; j++) m[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = m[row][col];
      for (let j = col; j <= n; j++) m[row][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row[n]);
};

export const homographyFromQuad = (quad: [Point, Point, Point, Point], width = 85.6, height = 53.98) => {
  const dst: [Point, Point, Point, Point] = [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
  const A:number[][]=[]; const B:number[]=[];
  quad.forEach((p,i)=>{ const q=dst[i];
    A.push([p.x,p.y,1,0,0,0,-q.x*p.x,-q.x*p.y]); B.push(q.x);
    A.push([0,0,0,p.x,p.y,1,-q.y*p.x,-q.y*p.y]); B.push(q.y);
  });
  const h=solve(A,B);
  return (p:Point):Point => {
    const d=h[6]*p.x+h[7]*p.y+1;
    return {x:(h[0]*p.x+h[1]*p.y+h[2])/d,y:(h[3]*p.x+h[4]*p.y+h[5])/d};
  };
};

export const distance = (a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);


export type CardGeometryAssessment = {
  valid: boolean;
  confidence: number;
  widthPerspective: number;
  heightPerspective: number;
  aspectError: number;
  reason: string | null;
};

export const assessCardQuadGeometry = (
  quad: [Point, Point, Point, Point],
  expectedWidth = 85.6,
  expectedHeight = 53.98,
): CardGeometryAssessment => {
  const [tl, tr, br, bl] = quad;
  const top = distance(tl, tr);
  const bottom = distance(bl, br);
  const left = distance(tl, bl);
  const right = distance(tr, br);
  const averageWidth = (top + bottom) / 2;
  const averageHeight = (left + right) / 2;
  const expectedAspect = expectedWidth / expectedHeight;
  const observedAspect = averageWidth / Math.max(1e-6, averageHeight);
  const widthPerspective = Math.abs(top - bottom) / Math.max(1e-6, averageWidth);
  const heightPerspective = Math.abs(left - right) / Math.max(1e-6, averageHeight);
  const aspectError = Math.abs(observedAspect - expectedAspect) / expectedAspect;

  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const crosses = [
    cross(tl, tr, br),
    cross(tr, br, bl),
    cross(br, bl, tl),
    cross(bl, tl, tr),
  ];
  const convex = crosses.every((value) => value > 0) || crosses.every((value) => value < 0);
  const edgesHealthy = Math.min(top, bottom, left, right) > 8;

  // O cartão pode ter alguma perspectiva, mas quando as bordas opostas
  // divergem demais a escala fica sensível a poucos pixels. Nessa situação
  // preferimos pedir outra calibração em vez de devolver um aro instável.
  const valid = convex
    && edgesHealthy
    && widthPerspective <= 0.16
    && heightPerspective <= 0.16
    && aspectError <= 0.24;

  let reason: string | null = null;
  if (!convex || !edgesHealthy) reason = "As quatro linhas não formam um cartão válido.";
  else if (widthPerspective > 0.16 || heightPerspective > 0.16) reason = "O cartão está inclinado demais. Deixe-o mais paralelo à câmera e calibre novamente.";
  else if (aspectError > 0.24) reason = "A proporção do cartão ficou fora do esperado. Reencaixe as quatro bordas.";

  const penalty = Math.max(widthPerspective, heightPerspective) * 105 + aspectError * 42;
  const confidence = Math.max(72, Math.min(98, Math.round(98 - penalty)));

  return { valid, confidence, widthPerspective, heightPerspective, aspectError, reason };
};

export const localMmPerPixel = (quad:[Point,Point,Point,Point], p:Point) => {
  const map=homographyFromQuad(quad);
  return distance(map(p),map({x:p.x+1,y:p.y}));
};


export const lineIntersection = (l1: Line, l2: Line): Point => {
  const x1=l1.a.x, y1=l1.a.y, x2=l1.b.x, y2=l1.b.y;
  const x3=l2.a.x, y3=l2.a.y, x4=l2.b.x, y4=l2.b.y;
  const den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
  if (Math.abs(den)<1e-8) throw new Error("Linhas paralelas");
  const p1=x1*y2-y1*x2;
  const p2=x3*y4-y3*x4;
  return {
    x:(p1*(x3-x4)-(x1-x2)*p2)/den,
    y:(p1*(y3-y4)-(y1-y2)*p2)/den,
  };
};

export const quadFromLines = (lines: { top: Line; right: Line; bottom: Line; left: Line }): [Point,Point,Point,Point] => [
  lineIntersection(lines.top, lines.left),
  lineIntersection(lines.top, lines.right),
  lineIntersection(lines.bottom, lines.right),
  lineIntersection(lines.bottom, lines.left),
];

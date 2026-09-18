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

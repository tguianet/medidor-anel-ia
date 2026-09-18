export type Point = { x: number; y: number };

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

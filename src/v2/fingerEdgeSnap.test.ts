import { describe, expect, it } from "vitest";
import { snapFingerEdge, type SnapImage } from "./fingerEdgeSnap";

// Dedo reto de largura W (perpendicular), inclinado em `tiltDeg`,
// com sombreado nas bordas, sombra externa, ruido e textura de mesa.
const makeFinger = (tiltDeg: number, widthPx = 180, seed = 5, darkShadow = false): SnapImage & { centerAt: (y: number) => number } => {
  const width = 900, height = 1200;
  const data = new Uint8ClampedArray(width * height * 4);
  const slope = Math.tan((tiltDeg * Math.PI) / 180);
  const cos = Math.cos((tiltDeg * Math.PI) / 180);
  const halfH = widthPx / 2 / cos; // meia largura na horizontal
  const centerAt = (y: number) => 450 + slope * (y - 700);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 6;
  for (let y = 0; y < height; y++) {
    const c = centerAt(y);
    for (let x = 0; x < width; x++) {
      const d = (x - c) / halfH; // -1..1 dentro do dedo
      let rgb: number[];
      if (Math.abs(d) <= 1) {
        const shade = 0.8 + 0.2 * Math.cos((d * Math.PI) / 2);
        rgb = [214 * shade, 156 * shade, 128 * shade];
      } else {
        const out = (Math.abs(d) - 1) * halfH;
        // sombra: clara (0,88) ou mais escura que a pele (0,45), 6 px
        const k = out < 6 ? (darkShadow ? 0.45 : 0.88 + 0.02 * out) : 1;
        const tex = Math.sin(y * 0.04 + x * 0.008) * 4;
        rgb = [(228 + tex) * k, (224 + tex) * k, (218 + tex) * k];
      }
      const o = (y * width + x) * 4;
      data[o] = rgb[0] + rnd(); data[o + 1] = rgb[1] + rnd(); data[o + 2] = rgb[2] + rnd(); data[o + 3] = 255;
    }
  }
  return { data, width, height, centerAt };
};

describe("snapFingerEdge", () => {
  for (const tilt of [0, 5, 12, -8]) {
    it(`segue a borda inclinada a ${tilt} graus e mede a largura perpendicular`, () => {
      const img = makeFinger(tilt);
      const y0 = 700;
      const halfH = 90 / Math.cos((tilt * Math.PI) / 180);
      // Usuario solta as linhas ~8 px fora/dentro da borda real.
      const left = snapFingerEdge(img, { side: "left", seedX: img.centerAt(y0) - halfH + 8, seedY: y0 });
      const right = snapFingerEdge(img, { side: "right", seedX: img.centerAt(y0) + halfH - 7, seedY: y0 });
      expect(left).not.toBe(null);
      expect(right).not.toBe(null);
      if (!left || !right) return;
      expect(Math.abs(left.tiltDeg - tilt)).toBeLessThan(0.8);
      expect(Math.abs(right.tiltDeg - tilt)).toBeLessThan(0.8);
      // Largura perpendicular = distancia horizontal * cos(inclinacao).
      const meanSlope = (left.slope + right.slope) / 2;
      const perpendicular = (right.x0 - left.x0) * Math.cos(Math.atan(meanSlope));
      // As linhas sao GUIAS (a medicao reencontra a borda); aceitamos 4 px.
      expect(Math.abs(perpendicular - 180)).toBeLessThan(4);
      expect(Math.abs(left.x0 - (img.centerAt(y0) - halfH))).toBeLessThan(2);
      expect(Math.abs(right.x0 - (img.centerAt(y0) + halfH))).toBeLessThan(2);
      expect(left.coveredPx).toBeGreaterThan(200);
    });
  }


  for (const tilt of [0, 6]) {
    it(`com sombra mais escura que a pele (${tilt} graus) gruda na pele, nao na sombra`, () => {
      const img = makeFinger(tilt, 180, 9, true);
      const y0 = 700;
      const halfH = 90 / Math.cos((tilt * Math.PI) / 180);
      const trueL = img.centerAt(y0) - halfH;
      const trueR = img.centerAt(y0) + halfH;
      // usuario solta a linha na sombra (4 px para fora)
      const left = snapFingerEdge(img, { side: "left", seedX: trueL - 4, seedY: y0 });
      const right = snapFingerEdge(img, { side: "right", seedX: trueR + 4, seedY: y0 });
      expect(left).not.toBe(null);
      expect(right).not.toBe(null);
      if (!left || !right) return;
      expect(Math.abs(left.x0 - trueL)).toBeLessThan(1.5);
      expect(Math.abs(right.x0 - trueR)).toBeLessThan(1.5);
      expect(Math.abs(left.tiltDeg - tilt)).toBeLessThan(0.8);
    });
  }

  it("nao inventa borda quando nao ha dedo perto", () => {
    const img = makeFinger(0);
    const r = snapFingerEdge(img, { side: "left", seedX: 150, seedY: 700 });
    expect(r).toBe(null);
  });
});

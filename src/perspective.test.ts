import { describe, expect, it } from "vitest";
import { homographyFromQuad, distance } from "./perspective";

describe("perspective calibration", () => {
  it("maps an axis aligned ID-1 card to millimetres", () => {
    const map=homographyFromQuad([{x:10,y:20},{x:181.2,y:20},{x:181.2,y:127.96},{x:10,y:127.96}]);
    expect(distance(map({x:10,y:20}),map({x:181.2,y:20}))).toBeCloseTo(85.6,5);
    expect(distance(map({x:10,y:20}),map({x:10,y:127.96}))).toBeCloseTo(53.98,5);
  });
  it("rectifies a perspective quadrilateral", () => {
    const q=[{x:40,y:30},{x:230,y:48},{x:210,y:160},{x:55,y:145}] as const;
    const map=homographyFromQuad([...q]);
    expect(map(q[0]).x).toBeCloseTo(0,5);
    expect(map(q[1]).x).toBeCloseTo(85.6,5);
    expect(map(q[2]).y).toBeCloseTo(53.98,5);
    expect(map(q[3]).x).toBeCloseTo(0,5);
  });
});

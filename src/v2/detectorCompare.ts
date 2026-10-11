// DIAGNOSTICO (medidordedov4): roda, na MESMA foto, a deteccao de cartao da
// versao nova (v1: caixa grossa por cor + bordas findCardEdge + compensacao
// +1,75 px/lateral) para comparar com a deteccao original, que continua sendo
// a unica usada no resultado.
import { findCardEdge } from "./cardEdges";

export type CardEdgesPx = { left: number; right: number; bottom: number; widthPx: number; refined: boolean };

export const refineCardEdgesNew = (
  image: { data: Uint8ClampedArray; width: number; height: number },
  box: { leftPct: number; rightPct: number; topPct: number; bottomPct: number },
): CardEdgesPx => {
  const W = image.width;
  const H = image.height;
  const left0 = (box.leftPct / 100) * W;
  const right0 = (box.rightPct / 100) * W;
  const top0 = (box.topPct / 100) * H;
  const bottom0 = (box.bottomPct / 100) * H;
  const cardW = Math.max(40, right0 - left0);
  const cardH = Math.max(30, bottom0 - top0);
  const from = top0 + cardH * 0.14;
  const to = bottom0 - cardH * 0.14;
  const l = findCardEdge(image, { side: "left", expected: left0, from, to });
  const r = findCardEdge(image, { side: "right", expected: right0, from, to });
  const OUT = 1.75;
  const refinedLeft = Math.min(l.position, r.position - 20) - OUT;
  const refinedRight = Math.max(r.position, l.position + 20) + OUT;
  const b = findCardEdge(image, {
    side: "bottom", expected: bottom0,
    from: refinedLeft + cardW * 0.1, to: refinedRight - cardW * 0.1, searchPx: 14,
  });
  const ok =
    l.reliable && r.reliable && b.strength >= 7 &&
    refinedRight - refinedLeft >= cardW * 0.92 && refinedRight - refinedLeft <= cardW * 1.1;
  if (!ok) return { left: left0, right: right0, bottom: bottom0, widthPx: right0 - left0, refined: false };
  return { left: refinedLeft, right: refinedRight, bottom: b.position, widthPx: refinedRight - refinedLeft, refined: true };
};

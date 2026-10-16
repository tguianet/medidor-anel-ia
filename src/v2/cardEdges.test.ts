import { describe, expect, it } from "vitest";
import { findCardEdge, type RgbaImage } from "./cardEdges";

// Cenas sinteticas: cartao de cores diferentes sobre fundos diferentes,
// com sombra projetada, friso interno, ruido de camera e leve desfoque.
// A borda verdadeira do cartao esta entre os pixels 99|100 (esquerda) e
// 799|800 (direita), ou seja, em 99,5 e 799,5.

type Rgb = [number, number, number];

export const CARD_COLORS: Record<string, Rgb> = {
  branco: [238, 238, 234],
  preto: [22, 22, 26],
  vermelho: [178, 28, 36],
  azulMarinho: [18, 32, 92],
  cinzaMedio: [128, 128, 132],
  dourado: [196, 160, 82],
  verde: [20, 110, 70],
};

export const BACKGROUNDS: Record<string, Rgb> = {
  madeiraEscura: [92, 60, 38],
  mesaBranca: [232, 230, 226],
  cinza: [120, 120, 118],
};

export const TRUE_LEFT = 99.5;
export const TRUE_RIGHT = 799.5;
export const TRUE_BOTTOM = 499.5;

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

export const makeScene = (card: Rgb, background: Rgb, seed = 7): RgbaImage => {
  const width = 900;
  const height = 620;
  const random = seeded(seed);
  const raw = new Float32Array(width * height * 3);
  const friso: Rgb = card[0] + card[1] + card[2] > 380 ? [60, 60, 70] : [215, 205, 170];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const insideCard = x >= 100 && x < 800 && y >= 60 && y < 500;
      let color: number[];
      if (insideCard) {
        color = [...card];
        // Friso decorativo 9-12 px para dentro, nas laterais.
        if (x - 100 >= 9 && x - 100 < 12) color = [...friso];
        if (799 - x >= 9 && 799 - x < 12) color = [...friso];
        // Faixa e texto internos.
        if (y > 150 && y < 175 && x > 150 && x < 750) color = color.map((c) => c * 0.55);
      } else {
        // Fundo com veios.
        const grain = Math.sin(y * 0.07 + x * 0.004) * 8;
        color = background.map((c) => c + grain);
        // Sombra suave a direita e abaixo do cartao.
        const dxShadow = x - 799;
        const dyShadow = y - 499;
        if (dxShadow > 0 && dxShadow <= 10 && y > 66 && y < 506) {
          color = color.map((c) => c * (0.62 + 0.038 * dxShadow));
        }
        if (dyShadow > 0 && dyShadow <= 10 && x > 106 && x < 806) {
          color = color.map((c) => c * (0.62 + 0.038 * dyShadow));
        }
      }
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = color[c] + (random() - 0.5) * 14;
    }
  }

  // Desfoque 3x3 (lente/compressao do celular).
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const xx = Math.min(width - 1, Math.max(0, x + ox));
            const yy = Math.min(height - 1, Math.max(0, y + oy));
            sum += raw[(yy * width + xx) * 3 + c];
            count++;
          }
        }
        data[(y * width + x) * 4 + c] = sum / count;
      }
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { data, width, height };
};

// O detector recebe uma posicao esperada um pouco errada, como acontece com
// a caixa grosseira vinda da foto reduzida.
const measure = (image: RgbaImage) => {
  const left = findCardEdge(image, { side: "left", expected: 106, from: 120, to: 440 });
  const right = findCardEdge(image, { side: "right", expected: 792, from: 120, to: 440 });
  const bottom = findCardEdge(image, { side: "bottom", expected: 494, from: 200, to: 700, searchPx: 14 });
  return { left, right, bottom, widthPx: right.position - left.position };
};

describe("findCardEdge", () => {
  const trueWidth = TRUE_RIGHT - TRUE_LEFT;

  for (const [backgroundName, background] of Object.entries(BACKGROUNDS)) {
    for (const [cardName, card] of Object.entries(CARD_COLORS)) {
      // Cenarios fisicamente impossiveis de medir: cartao da mesma cor do
      // fundo, ou da mesma cor da propria sombra que cai na borda.
      const contrast = (a: number[], b: number[]) =>
        Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / 3);
      const shadow = background.map((c) => c * 0.62);
      if (contrast(card, background) < 20 || contrast(card, shadow) < 20) continue;

      it(`acha as bordas do cartao ${cardName} em ${backgroundName}`, () => {
        const result = measure(makeScene(card, background));
        expect(Math.abs(result.left.position - TRUE_LEFT)).toBeLessThan(1);
        expect(Math.abs(result.right.position - TRUE_RIGHT)).toBeLessThan(1);
        expect(Math.abs(result.bottom.position - TRUE_BOTTOM)).toBeLessThan(1.5);
        // Erro de largura < 0,25% => bem abaixo de 1 aro (~2%).
        expect(Math.abs(result.widthPx - trueWidth) / trueWidth).toBeLessThan(0.0025);
        expect(result.left.reliable && result.right.reliable).toBe(true);
      });
    }
  }

  it("a largura medida nao muda com a cor do cartao (mesmo fundo)", () => {
    const widths = Object.values(CARD_COLORS).map((card) =>
      measure(makeScene(card, BACKGROUNDS.madeiraEscura)).widthPx,
    );
    const spread = Math.max(...widths) - Math.min(...widths);
    expect(spread / trueWidth).toBeLessThan(0.003);
  });
});

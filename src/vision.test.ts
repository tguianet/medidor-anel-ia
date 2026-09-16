import { describe, expect, it } from "vitest";
import { isChromaticCardSurface, percentile, scoreCardShape } from "./vision";

describe("isChromaticCardSurface", () => {
  it("aceita azul saturado (cor fria)", () => {
    expect(isChromaticCardSurface(40, 60, 200)).toBe(true);
  });
  it("aceita vermelho vívido", () => {
    expect(isChromaticCardSurface(200, 60, 50)).toBe(true);
  });
  it("rejeita cinza/branco de baixa saturação (madeira, pele, fundo neutro)", () => {
    expect(isChromaticCardSurface(180, 170, 160)).toBe(false);
  });
  it("rejeita pixels muito escuros mesmo que saturados", () => {
    expect(isChromaticCardSurface(20, 10, 45)).toBe(false);
  });
});

describe("percentile", () => {
  it("retorna o menor valor no percentil 0", () => {
    expect(percentile([5, 1, 3, 2, 4], 0)).toBe(1);
  });
  it("retorna o maior valor no percentil 1", () => {
    expect(percentile([5, 1, 3, 2, 4], 1)).toBe(5);
  });
  it("retorna a mediana aproximada no percentil 0.5", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
  it("não quebra com lista vazia", () => {
    expect(percentile([], 0.5)).toBeUndefined();
  });
});

describe("scoreCardShape", () => {
  const imageWidth = 1000;
  const imageHeight = 1000;

  it("dá pontuação alta para um retângulo com a proporção real do cartão (85,6x53,98mm), largo e centralizado", () => {
    const width = 780;
    const height = Math.round(width / 1.586);
    const box = { minX: 110, minY: 300, maxX: 110 + width - 1, maxY: 300 + height - 1, count: 0 };
    const score = scoreCardShape(box, imageWidth, imageHeight);
    expect(score).toBeGreaterThan(0.85);
  });

  it("dá pontuação baixa para um retângulo quase quadrado (não parece cartão)", () => {
    const box = { minX: 400, minY: 400, maxX: 600, maxY: 600, count: 0 };
    const score = scoreCardShape(box, imageWidth, imageHeight);
    expect(score).toBeLessThan(0.5);
  });

  it("penaliza um retângulo pequeno e deslocado do centro (ex.: trecho de logotipo)", () => {
    const box = { minX: 850, minY: 50, maxX: 950, maxY: 100, count: 0 };
    const score = scoreCardShape(box, imageWidth, imageHeight);
    expect(score).toBeLessThan(0.6);
  });
});

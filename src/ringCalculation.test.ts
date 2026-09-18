import { describe, expect, it } from "vitest";
import { clamp, computeRingResult, estimateInnerDiameter, RING_DIAMETER_TABLE } from "./ringCalculation";

describe("clamp", () => {
  it("mantém o valor quando está dentro do intervalo", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("corta no mínimo", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("corta no máximo", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("estimateInnerDiameter", () => {
  it("aplica a fórmula linear calibrada", () => {
    expect(estimateInnerDiameter(0)).toBeCloseTo(1.73, 5);
    expect(estimateInnerDiameter(10)).toBeCloseTo(10 * 0.873 + 1.73, 5);
  });
});

describe("computeRingResult", () => {
  it("escolhe o aro cuja tabela mais se aproxima do diâmetro estimado, com margem de conforto", () => {
    const result = computeRingResult(15);
    const expectedDiameter = estimateInnerDiameter(15);
    const closest = RING_DIAMETER_TABLE.reduce((a, b) =>
      Math.abs(a.diameterMm - expectedDiameter) <= Math.abs(b.diameterMm - expectedDiameter) ? a : b
    );
    expect(result.ringSize).toBe(clamp(closest.size + 1, 1, 40));
    expect(result.appliedRuleOffset).toBeNull();
  });

  it("usa a referência real confirmada de 21,45-21,75mm para o aro 24 (com conforto)", () => {
    const result = computeRingResult(21.6);
    expect(result.ringSize).toBe(25);
  });

  it("usa a referência real confirmada de 25,80-26,20mm para o aro 32 (com conforto)", () => {
    const result = computeRingResult(26.0);
    expect(result.ringSize).toBe(33);
  });

  it("nunca ultrapassa os limites da tabela de aros (1 a 40)", () => {
    expect(computeRingResult(0).ringSize).toBeGreaterThanOrEqual(1);
    expect(computeRingResult(1000).ringSize).toBeLessThanOrEqual(40);
  });

  it("aplica o offset de uma regra de calibração quando a largura cai na faixa da regra", () => {
    const baseline = computeRingResult(15);
    const rules = [{
      key: "rule-1",
      minWidthMm: 14.5,
      maxWidthMm: 15.5,
      predictedRing: baseline.ringSize,
      offset: 2,
    }];
    const adjusted = computeRingResult(15, rules);
    expect(adjusted.ringSize).toBe(clamp(baseline.ringSize + 2, 1, 40));
    expect(adjusted.appliedRuleOffset).toBe(2);
  });

  it("corrige apenas o modo dedo na faixa confirmada de 18,0 mm: aro 16 -> 17", () => {
    const finger = computeRingResult(18.0, [], false);
    const gauge = computeRingResult(18.0, [], true);
    expect(finger.ringSize).toBe(17);
    expect(finger.fingerFitOffset).toBe(1);
    expect(gauge.fingerFitOffset).toBe(0);
  });

  it("não aplica a correção de dedo fora da faixa estreita", () => {
    const below = computeRingResult(17.5, [], false);
    const above = computeRingResult(18.5, [], false);
    expect(below.fingerFitOffset).toBe(0);
    expect(above.fingerFitOffset).toBe(0);
  });

  it("ignora regras de calibração fora da faixa de largura medida", () => {
    const baseline = computeRingResult(15);
    const rules = [{
      key: "rule-2",
      minWidthMm: 30,
      maxWidthMm: 31,
      predictedRing: baseline.ringSize,
      offset: 3,
    }];
    const adjusted = computeRingResult(15, rules);
    expect(adjusted.ringSize).toBe(baseline.ringSize);
    expect(adjusted.appliedRuleOffset).toBeNull();
  });
});

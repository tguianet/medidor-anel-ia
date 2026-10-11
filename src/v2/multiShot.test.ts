import { describe, expect, it } from "vitest";
import { decideSeries, seriesFailMessage } from "./multiShot";

const shot = (index: number, mm: number | null, accepted = true) => ({ index, mm, accepted });

describe("decideSeries", () => {
  it("usa a mediana de 4 fotos boas (media das 2 do meio)", () => {
    const d = decideSeries([shot(0, 21.75), shot(1, 21.81), shot(2, 21.79), shot(3, 21.77)], 3, 0.15);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(Math.abs(d.medianMm - 21.78)).toBeLessThan(1e-9);
      expect(Math.abs(d.spreadMm - 0.06)).toBeLessThan(1e-9);
      expect(d.validCount).toBe(4);
    }
  });

  it("descarta reprovadas e usa a do meio das 3 restantes", () => {
    const d = decideSeries([shot(0, 21.75), shot(1, 22.6, false), shot(2, 21.81), shot(3, 21.78)], 3, 0.15);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.medianMm).toBe(21.78);
      expect(d.chosenIndex).toBe(3);
    }
  });

  it("caso real: foto ruim isolada (21,97) e descartada e o aro fica 25", () => {
    // Dedo aro 25: 3 fotos boas + a foto das 1:15.
    const d = decideSeries([shot(0, 21.75), shot(1, 21.81), shot(2, 21.81), shot(3, 21.97)], 3, 0.15);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.outlierIndex).toBe(3);
      expect(d.medianMm).toBe(21.81); // < 21,87 -> aro 25
      expect(d.validCount).toBe(3);
    }
  });

  it("duas fotos destoantes: pede nova serie", () => {
    const d = decideSeries([shot(0, 21.70), shot(1, 21.95), shot(2, 21.72), shot(3, 22.0)], 3, 0.15);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("variacao-alta");
  });

  it("com so 3 validas nao descarta nenhuma", () => {
    const d = decideSeries([shot(0, 21.75), shot(1, 21.81), shot(2, 21.97), shot(3, null, false)], 3, 0.15);
    expect(d.ok).toBe(false);
  });

  it("pede nova serie com menos de 3 validas", () => {
    const d = decideSeries([shot(0, 21.75), shot(1, null, false), shot(2, 21.8, false), shot(3, 21.77)], 3, 0.15);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("poucas-validas");
      expect(seriesFailMessage(d, 4, 3, 0.15)).toBe("Só 2 de 4 fotos ficaram boas (mínimo 3).");
    }
  });

  it("aceita exatamente no limite de variacao", () => {
    const d = decideSeries([shot(0, 22.0), shot(1, 22.15), shot(2, 22.1)], 3, 0.15);
    expect(d.ok).toBe(true);
  });
});

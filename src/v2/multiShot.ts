// Decisao da serie de fotos: mediana das fotos validas, com minimo de fotos
// boas e limite de variacao entre elas. Modulo puro (testavel).

export type SeriesShot = {
  index: number;
  mm: number | null;
  accepted: boolean;
};

export type SeriesDecision =
  | { ok: true; medianMm: number; spreadMm: number; validCount: number; chosenIndex: number; outlierIndex: number | null }
  | { ok: false; reason: "poucas-validas" | "variacao-alta"; spreadMm: number | null; validCount: number };

const fmt = (value: number) => value.toFixed(2).replace(".", ",");

export const decideSeries = (
  shots: SeriesShot[],
  minValid: number,
  maxSpreadMm: number,
): SeriesDecision => {
  let valid = shots.filter(
    (shot): shot is SeriesShot & { mm: number } =>
      shot.accepted && shot.mm !== null && Number.isFinite(shot.mm),
  );
  const spreadOf = (list: { mm: number }[]) =>
    list.length ? Math.max(...list.map((s) => s.mm)) - Math.min(...list.map((s) => s.mm)) : null;
  const medianOf = (list: { mm: number }[]) => {
    const values = list.map((s) => s.mm).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };

  if (valid.length < minValid) {
    return { ok: false, reason: "poucas-validas", spreadMm: spreadOf(valid), validCount: valid.length };
  }

  let outlierIndex: number | null = null;
  let spreadMm = spreadOf(valid) as number;
  // Com fotos de sobra, descarta UMA foto destoante se as restantes concordam.
  if (spreadMm > maxSpreadMm + 1e-9 && valid.length > minValid) {
    const median = medianOf(valid);
    const outlier = valid.reduce((worst, shot) =>
      Math.abs(shot.mm - median) > Math.abs(worst.mm - median) ? shot : worst, valid[0]);
    const rest = valid.filter((shot) => shot !== outlier);
    const restSpread = spreadOf(rest) as number;
    if (restSpread <= maxSpreadMm + 1e-9) {
      valid = rest;
      spreadMm = restSpread;
      outlierIndex = outlier.index;
    }
  }
  if (spreadMm > maxSpreadMm + 1e-9) {
    return { ok: false, reason: "variacao-alta", spreadMm, validCount: valid.length };
  }

  const medianMm = medianOf(valid);
  const chosen = valid.reduce(
    (best, shot) => (Math.abs(shot.mm - medianMm) < Math.abs(best.mm - medianMm) ? shot : best),
    valid[0],
  );
  return { ok: true, medianMm, spreadMm, validCount: valid.length, chosenIndex: chosen.index, outlierIndex };
};

export const seriesFailMessage = (
  decision: Extract<SeriesDecision, { ok: false }>,
  total: number,
  minValid: number,
  maxSpreadMm: number,
) =>
  decision.reason === "poucas-validas"
    ? `Só ${decision.validCount} de ${total} fotos ficaram boas (mínimo ${minValid}).`
    : `As fotos discordaram ${fmt(decision.spreadMm ?? 0)} mm entre si (limite ${fmt(maxSpreadMm)} mm).`;

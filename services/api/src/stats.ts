/**
 * The small numeric helpers the ride-capture analysis and the matcher replay
 * both need.
 *
 * They live here rather than in `rideCapture.ts` so that `matchReplay.ts` can
 * use them without the two modules importing each other. A circular import
 * between hoisted function declarations happens to work in Node's ESM loader,
 * which is exactly why it is worth not relying on.
 */

export interface NumberSummary {
  count: number;
  min?: number;
  median?: number;
  p75?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

/**
 * Percentiles, or `{ count: 0 }` when there is nothing to describe.
 *
 * An empty summary is deliberately not zeroes: a distribution with no samples
 * and a distribution centred on zero are different claims, and reporting the
 * first as the second is how `INSUFFICIENT_EVIDENCE` turns into a number
 * somebody quotes.
 */
export function summarize(values: number[]): NumberSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: round(sorted[0]!),
    median: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    p90: round(percentile(sorted, 0.9)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
  };
}

export function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

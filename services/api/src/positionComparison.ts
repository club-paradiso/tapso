/**
 * Ride-position accuracy metrics (`docs/exec-plans/BOARDING_ANCHOR_POSITION_V2.md` §10).
 *
 * Pure: one series is what TAPSO displayed, the other a reference — observed
 * stop announcements on a real ride, or a validation oracle such as the
 * passenger-facing Jeju BIS view (research only, never a runtime input). The
 * metric that matters most is EARLY: TAPSO showing a stop as reached before
 * the reference did. Late is a nuisance; early can put a rider off a bus.
 */

export interface StopTransition {
  /** Provider stop sequence reached. */
  sequence: number;
  atMs: number;
}

export interface TransitionComparison {
  /** Reference transitions TAPSO also displayed. */
  matched: number;
  /** Reference transitions TAPSO never displayed (skipped or still behind). */
  missed: number;
  /** TAPSO displayed before the reference by more than `toleranceMs`. The safety metric. */
  early: number;
  late: number;
  onTime: number;
  /** Displayed minus reference, ms; negative is early. */
  latencyMs: { median: number | null; p90: number | null; min: number | null; max: number | null };
  /** TAPSO displayed a sequence the reference never reached. */
  phantom: number;
}

export interface SnapshotComparison {
  samples: number;
  comparable: number;
  exact: number;
  /** Displayed ahead of the reference: the dangerous direction. */
  ahead: number;
  behind: number;
  /** Stop-count difference (displayed − reference) → count. */
  errorHistogram: Record<string, number>;
  meanAbsoluteError: number | null;
}

export interface PositionSample {
  displayedSequence: number | null;
  referenceSequence: number | null;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

/**
 * First display time of each sequence vs first reference time. `toleranceMs`
 * absorbs clock skew between the two series; it is not a licence to be early.
 */
export function compareTransitions(
  displayed: readonly StopTransition[],
  reference: readonly StopTransition[],
  toleranceMs = 5_000,
): TransitionComparison {
  const firstAt = (series: readonly StopTransition[]) => {
    const map = new Map<number, number>();
    for (const transition of series) {
      if (!Number.isFinite(transition.atMs)) continue;
      const known = map.get(transition.sequence);
      if (known === undefined || transition.atMs < known) map.set(transition.sequence, transition.atMs);
    }
    return map;
  };
  const shown = firstAt(displayed);
  const truth = firstAt(reference);
  const latencies: number[] = [];
  let early = 0;
  let late = 0;
  let onTime = 0;
  let missed = 0;
  for (const [sequence, referenceAt] of truth) {
    const displayedAt = shown.get(sequence);
    if (displayedAt === undefined) {
      missed += 1;
      continue;
    }
    const latency = displayedAt - referenceAt;
    latencies.push(latency);
    if (latency < -toleranceMs) early += 1;
    else if (latency > toleranceMs) late += 1;
    else onTime += 1;
  }
  const phantom = [...shown.keys()].filter((sequence) => !truth.has(sequence) && sequence > Math.max(...truth.keys(), Number.NEGATIVE_INFINITY)).length;
  const sorted = latencies.sort((left, right) => left - right);
  return {
    matched: latencies.length,
    missed,
    early,
    late,
    onTime,
    latencyMs: { median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), min: sorted[0] ?? null, max: sorted.at(-1) ?? null },
    phantom,
  };
}

/** Paired instants: what TAPSO showed and what the reference said at the same moment. */
export function compareSnapshots(samples: readonly PositionSample[]): SnapshotComparison {
  const histogram: Record<string, number> = {};
  let comparable = 0;
  let exact = 0;
  let ahead = 0;
  let behind = 0;
  let absolute = 0;
  for (const sample of samples) {
    if (sample.displayedSequence === null || sample.referenceSequence === null) continue;
    comparable += 1;
    const difference = sample.displayedSequence - sample.referenceSequence;
    histogram[String(difference)] = (histogram[String(difference)] ?? 0) + 1;
    absolute += Math.abs(difference);
    if (difference === 0) exact += 1;
    else if (difference > 0) ahead += 1;
    else behind += 1;
  }
  return {
    samples: samples.length,
    comparable,
    exact,
    ahead,
    behind,
    errorHistogram: histogram,
    meanAbsoluteError: comparable ? Math.round((absolute / comparable) * 1_000) / 1_000 : null,
  };
}

/**
 * A false early arrival: TAPSO showed the destination (0 stops left) before
 * the reference reached it, beyond tolerance, or showed it and the reference
 * never reached it at all. Any non-zero count blocks release.
 */
export function falseEarlyArrival(
  displayedArrivalAtMs: number | null,
  referenceArrivalAtMs: number | null,
  toleranceMs = 5_000,
): boolean {
  if (displayedArrivalAtMs === null) return false;
  if (referenceArrivalAtMs === null) return true;
  return displayedArrivalAtMs < referenceArrivalAtMs - toleranceMs;
}

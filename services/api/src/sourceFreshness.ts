import type { VehicleObservation } from "./domain.ts";

export type SourceFreshnessState = "fresh" | "aging" | "stale" | "unknown";

export interface SourceFreshnessEvidence {
  state: SourceFreshnessState;
  sampleCount: number;
  spanSeconds: number;
  latestReceiptAgeSeconds?: number;
  maxReceiptGapSeconds?: number;
  contentChangeCount: number;
  sequenceDecreaseCount: number;
  reason: string;
}

export interface TagoCadencePolicy {
  historyWindowMs: number;
  minimumSamples: number;
  minimumSpanMs: number;
  maximumReceiptAgeMs: number;
  maximumReceiptGapMs: number;
}

export const TAGO_CADENCE_POLICY_V1: TagoCadencePolicy = {
  // Field evidence observed provider content changes as late as ~83 s.
  // Ninety seconds is therefore an evidence window, not a provider timestamp claim.
  historyWindowMs: 90_000,
  minimumSamples: 3,
  minimumSpanMs: 10_000,
  maximumReceiptAgeMs: 30_000,
  maximumReceiptGapMs: 30_000,
};

export function classifyTagoCadenceFreshness(
  observations: VehicleObservation[],
  now: Date,
  policy: TagoCadencePolicy = TAGO_CADENCE_POLICY_V1,
): SourceFreshnessEvidence {
  const nowMs = now.getTime();
  const rows = observations
    .filter((observation) => observation.timestampSource === "unavailable")
    .map((observation) => ({ observation, at: receiptMs(observation) }))
    .filter((row): row is { observation: VehicleObservation; at: number } => row.at !== undefined)
    .filter((row) => row.at <= nowMs + 10_000 && nowMs - row.at <= policy.historyWindowMs)
    .sort((left, right) => left.at - right.at);

  if (rows.length === 0) {
    return evidence("unknown", 0, 0, undefined, undefined, 0, 0, "No bounded TAGO receipt history is available.");
  }

  const first = rows[0]!;
  const last = rows.at(-1)!;
  const spanMs = Math.max(0, last.at - first.at);
  const latestAgeMs = nowMs - last.at;
  const gaps = rows.slice(1).map((row, index) => row.at - rows[index]!.at);
  const maxGapMs = gaps.length ? Math.max(...gaps) : undefined;

  let contentChangeCount = 0;
  let sequenceDecreaseCount = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!.observation;
    const current = rows[index]!.observation;
    if (fingerprint(previous) !== fingerprint(current)) contentChangeCount += 1;
    if (
      previous.stopSequence !== undefined
      && current.stopSequence !== undefined
      && current.stopSequence < previous.stopSequence
    ) {
      sequenceDecreaseCount += 1;
    }
  }

  const base = {
    sampleCount: rows.length,
    spanSeconds: roundSeconds(spanMs),
    latestReceiptAgeSeconds: roundSeconds(latestAgeMs),
    maxReceiptGapSeconds: maxGapMs === undefined ? undefined : roundSeconds(maxGapMs),
    contentChangeCount,
    sequenceDecreaseCount,
  };

  if (latestAgeMs < -10_000 || latestAgeMs > policy.maximumReceiptAgeMs) {
    return { state: "stale", ...base, reason: "The latest server receipt is outside the bounded cadence window." };
  }
  if (maxGapMs !== undefined && maxGapMs > policy.maximumReceiptGapMs) {
    return { state: "stale", ...base, reason: "Server receipt continuity has a gap larger than the cadence policy allows." };
  }
  if (sequenceDecreaseCount > 0) {
    return { state: "stale", ...base, reason: "The candidate moved backward in provider stop sequence." };
  }
  if (rows.length < policy.minimumSamples || spanMs < policy.minimumSpanMs) {
    return { state: "unknown", ...base, reason: "More server-observed TAGO samples are required before freshness can be inferred." };
  }
  if (contentChangeCount === 0) {
    return { state: "aging", ...base, reason: "The vehicle is continuously present but its provider content has not changed inside the evidence window." };
  }
  return { state: "fresh", ...base, reason: "Repeated server receipts contain forward, changing TAGO content inside the bounded evidence window." };
}

export function appendCadenceObservation(
  history: VehicleObservation[],
  observation: VehicleObservation,
  now: Date,
  policy: TagoCadencePolicy = TAGO_CADENCE_POLICY_V1,
): VehicleObservation[] {
  const cutoff = now.getTime() - policy.historyWindowMs;
  return [...history, { ...observation }]
    .filter((row) => {
      const at = receiptMs(row);
      return at !== undefined && at >= cutoff;
    })
    .slice(-24);
}

export function evidenceTimeMs(observation: VehicleObservation): number | undefined {
  if (observation.timestampSource === "unavailable") return receiptMs(observation);
  const value = Date.parse(observation.observedAt);
  return Number.isFinite(value) ? value : undefined;
}

function receiptMs(observation: VehicleObservation): number | undefined {
  if (!observation.receivedAt) return undefined;
  const value = Date.parse(observation.receivedAt);
  return Number.isFinite(value) ? value : undefined;
}

function fingerprint(observation: VehicleObservation): string {
  return [
    observation.stopSequence ?? "",
    observation.stopId ?? "",
    finite(observation.latitude),
    finite(observation.longitude),
  ].join("|");
}

function finite(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : "";
}

function roundSeconds(milliseconds: number): number {
  return Math.round((milliseconds / 1_000) * 100) / 100;
}

function evidence(
  state: SourceFreshnessState,
  sampleCount: number,
  spanSeconds: number,
  latestReceiptAgeSeconds: number | undefined,
  maxReceiptGapSeconds: number | undefined,
  contentChangeCount: number,
  sequenceDecreaseCount: number,
  reason: string,
): SourceFreshnessEvidence {
  return {
    state,
    sampleCount,
    spanSeconds,
    ...(latestReceiptAgeSeconds === undefined ? {} : { latestReceiptAgeSeconds }),
    ...(maxReceiptGapSeconds === undefined ? {} : { maxReceiptGapSeconds }),
    contentChangeCount,
    sequenceDecreaseCount,
    reason,
  };
}

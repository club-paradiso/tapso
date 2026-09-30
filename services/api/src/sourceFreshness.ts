/**
 * A conservative liveness surrogate for a provider that publishes no
 * observation time.
 *
 * TAGO's realtime position feed carries no timestamp of any kind. Nothing in
 * this module recovers one, and nothing here may be read as knowing when TAGO
 * observed a vehicle. What it measures is narrower and entirely about TAPSO's
 * own behaviour: did this server keep receiving snapshots, close together, in
 * which the vehicle's reported content actually changed and never moved
 * backwards?
 *
 * That is weaker than a provider timestamp, and it is weaker on purpose. A
 * `fresh` verdict means "the provider is answering and this vehicle's row is
 * moving", not "this position is N seconds old".
 *
 * Every threshold below is an operational gate on TAPSO receipts. None is
 * derived from real boardings; see `docs/DATA_VALIDATION.md`.
 */

import type { VehicleObservation } from "./domain.ts";

/**
 * - `fresh` — receipts are continuous *and* the vehicle's provider content
 *   changed inside the window. The only state that may unlock matching.
 * - `aging` — receipts are continuous but the content has not changed. A
 *   stationary bus at a light produces this, so it is deliberately not
 *   `stale`: absence of movement is not absence of data.
 * - `stale` — the receipt chain itself is broken, late, or the vehicle moved
 *   backwards in stop sequence. Fails closed.
 * - `unknown` — not enough bounded history to say anything. Fails closed.
 */
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

/**
 * Version 1, and provisional in every number.
 *
 * The only quantitative input is the bounded 2026-09-11 TAGO probe
 * (`docs/validation/TAGO_2026-09-11.md`): 24 samples per direction at a 5 s
 * target interval, snapshot-content change median 27.52 s, max observed
 * 83.10 s. That probe measured how often TAGO's *content* changes. It did not
 * measure provider observation lag, which is unmeasurable without a provider
 * timestamp, and it involved no boardings.
 *
 * So these are not calibrated thresholds. They are conservative operational
 * gates chosen so that the failure mode is refusing a real bus, never
 * accepting a wrong one. Revisit them only with ride evidence that separates
 * the two; until then, prefer the tighter value.
 */
export const TAGO_CADENCE_POLICY_V1: TagoCadencePolicy = {
  /**
   * PROVISIONAL. Bounds how far back evidence may be drawn from. Set above the
   * 83.10 s worst observed content-change interval so a slow-but-live vehicle
   * is not discarded for being slow. Not a claim that data is valid for 90 s.
   */
  historyWindowMs: 90_000,
  /**
   * PROVISIONAL. Three receipts give two intervals: the minimum needed to see
   * a gap at all rather than a single point. No evidence supports fewer.
   */
  minimumSamples: 3,
  /**
   * PROVISIONAL. Three receipts arriving inside one second prove nothing about
   * cadence. Ten seconds is two polling intervals at the configured 5 s rate.
   */
  minimumSpanMs: 10_000,
  /**
   * PROVISIONAL. How stale the newest receipt may be. At a 5 s polling target,
   * 30 s means six consecutive polls were lost before evidence is refused.
   */
  maximumReceiptAgeMs: 30_000,
  /**
   * PROVISIONAL. The largest hole tolerated inside the window. The clean
   * 2026-09-22 Railway background run held its maximum gap to 7.94 s, so 30 s
   * is roughly four times the observed worst case on a healthy collector —
   * loose enough not to fire on jitter, tight enough that a suspended or
   * failing collector cannot pass.
   */
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
  // Deliberately `aging`, not `stale`. A bus held at a light reports the same
  // row for minutes; refusing to distinguish that from a dead feed would make
  // every red light look like a provider outage. Unchanged content is simply
  // never enough to unlock matching.
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
  // Receipts only move forward. A row no newer than the latest one already
  // held (a late, older receipt, or a second row for the same vehicle in one
  // snapshot) is not new evidence: counting it could manufacture a sample or
  // a content change the provider never produced, so it is not recorded.
  const at = receiptMs(observation);
  const latest = Math.max(Number.NEGATIVE_INFINITY, ...history.map((row) => receiptMs(row) ?? Number.NEGATIVE_INFINITY));
  const appended = at !== undefined && at > latest ? [...history, { ...observation }] : [...history];
  return appended
    .filter((row) => {
      const rowAt = receiptMs(row);
      return rowAt !== undefined && rowAt >= cutoff;
    })
    .slice(-24);
}

/**
 * Memory for the matcher. The last sighting of each vehicle that is in the cadence history, inside the
 * evidence window, but not in the current snapshot.
 */
export function recentlySeenVehicles(
  cadenceHistory: ReadonlyMap<string, VehicleObservation[]>,
  current: VehicleObservation[],
  at: Date,
  windowMs: number = TAGO_CADENCE_POLICY_V1.historyWindowMs,
): VehicleObservation[] {
  const present = new Set(current.map((vehicle) => vehicle.vehicleId));
  const remembered: VehicleObservation[] = [];
  for (const [vehicleId, history] of [...cadenceHistory].sort(([left], [right]) => left.localeCompare(right))) {
    if (present.has(vehicleId)) continue;
    const last = history.at(-1);
    const seenAt = last?.receivedAt ? Date.parse(last.receivedAt) : Number.NaN;
    if (!last || !Number.isFinite(seenAt)) continue;
    if (at.getTime() - seenAt > windowMs || seenAt > at.getTime()) continue;
    remembered.push({ ...last });
  }
  return remembered;
}

/**
 * The instant TAPSO orders evidence by — receipt time when the provider gives
 * no observation time, the provider's own time when it does. Ordering by it is
 * legitimate; presenting it as an observation time is not.
 */
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

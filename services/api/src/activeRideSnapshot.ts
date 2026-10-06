/**
 * The vehicle read path for active journey sessions
 * (`docs/exec-plans/BOARDING_ANCHOR_POSITION_V2.md` §4).
 *
 * Sessions deliberately do not read the public 20 s vehicle cache: the cadence
 * surrogate (`sourceFreshness.ts`) is only evidence when consecutive reads are
 * genuinely consecutive. Before this module every session refresh was its own
 * TAGO request, so N riders on one route cost N requests per poll and one
 * rider pressing refresh repeatedly cost one request per press.
 *
 * This provider shares one route snapshot among the sessions that ask for it
 * within a short window, and never longer:
 *
 * - **Share window.** A successful snapshot answers further reads of the same
 *   route for `shareWindowMs`, measured from when TAPSO received it. The window
 *   is below the fastest foreground poll (`LivePollingPolicy`, 10 s), so a
 *   single rider polling normally always gets a new upstream read; only
 *   simultaneous riders and rapid repeat reads share.
 * - **Receipt time is never rewritten.** A shared row keeps the `receivedAt`
 *   of the read that produced it. `appendCadenceObservation` records a receipt
 *   at most once, so a shared snapshot can neither add a cadence sample nor
 *   make old content look new, and its age stays visible to every rule that
 *   measures one.
 * - **Single flight.** Concurrent misses for one route share one upstream call.
 * - **Failures are not stored.** A failed read rejects every caller that was
 *   waiting on it and leaves the last good snapshot untouched.
 * - **Budget.** Upstream reads per instance are bounded per minute. Over
 *   budget, a snapshot no older than `budgetFallbackMaxAgeMs` may answer (its
 *   true receipt time attached); otherwise the read fails as unavailable and
 *   the session degrades the way any provider failure does. Nothing old is
 *   ever presented as a new read.
 *
 * What this does not do: make TAGO change faster. The bounded 2026-09-11 probe
 * measured a median of 27.52 s between content changes (`TAGO_CADENCE_POLICY_V1`);
 * polling more often only shortens how late TAPSO sees a change, it does not
 * create changes. In a serverless deployment this state is per warm instance,
 * so sharing across instances is not claimed.
 */

import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import { ProviderUnavailableError, type TransitProvider } from "./provider.ts";

export interface ActiveRideSnapshotPolicy {
  /** How long one received snapshot may answer further reads of its route. */
  shareWindowMs: number;
  /** Upstream vehicle reads this instance may start per rolling minute. */
  upstreamReadsPerMinute: number;
  /** Over budget, the oldest snapshot that may still answer (true age attached). */
  budgetFallbackMaxAgeMs: number;
}

/**
 * PROVISIONAL engineering values, not provider-calibrated:
 * - 5 s share window: half the fastest foreground poll (10 s), so one rider
 *   polling normally never receives their own previous receipt.
 * - 600 reads/min: a fan-out guard against pathological load, not a TAGO
 *   quota claim. TAGO's daily quota for this key is not documented in the
 *   repository (`MATCHER_SAFETY_EVIDENCE_V4.md`, `MISSING`).
 * - 15 s fallback age: the far-band poll interval; inside the cadence policy's
 *   30 s receipt-age bound, so an over-budget answer can still be judged
 *   honestly by `classifyTagoCadenceFreshness`.
 */
export const ACTIVE_RIDE_SNAPSHOT_POLICY_V1: ActiveRideSnapshotPolicy = {
  shareWindowMs: 5_000,
  upstreamReadsPerMinute: 600,
  budgetFallbackMaxAgeMs: 15_000,
};

export type ActiveRideReadOutcome = "upstream" | "coalesced" | "shared" | "budget_shared";

export interface ActiveRideReadResult {
  value: VehicleObservation[];
  outcome: ActiveRideReadOutcome;
  /** Milliseconds since TAPSO received the snapshot that answered (server receipt, not provider observation). */
  receiptAgeMs: number;
}

export interface ActiveRideSnapshotOptions {
  policy?: Partial<ActiveRideSnapshotPolicy>;
  now?: () => number;
  /** Bound on remembered routes; old entries are pruned, never unbounded. */
  maxRoutes?: number;
}

type Snapshot = { receivedAtMs: number; value: VehicleObservation[] };

export class ActiveRideSnapshotProvider implements TransitProvider {
  readonly policy: ActiveRideSnapshotPolicy;

  private readonly upstream: TransitProvider;
  private readonly now: () => number;
  private readonly maxRoutes: number;
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly inflight = new Map<string, Promise<Snapshot>>();
  private readonly upstreamStarts: number[] = [];
  private readonly counters: Record<ActiveRideReadOutcome | "budget_refused", number> = {
    upstream: 0, coalesced: 0, shared: 0, budget_shared: 0, budget_refused: 0,
  };

  constructor(upstream: TransitProvider, options: ActiveRideSnapshotOptions = {}) {
    this.upstream = upstream;
    this.now = options.now ?? Date.now;
    this.maxRoutes = options.maxRoutes ?? 512;
    this.policy = validatePolicy({ ...ACTIVE_RIDE_SNAPSHOT_POLICY_V1, ...options.policy });
  }

  /** Route topology is not live data and is passed straight through. */
  stops(request: RouteRequest): Promise<StopOnRoute[]> {
    return this.upstream.stops(request);
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    return (await this.vehiclesResult(request)).value;
  }

  async vehiclesResult(request: RouteRequest): Promise<ActiveRideReadResult> {
    const key = `${request.cityCode}:${request.routeId}`;
    const now = this.now();
    const held = this.snapshots.get(key);
    if (held && now - held.receivedAtMs >= 0 && now - held.receivedAtMs < this.policy.shareWindowMs) {
      return this.answer(held, "shared", now);
    }

    const pending = this.inflight.get(key);
    if (pending) return this.answer(await pending, "coalesced", this.now());

    if (!this.consumeBudget(now)) {
      if (held && now - held.receivedAtMs >= 0 && now - held.receivedAtMs <= this.policy.budgetFallbackMaxAgeMs) {
        return this.answer(held, "budget_shared", now);
      }
      this.counters.budget_refused += 1;
      throw new ProviderUnavailableError("active ride upstream read budget exhausted");
    }

    const load = this.upstream.vehicles(request).then((value) => {
      const snapshot = { receivedAtMs: this.now(), value: value.map((row) => ({ ...row })) };
      this.snapshots.set(key, snapshot);
      this.prune(snapshot.receivedAtMs);
      return snapshot;
    }).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, load);
    return this.answer(await load, "upstream", this.now());
  }

  /** Counts since this instance started; no route, session or vehicle identifiers. */
  stats(): Readonly<Record<ActiveRideReadOutcome | "budget_refused", number>> {
    return { ...this.counters };
  }

  private answer(snapshot: Snapshot, outcome: ActiveRideReadOutcome, now: number): ActiveRideReadResult {
    this.counters[outcome] += 1;
    return { value: snapshot.value.map((row) => ({ ...row })), outcome, receiptAgeMs: Math.max(0, now - snapshot.receivedAtMs) };
  }

  private consumeBudget(now: number): boolean {
    while (this.upstreamStarts.length > 0 && now - this.upstreamStarts[0]! >= 60_000) this.upstreamStarts.shift();
    if (this.upstreamStarts.length >= this.policy.upstreamReadsPerMinute) return false;
    this.upstreamStarts.push(now);
    return true;
  }

  private prune(now: number): void {
    if (this.snapshots.size <= this.maxRoutes) return;
    for (const [key, snapshot] of this.snapshots) {
      if (now - snapshot.receivedAtMs > this.policy.budgetFallbackMaxAgeMs) this.snapshots.delete(key);
    }
  }
}

function validatePolicy(policy: ActiveRideSnapshotPolicy): ActiveRideSnapshotPolicy {
  const finite = (value: number) => Number.isFinite(value) && value >= 0;
  if (!finite(policy.shareWindowMs) || policy.shareWindowMs >= 10_000) {
    // At or above the fastest foreground poll, one rider would receive their own
    // previous receipt on a normal poll: that is the 20 s cache problem again.
    throw new RangeError("shareWindowMs must be a non-negative number below the 10 s foreground poll");
  }
  if (!Number.isInteger(policy.upstreamReadsPerMinute) || policy.upstreamReadsPerMinute <= 0) {
    throw new RangeError("upstreamReadsPerMinute must be a positive integer");
  }
  if (!finite(policy.budgetFallbackMaxAgeMs) || policy.budgetFallbackMaxAgeMs > 30_000) {
    // Past the cadence policy's 30 s receipt-age bound an answer would only be refused downstream anyway.
    throw new RangeError("budgetFallbackMaxAgeMs must be between 0 and 30 s");
  }
  return policy;
}

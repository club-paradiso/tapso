/**
 * What the upstream provider has been doing lately, as this process saw it.
 *
 * Production has shown TAGO answering without a `body` or `response` object,
 * taking 12–14 s, and failing `/v1/vehicles` and `/v1/stops` with 502
 * (`docs/KNOWN_ISSUES.md`). Each logical request (all of its pages and
 * retries) is recorded once: the operation, how it ended, how long it took and
 * how many attempts it used. Nothing that identifies a vehicle, and never the
 * request URL, which carries the service key.
 *
 * On a serverless platform this is per warm instance, not global; `/health`
 * says so. It is evidence for an operator reading the runtime, never an input
 * to any rider-facing decision.
 */

export type ProviderOutcome = "ok" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RESPONSE_INVALID" | "BLOCKED_BY_CREDENTIALS";

export interface ProviderRequestRecord {
  provider: string;
  operation: string;
  outcome: ProviderOutcome;
  latencyMs: number;
  attempts: number;
  /** A message this service wrote (`TAGO payload has no body object`), never upstream text. */
  detail?: string;
  /** The last HTTP status the provider answered with, if any. */
  httpStatus?: number;
  at: string;
}

export interface ProviderHealthSnapshot {
  scope: "this_instance";
  window: number;
  outcomes: Partial<Record<ProviderOutcome, number>>;
  /** Requests that needed more than one attempt. */
  retried: number;
  latencyMs?: { p50: number; p95: number; max: number };
  lastFailure?: Pick<ProviderRequestRecord, "operation" | "outcome" | "detail" | "httpStatus" | "at">;
}

export class ProviderHealth {
  private readonly capacity: number;
  private readonly records: ProviderRequestRecord[] = [];
  private lastFailure: ProviderRequestRecord | undefined;

  constructor(capacity = 100) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  record(entry: ProviderRequestRecord): void {
    this.records.push(entry);
    if (this.records.length > this.capacity) this.records.splice(0, this.records.length - this.capacity);
    if (entry.outcome !== "ok") this.lastFailure = entry;
  }

  snapshot(): ProviderHealthSnapshot {
    const outcomes: Partial<Record<ProviderOutcome, number>> = {};
    for (const record of this.records) outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
    const latencies = this.records.map((record) => record.latencyMs).sort((left, right) => left - right);
    const at = (fraction: number) => latencies[Math.min(latencies.length - 1, Math.ceil(fraction * latencies.length) - 1)]!;
    return {
      scope: "this_instance",
      window: this.records.length,
      outcomes,
      retried: this.records.filter((record) => record.attempts > 1).length,
      ...(latencies.length > 0 ? { latencyMs: { p50: at(0.5), p95: at(0.95), max: latencies.at(-1)! } } : {}),
      ...(this.lastFailure
        ? {
          lastFailure: {
            operation: this.lastFailure.operation,
            outcome: this.lastFailure.outcome,
            ...(this.lastFailure.detail === undefined ? {} : { detail: this.lastFailure.detail }),
            ...(this.lastFailure.httpStatus === undefined ? {} : { httpStatus: this.lastFailure.httpStatus }),
            at: this.lastFailure.at,
          },
        }
        : {}),
    };
  }
}

/** One JSON line per logical provider request; `warn` when it failed. */
export function logProviderRequest(entry: ProviderRequestRecord): void {
  const line = JSON.stringify({ timestamp: entry.at, level: entry.outcome === "ok" ? "info" : "warn", event: "provider_request", ...entry });
  if (entry.outcome === "ok") console.info(line);
  else console.warn(line);
}

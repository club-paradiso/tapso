/**
 * The Live Activity scheduler's clock (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`,
 * milestone 5), run by the always-on Railway collector.
 *
 * Every `LIVE_ACTIVITY_TICK_INTERVAL_MS` it calls the transit API's
 * `POST /operator/live-activity/tick`, which refreshes rides that hold a push
 * token and pushes their Live Activity while the app may be suspended. The
 * collector only keeps time: sessions, their namespace and APNs stay with the
 * API, so the collector never reads the session store.
 *
 * Off unless both variables are set:
 *   LIVE_ACTIVITY_TICK_URL    https://…/operator/live-activity/tick
 *   LIVE_ACTIVITY_TICK_TOKEN  the API's RIDE_CAPTURE_OPERATOR_TOKEN
 * A deployment without APNs answers 503; the ticker then waits five minutes
 * before asking again. The token is never logged.
 */

export const LIVE_ACTIVITY_TICK_PATH = "/operator/live-activity/tick";
/** Inside the 15–30 s the plan asks for; a session read within 15 s is left alone by the API. */
export const LIVE_ACTIVITY_TICK_INTERVAL_MS = 20_000;
export const LIVE_ACTIVITY_TICK_TIMEOUT_MS = 15_000;
/** How long a deployment that cannot push (or refuses the token) is left alone. */
export const LIVE_ACTIVITY_TICK_PAUSE_MS = 5 * 60_000;
const MINIMUM_TOKEN_LENGTH = 24;

export type TickerConfig =
  | { enabled: true; url: string; token: string }
  | { enabled: false; problem?: string };

export function readTickerConfig(env: Record<string, string | undefined>): TickerConfig {
  const rawUrl = env.LIVE_ACTIVITY_TICK_URL?.trim() ?? "";
  const token = env.LIVE_ACTIVITY_TICK_TOKEN?.trim() ?? "";
  if (!rawUrl && !token) return { enabled: false };
  if (!rawUrl || !token) return { enabled: false, problem: "LIVE_ACTIVITY_TICK_URL and LIVE_ACTIVITY_TICK_TOKEN must be set together" };
  if (token.length < MINIMUM_TOKEN_LENGTH) return { enabled: false, problem: `LIVE_ACTIVITY_TICK_TOKEN must be at least ${MINIMUM_TOKEN_LENGTH} characters` };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { enabled: false, problem: "LIVE_ACTIVITY_TICK_URL is not a URL" };
  }
  // The token is a bearer secret: only ever sent over TLS, and only to the tick route.
  if (url.protocol !== "https:" || url.pathname !== LIVE_ACTIVITY_TICK_PATH || url.search || url.username || url.password) {
    return { enabled: false, problem: `LIVE_ACTIVITY_TICK_URL must be https://<host>${LIVE_ACTIVITY_TICK_PATH}` };
  }
  return { enabled: true, url: url.href, token };
}

export type TickOutcome =
  | { kind: "ok"; counts: Record<string, number> }
  | { kind: "push_unavailable" }
  | { kind: "unauthorized" }
  | { kind: "failed"; reason: string }
  | { kind: "skipped"; reason: "running" | "paused" };

export interface TickerStatus {
  state: "disabled" | "enabled";
  problem?: string;
  intervalMs?: number;
  last?: { at: string; outcome: TickOutcome["kind"]; counts?: Record<string, number> };
  pausedUntil?: string;
}

export class LiveActivityTicker {
  private readonly config: TickerConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (entry: Record<string, unknown>) => void;
  private running = false;
  private pausedUntilMs = 0;
  private last: TickerStatus["last"];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    config: TickerConfig,
    options: { fetchImpl?: typeof fetch; now?: () => number; log?: (entry: Record<string, unknown>) => void } = {},
  ) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((entry) => console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry })));
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => void this.tickOnce(), LIVE_ACTIVITY_TICK_INTERVAL_MS);
    this.timer.unref?.();
    void this.tickOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): TickerStatus {
    if (!this.config.enabled) return { state: "disabled", ...(this.config.problem ? { problem: this.config.problem } : {}) };
    return {
      state: "enabled",
      intervalMs: LIVE_ACTIVITY_TICK_INTERVAL_MS,
      ...(this.last ? { last: this.last } : {}),
      ...(this.pausedUntilMs > this.now() ? { pausedUntil: new Date(this.pausedUntilMs).toISOString() } : {}),
    };
  }

  /** One tick. Never overlaps another, never throws. */
  async tickOnce(): Promise<TickOutcome> {
    if (!this.config.enabled) return { kind: "failed", reason: "disabled" };
    if (this.running) return { kind: "skipped", reason: "running" };
    if (this.pausedUntilMs > this.now()) return { kind: "skipped", reason: "paused" };
    this.running = true;
    try {
      const outcome = await this.call(this.config);
      this.record(outcome);
      return outcome;
    } finally {
      this.running = false;
    }
  }

  private async call(config: { url: string; token: string }): Promise<TickOutcome> {
    try {
      const response = await this.fetchImpl(config.url, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(LIVE_ACTIVITY_TICK_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
      if (response.status === 200 && body) {
        const counts = Object.fromEntries(Object.entries(body).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
        return { kind: "ok", counts };
      }
      if (response.status === 401) return { kind: "unauthorized" };
      const error = typeof body?.error === "string" ? body.error : undefined;
      if (response.status === 503 && (error === "LIVE_ACTIVITY_PUSH_UNAVAILABLE" || error === "SESSIONS_UNAVAILABLE" || error === "OPERATOR_DISABLED")) {
        return { kind: "push_unavailable" };
      }
      return { kind: "failed", reason: `HTTP ${response.status}${error ? ` ${error}` : ""}` };
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.name : "unknown" };
    }
  }

  private record(outcome: TickOutcome): void {
    const previous = this.last?.outcome;
    this.last = { at: new Date(this.now()).toISOString(), outcome: outcome.kind, ...(outcome.kind === "ok" ? { counts: outcome.counts } : {}) };
    if (outcome.kind === "push_unavailable" || outcome.kind === "unauthorized") this.pausedUntilMs = this.now() + LIVE_ACTIVITY_TICK_PAUSE_MS;
    // A quiet tick is not logged: one line every 20 s would bury everything else.
    const busy = outcome.kind === "ok" && Object.entries(outcome.counts).some(([key, value]) => key !== "sampled" && key !== "recent" && value > 0);
    if (busy || outcome.kind !== previous) {
      this.log({
        level: outcome.kind === "ok" || outcome.kind === "push_unavailable" ? "info" : "warn",
        event: "live_activity_ticker",
        outcome: outcome.kind,
        ...(outcome.kind === "ok" ? outcome.counts : {}),
        ...(outcome.kind === "failed" ? { reason: outcome.reason } : {}),
      });
    }
  }
}

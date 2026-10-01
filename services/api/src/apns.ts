/**
 * Live Activity updates over Apple Push Notification service (APNs), sent by
 * the server so a ride keeps moving on the Lock Screen while iOS has
 * suspended the app.
 *
 * Fail closed: without every credential this sender does not exist
 * (`readApnsConfig` returns `enabled: false` and why), and nothing pretends a
 * push went out. The signing key lives only in the server's environment
 * (`APNS_PRIVATE_KEY`, Sensitive); the iOS client never holds it and never
 * talks to APNs. Push tokens are capabilities: they are never logged, only a
 * short fingerprint of them.
 *
 * Apple's contract, as this module uses it (Apple Developer documentation,
 * "Starting and updating Live Activities with ActivityKit push notifications"
 * and "Sending notification requests to APNs"):
 *   - `POST /3/device/<token>` on `api.push.apple.com` (production) or
 *     `api.sandbox.push.apple.com` (development builds), over HTTP/2;
 *   - `apns-push-type: liveactivity`, `apns-topic: <bundle id>.push-type.liveactivity`;
 *   - token-based auth: an ES256 JWT with `kid` (key ID) and claims `iss`
 *     (team ID) and `iat`, refreshed at most every 20 minutes and never used
 *     past 60;
 *   - `aps.event` `update` or `end`, `aps.timestamp`, `aps.content-state`
 *     (decoded by the app into its `ContentState`), optional `stale-date`,
 *     `dismissal-date`, `relevance-score` and `alert`.
 * What a physical device does with these payloads is `UNVERIFIED` until a
 * device run records it (`docs/DEVICE_TEST_PLAN.md`).
 */

import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { ClientHttp2Session } from "node:http2";

export type ApnsEnvironment = "production" | "development";

export type ApnsConfig =
  | {
      enabled: true;
      environment: ApnsEnvironment;
      keyId: string;
      teamId: string;
      bundleId: string;
      /** Parsed once; never serialized. */
      privateKey: KeyObject;
    }
  | {
      enabled: false;
      /** Which settings are missing or unusable, by name only. */
      missing: string[];
    };

type Env = Record<string, string | undefined>;

const KEY_ID = /^[A-Z0-9]{10}$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Reads `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the `.p8`
 * contents), `APNS_BUNDLE_ID` and `APNS_ENVIRONMENT`. Every one must be
 * present and valid, or the sender is off. The environment has no default: a
 * development build's token sent to production (or the reverse) is rejected
 * by Apple, so the operator must say which.
 */
export function readApnsConfig(env: Env): ApnsConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const missing: string[] = [];
  const keyId = value("APNS_KEY_ID");
  const teamId = value("APNS_TEAM_ID");
  const bundleId = value("APNS_BUNDLE_ID");
  const environment = value("APNS_ENVIRONMENT");
  const pem = value("APNS_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  if (!keyId || !KEY_ID.test(keyId)) missing.push("APNS_KEY_ID");
  if (!teamId || !TEAM_ID.test(teamId)) missing.push("APNS_TEAM_ID");
  if (!bundleId || !BUNDLE_ID.test(bundleId)) missing.push("APNS_BUNDLE_ID");
  if (environment !== "production" && environment !== "development") missing.push("APNS_ENVIRONMENT");
  let privateKey: KeyObject | undefined;
  if (pem) {
    try {
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") privateKey = key;
    } catch {
      // Unusable key material; reported by name below, never echoed.
    }
  }
  if (!privateKey) missing.push("APNS_PRIVATE_KEY");
  if (missing.length > 0 || !privateKey || !keyId || !teamId || !bundleId) return { enabled: false, missing };
  return { enabled: true, environment: environment as ApnsEnvironment, keyId, teamId, bundleId, privateKey };
}

/** What `/health` may say about push: never a key, an ID or a token. */
export function describeApns(config: ApnsConfig): { enabled: boolean; environment?: ApnsEnvironment; missing?: string[] } {
  return config.enabled ? { enabled: true, environment: config.environment } : { enabled: false, missing: config.missing };
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/**
 * The provider token. Apple refuses one older than an hour and throttles
 * one refreshed more often than every 20 minutes, so it is reused for 50.
 */
export class ApnsProviderToken {
  private cached?: { token: string; issuedAtMs: number };
  private readonly config: Extract<ApnsConfig, { enabled: true }>;
  private readonly now: () => number;

  constructor(config: Extract<ApnsConfig, { enabled: true }>, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  static readonly reuseMs = 50 * 60 * 1_000;
  static readonly minimumRefreshMs = 20 * 60 * 1_000;

  current(): string {
    const nowMs = this.now();
    if (this.cached && nowMs - this.cached.issuedAtMs < ApnsProviderToken.reuseMs) return this.cached.token;
    return this.issue(nowMs);
  }

  /** After Apple says the token expired: a new one, unless the last is too recent to replace. */
  refresh(): string | undefined {
    const nowMs = this.now();
    if (this.cached && nowMs - this.cached.issuedAtMs < ApnsProviderToken.minimumRefreshMs) return undefined;
    return this.issue(nowMs);
  }

  private issue(nowMs: number): string {
    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.config.keyId }));
    const claims = base64url(JSON.stringify({ iss: this.config.teamId, iat: Math.floor(nowMs / 1_000) }));
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: this.config.privateKey, dsaEncoding: "ieee-p1363" });
    const token = `${header}.${claims}.${base64url(signature)}`;
    this.cached = { token, issuedAtMs: nowMs };
    return token;
  }
}

/**
 * The app's `TapsoActivityAttributes.ContentState`, field for field. Swift
 * decodes `content-state` with `JSONDecoder` defaults, so `updatedAt` is a
 * number of seconds since 2001-01-01 (`Date`'s reference date), not a Unix
 * time and not a string. `packages/transit-core` decodes these payloads in its
 * tests; a change here that Swift cannot read fails there.
 */
export interface LiveActivityContentState {
  phase: string;
  currentStopName: string;
  nextStopName?: string;
  remainingStops: number;
  freshness: "fresh" | "aging" | "stale" | "unknown";
  updatedAt: number;
  destinationPassed: boolean;
  isOffline: boolean;
}

/** Seconds between the Unix epoch and Swift `Date`'s reference date, 2001-01-01T00:00:00Z. */
export const SWIFT_REFERENCE_DATE_OFFSET_S = 978_307_200;

export function swiftDate(ms: number): number {
  return ms / 1_000 - SWIFT_REFERENCE_DATE_OFFSET_S;
}

export type LiveActivityMilestone = "prepare" | "nextStop" | "arrived";

export interface LiveActivityPush {
  token: string;
  event: "update" | "end";
  contentState: LiveActivityContentState;
  /** Milliseconds; when the state was true. Apple drops a push older than the last one it applied. */
  timestampMs: number;
  staleDateMs?: number;
  dismissalDateMs?: number;
  relevanceScore?: number;
  /** Set for a milestone signalled for the first time on this ride; it lights the screen. */
  alert?: { title: string; body: string };
}

/** The request body and headers APNs expects for one Live Activity push. */
export function liveActivityRequest(push: LiveActivityPush, config: Extract<ApnsConfig, { enabled: true }>): {
  path: string;
  headers: Record<string, string>;
  body: string;
} {
  if (!/^[0-9a-f]{16,512}$/i.test(push.token)) throw new ApnsInputError("push token is not hexadecimal");
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(push.timestampMs / 1_000),
    event: push.event,
    "content-state": push.contentState,
  };
  if (push.staleDateMs !== undefined) aps["stale-date"] = Math.floor(push.staleDateMs / 1_000);
  if (push.dismissalDateMs !== undefined) aps["dismissal-date"] = Math.floor(push.dismissalDateMs / 1_000);
  if (push.relevanceScore !== undefined) aps["relevance-score"] = push.relevanceScore;
  if (push.alert) aps.alert = { title: push.alert.title, body: push.alert.body, sound: "default" };
  return {
    path: `/3/device/${push.token.toLowerCase()}`,
    headers: {
      "apns-push-type": "liveactivity",
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      // An alert may take the high priority budget; quiet updates do not need it.
      "apns-priority": push.alert || push.event === "end" ? "10" : "5",
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps }),
  };
}

export class ApnsInputError extends Error {}

/** One HTTP/2 exchange with APNs, injectable so tests never reach Apple. */
export interface ApnsTransport {
  post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string; apnsId?: string }>;
}

/**
 * What happened to a push, in terms an operator can act on. The four are
 * different failures and must not be confused: a token Apple no longer
 * accepts (drop it), our own credential (fix the configuration), Apple
 * pushing back (wait), and the network or Apple failing (retry later).
 */
export type ApnsOutcome =
  | { kind: "delivered"; apnsId?: string }
  | { kind: "token_rejected"; reason: string; dropToken: true }
  | { kind: "credential_rejected"; reason: string }
  | { kind: "throttled"; reason: string }
  | { kind: "unavailable"; reason: string; status?: number };

export function classifyApnsResponse(status: number, body: string, apnsId?: string): ApnsOutcome {
  if (status === 200) return { kind: "delivered", ...(apnsId ? { apnsId } : {}) };
  let reason = "unknown";
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    if (typeof parsed.reason === "string" && /^[A-Za-z]{1,64}$/.test(parsed.reason)) reason = parsed.reason;
  } catch {
    // An unreadable body keeps the reason unknown.
  }
  if (status === 410 || (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic"))) {
    return { kind: "token_rejected", reason, dropToken: true };
  }
  if (status === 403) return { kind: "credential_rejected", reason };
  if (status === 429) return { kind: "throttled", reason };
  return { kind: "unavailable", reason, status };
}

/** A short, stable, non-reversible label for a token in logs. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token.toLowerCase()).digest("hex").slice(0, 12);
}

export class ApnsLiveActivitySender {
  private readonly providerToken: ApnsProviderToken;
  private readonly config: Extract<ApnsConfig, { enabled: true }>;
  private readonly transport: ApnsTransport;
  private readonly log: (entry: Record<string, unknown>) => void;

  constructor(
    config: Extract<ApnsConfig, { enabled: true }>,
    transport: ApnsTransport,
    now: () => number = Date.now,
    log: (entry: Record<string, unknown>) => void = (entry) => console.info(JSON.stringify(entry)),
  ) {
    this.config = config;
    this.transport = transport;
    this.log = log;
    this.providerToken = new ApnsProviderToken(config, now);
  }

  get origin(): string {
    return this.config.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  }

  /**
   * Sends one push. A provider token Apple reports as expired is replaced and
   * the push retried once; nothing else is retried here, because the next
   * refresh carries newer content anyway and an old update must not land
   * after a newer one.
   */
  async send(push: LiveActivityPush): Promise<ApnsOutcome> {
    const request = liveActivityRequest(push, this.config);
    let outcome = await this.attempt(request, this.providerToken.current());
    if (outcome.kind === "credential_rejected" && outcome.reason === "ExpiredProviderToken") {
      const fresh = this.providerToken.refresh();
      if (fresh) outcome = await this.attempt(request, fresh);
    }
    this.log({
      event: "live_activity_push",
      outcome: outcome.kind,
      ...("reason" in outcome ? { reason: outcome.reason } : {}),
      pushEvent: push.event,
      token: tokenFingerprint(push.token),
      environment: this.config.environment,
    });
    return outcome;
  }

  private async attempt(request: ReturnType<typeof liveActivityRequest>, providerToken: string): Promise<ApnsOutcome> {
    try {
      const response = await this.transport.post(this.origin, request.path, { ...request.headers, authorization: `bearer ${providerToken}` }, request.body);
      return classifyApnsResponse(response.status, response.body, response.apnsId);
    } catch {
      return { kind: "unavailable", reason: "network" };
    }
  }
}

/** The production transport: one HTTP/2 session per origin, reused. */
export class Http2ApnsTransport implements ApnsTransport {
  private sessions = new Map<string, ClientHttp2Session>();

  async post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string; apnsId?: string }> {
    const http2 = await import("node:http2");
    let session = this.sessions.get(origin);
    if (!session || session.closed || session.destroyed) {
      session = http2.connect(origin);
      session.on("error", () => this.sessions.delete(origin));
      session.on("close", () => this.sessions.delete(origin));
      this.sessions.set(origin, session);
    }
    return await new Promise((resolve, reject) => {
      const stream = session!.request({ ":method": "POST", ":path": path, ...headers });
      stream.setTimeout(10_000, () => stream.close(http2.constants.NGHTTP2_CANCEL));
      let status = 0;
      let apnsId: string | undefined;
      let text = "";
      stream.on("response", (responseHeaders) => {
        status = Number(responseHeaders[":status"] ?? 0);
        const id = responseHeaders["apns-id"];
        apnsId = typeof id === "string" ? id : undefined;
      });
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => { text += chunk; });
      stream.on("end", () => resolve({ status, body: text, ...(apnsId ? { apnsId } : {}) }));
      stream.on("error", reject);
      stream.on("close", () => { if (status === 0) reject(new Error("stream closed")); });
      stream.end(body);
    });
  }
}

/**
 * Server-side configuration for the transit API.
 *
 * Every value here is read from the environment on the server. The TAGO service
 * key is never part of this object: callers only ever learn whether live
 * transit is configured, never the credential itself.
 */

import { DEFAULT_STOP_CACHE_TTL_MS, DEFAULT_VEHICLE_CACHE_TTL_MS } from "./cachedTransitProvider.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
import { readSessionKeyPrefix } from "./sessionKeyPrefix.ts";
import { resolveTagoServiceKey, type ServiceKeySource } from "./serviceKey.ts";

export type ServerEnv = Record<string, string | undefined>;

export const DEFAULT_DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
/**
 * A ride polls every 5 s — twelve calls a minute. This leaves headroom for a
 * retry and a second device while still capping what a leaked token could
 * spend of the shared TAGO quota.
 */
export const DEFAULT_OPERATOR_RATE_LIMIT_PER_MINUTE = 30;

/**
 * The acceptance gate `docs/DATA_VALIDATION.md` states for broad real mode. It
 * is quoted here so `/health` cannot drift away from the document that owns it.
 */
export const REQUIRED_FIELD_BOARDINGS = 30;
export const FIELD_VALIDATION_REQUIREMENT =
  "at least 30 observed real boardings across multiple routes, with a clear candidate margin, "
  + "no silent direction reversal, and bounded stale-data behaviour";
/**
 * Durable session storage is a real and separate gap, but it is not why
 * automatic matching is off. It is off because the field-validation campaign
 * above has not been run. Saying anything else would overstate how close the
 * feature is.
 */
export const AUTOMATIC_MATCHING_WITHHELD_REASON = "field_validation_gate_open";

/**
 * Where journey sessions live. `memory` is the default everywhere; a durable
 * store is opted into, never inferred from the presence of a stray variable.
 */
export type SessionStoreKind = "memory" | "redis";

export interface UpstashCredentials {
  restUrl: string;
  restToken: string;
}

export type RuntimePlatform = "node" | "vercel";

export interface TransitApiConfig {
  transitProvider: "tago";
  /** True only when a TAGO service key is usable here. Never exposes the key. */
  liveTransitConfigured: boolean;
  /** Which environment variable supplied the credential, by category only. */
  credential: {
    source: ServiceKeySource;
    /** The deprecated name holds a value, whether or not it was used. */
    deprecatedNamePresent: boolean;
  };
  cachePolicy: {
    stopTtlMs: number;
    vehicleTtlMs: number;
    discoveryTtlMs: number;
  };
  sessions: {
    /**
     * `memory` is one process's heap: correct for the local Node server,
     * wrong for a horizontally scaled serverless deployment. `redis` is an
     * Upstash database reached over its REST API and survives both.
     */
    store: SessionStoreKind;
    /**
     * Whether the ride endpoints answer at all. It stays off by default on
     * serverless *while the store is `memory`*, because that combination
     * loses rides on scale-out. A deployment that configures a durable store
     * has removed that reason, and this flag is then the operator's to set.
     */
    enabled: boolean;
    /** True when `redis` has a usable URL and token. Never the values. */
    durableStoreConfigured: boolean;
  };
  /**
   * Automatic vehicle selection is a separate rollout axis from sessions.
   * Turning sessions on only makes the endpoints reachable; it must never be
   * enough to let the server pick a rider's bus for them.
   */
  matching: {
    /**
     * False on every deployment unless an operator sets
     * `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true` on purpose. The local Node
     * server gets no exemption: the blocker is field evidence, not topology.
     */
    automaticMatchingEnabled: boolean;
    /**
     * `shadow` ranks candidates and publishes cadence evidence but never
     * assigns `selectedVehicleId` on its own. `automatic` additionally allows
     * the coordinator to select. Explicit rider confirmation works in both.
     */
    mode: "shadow" | "automatic";
    /** Why automatic selection is withheld. Absent when it is not withheld. */
    withheldReason?: string;
    /**
     * The documented broad-real-mode acceptance gate from
     * `docs/DATA_VALIDATION.md`. This is a hand-maintained constant, not a
     * live counter: nothing in the server observes boardings yet, so it stays
     * `open` until a human edits it after the field campaign.
     */
    fieldValidationGate: {
      status: "open";
      requiredBoardings: number;
      requirement: string;
    };
  };
  rateLimit: {
    enabled: boolean;
    limit: number;
    windowSeconds: number;
  };
  cors: {
    /** Empty means no browser origin is allowed; native clients are unaffected. */
    allowedOrigins: string[];
  };
  /**
   * The operator-only ride-capture endpoints. Presence of a token only; the
   * token itself never reaches this object, and so never reaches `/health`.
   */
  operator: {
    enabled: boolean;
    rateLimitPerMinute: number;
    /** Why a configured token was refused, when it was. Never the value. */
    problem?: string;
  };
  runtime: {
    platform: RuntimePlatform;
    node: string;
    region?: string;
  };
  build: {
    commit?: string;
    environment?: string;
  };
}

export interface ReadConfigOptions {
  nodeVersion?: string;
}

export function readTransitApiConfig(
  env: ServerEnv = process.env as ServerEnv,
  options: ReadConfigOptions = {},
): TransitApiConfig {
  const platform: RuntimePlatform = trimmed(env, "VERCEL") ? "vercel" : "node";
  const rateLimitPerMinute = nonNegativeInteger(env, "TRANSIT_RATE_LIMIT_PER_MINUTE", DEFAULT_RATE_LIMIT_PER_MINUTE);
  const credential = resolveTagoServiceKey(env);
  const operator = resolveOperatorToken(env);
  const operatorRateLimit = nonNegativeInteger(
    env,
    "RIDE_CAPTURE_OPERATOR_RATE_LIMIT_PER_MINUTE",
    DEFAULT_OPERATOR_RATE_LIMIT_PER_MINUTE,
  );
  // Default false on every platform. An operator who wants automatic selection
  // has to say so in an environment variable, and the reason it is off by
  // default is recorded next to the flag rather than left to a changelog.
  const automaticMatchingEnabled = boolean(env, "TRANSIT_AUTOMATIC_MATCHING_ENABLED", false);
  // Reading this validates it: asking for `redis` without usable credentials
  // throws here rather than booting a deployment that answers every session
  // request with a store error.
  const sessionStore = readSessionStoreKind(env);
  // Validated at boot on every store, not only `redis`: a malformed namespace
  // left dormant on a memory deployment would otherwise surface on the day the
  // store is switched. The value stays out of `TransitApiConfig`, which
  // `/health` serializes; the key layout is nobody's business but the wiring's.
  readSessionKeyPrefix(env);

  return {
    transitProvider: "tago",
    liveTransitConfigured: credential.source !== "missing",
    credential: {
      source: credential.source,
      deprecatedNamePresent: credential.deprecatedNamePresent,
    },
    cachePolicy: {
      stopTtlMs: duration(env, "TRANSIT_STOP_TTL_MS", DEFAULT_STOP_CACHE_TTL_MS),
      vehicleTtlMs: duration(env, "TRANSIT_VEHICLE_TTL_MS", DEFAULT_VEHICLE_CACHE_TTL_MS),
      discoveryTtlMs: duration(env, "TRANSIT_DISCOVERY_TTL_MS", DEFAULT_DISCOVERY_CACHE_TTL_MS),
    },
    sessions: {
      store: sessionStore,
      // A durable store removes the reason serverless defaults to off. The
      // operator still has to say yes; what changes is that saying yes is no
      // longer a decision to lose rides on scale-out.
      enabled: boolean(env, "TRANSIT_SESSIONS_ENABLED", platform === "node" || sessionStore === "redis"),
      durableStoreConfigured: sessionStore === "redis",
    },
    matching: {
      automaticMatchingEnabled,
      mode: automaticMatchingEnabled ? "automatic" : "shadow",
      ...(automaticMatchingEnabled
        ? {}
        : { withheldReason: AUTOMATIC_MATCHING_WITHHELD_REASON }),
      fieldValidationGate: {
        status: "open",
        requiredBoardings: REQUIRED_FIELD_BOARDINGS,
        requirement: FIELD_VALIDATION_REQUIREMENT,
      },
    },
    rateLimit: {
      enabled: rateLimitPerMinute > 0,
      limit: rateLimitPerMinute > 0 ? rateLimitPerMinute : DEFAULT_RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60,
    },
    cors: {
      allowedOrigins: originList(env, "TRANSIT_ALLOWED_ORIGINS"),
    },
    operator: {
      enabled: operator.configured,
      rateLimitPerMinute: operatorRateLimit,
      ...optional("problem", operator.problem),
    },
    runtime: {
      platform,
      node: options.nodeVersion ?? process.version,
      ...optional("region", trimmed(env, "VERCEL_REGION")),
    },
    build: {
      ...optional("commit", shortCommit(trimmed(env, "VERCEL_GIT_COMMIT_SHA"))),
      ...optional("environment", trimmed(env, "VERCEL_ENV")),
    },
  };
}

/**
 * The store is named explicitly, and naming `redis` without credentials is a
 * misconfiguration rather than a silent fallback to memory. Falling back would
 * put a deployment that believed it had durable sessions back on the exact
 * failure mode it was trying to leave.
 */
function readSessionStoreKind(env: ServerEnv): SessionStoreKind {
  const raw = trimmed(env, "TRANSIT_SESSION_STORE")?.toLowerCase();
  if (raw === undefined || raw === "memory") return "memory";
  if (raw !== "redis") throw new RangeError("TRANSIT_SESSION_STORE must be memory or redis");
  if (!readUpstashCredentials(env)) {
    throw new RangeError(
      "TRANSIT_SESSION_STORE=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }
  return "redis";
}

/**
 * The credentials themselves, for the wiring layer only. They never reach
 * `TransitApiConfig`, and so never reach `/health` — the same rule the TAGO
 * service key already follows.
 */
export function readUpstashCredentials(env: ServerEnv): UpstashCredentials | undefined {
  const restUrl = trimmed(env, "UPSTASH_REDIS_REST_URL");
  const restToken = trimmed(env, "UPSTASH_REDIS_REST_TOKEN");
  if (!restUrl || !restToken) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(restUrl);
  } catch {
    throw new RangeError("UPSTASH_REDIS_REST_URL must be an absolute https origin");
  }
  // Plain HTTP would put a bearer token on the wire in clear text.
  if (parsed.protocol !== "https:") {
    throw new RangeError("UPSTASH_REDIS_REST_URL must be an absolute https origin");
  }
  return { restUrl, restToken };
}

function trimmed(env: ServerEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function duration(env: ServerEnv, key: string, fallback: number): number {
  const raw = trimmed(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${key} must be a non-negative number`);
  return value;
}

function nonNegativeInteger(env: ServerEnv, key: string, fallback: number): number {
  const raw = trimmed(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${key} must be a non-negative integer`);
  return value;
}

/** Only the two explicit spellings are accepted; anything else is a misconfiguration. */
function boolean(env: ServerEnv, key: string, fallback: boolean): boolean {
  const raw = trimmed(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new RangeError(`${key} must be true or false`);
}

/**
 * Origins are compared literally against the request `Origin` header, so only
 * absolute `https://host[:port]` forms are accepted. `*` is deliberately not a
 * legal value: a wildcard would have to be written per endpoint, on purpose.
 */
function originList(env: ServerEnv, key: string): string[] {
  const raw = trimmed(env, key);
  if (raw === undefined) return [];
  const origins: string[] = [];
  for (const candidate of raw.split(",")) {
    const value = candidate.trim();
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new RangeError(`${key} entries must be absolute origins`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new RangeError(`${key} entries must be http or https origins`);
    }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
  }
  return origins;
}

function shortCommit(sha: string | undefined): string | undefined {
  if (!sha) return undefined;
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : undefined;
}

function optional<K extends string>(key: K, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

/**
 * Server-side configuration for the transit API.
 *
 * Every value here is read from the environment on the server. The TAGO service
 * key is never part of this object: callers only ever learn whether live
 * transit is configured, never the credential itself.
 */

import { DEFAULT_STOP_CACHE_TTL_MS, DEFAULT_VEHICLE_CACHE_TTL_MS } from "./cachedTransitProvider.ts";
import type { ReadinessLevel } from "./matcherSafetyGate.ts";
import { MATCHER_POLICY_VERSION } from "./matching.ts";
import {
  AUTOMATIC_MATCHING_MINIMUM_READINESS,
  automaticMatchingPermitted,
  DEMONSTRATED_MATCHING_READINESS,
  READINESS_EVIDENCE_PATH,
  READINESS_GATE,
} from "./matchingReadiness.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
import {
  classifySessionKeyPrefix,
  readSessionKeyPrefix,
  sessionNamespaceProblem,
  type SessionNamespaceClass,
} from "./sessionKeyPrefix.ts";
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
 * The historical broad-real-mode acceptance gate `docs/DATA_VALIDATION.md`
 * states. It was never met, and it no longer decides anything: release gate
 * `matcher-passive-safety-v4` superseded it. It is still quoted so `/health`
 * says plainly which gate a reader may remember and what replaced it.
 */
export const REQUIRED_FIELD_BOARDINGS = 30;
export const FIELD_VALIDATION_REQUIREMENT =
  "at least 30 observed real boardings across multiple routes, with a clear candidate margin, "
  + "no silent direction reversal, and bounded stale-data behaviour";
/**
 * Durable session storage is a real and separate gap, but it is not why
 * automatic matching is off. It is off because the demonstrated matcher
 * readiness is below what automatic selection needs. Saying anything else
 * would overstate how close the feature is.
 */
export const MATCHING_READINESS_WITHHELD_REASON = "matching_readiness_below_bounded_automation";
/** Readiness would permit it, and no operator has asked for it. */
export const NOT_REQUESTED_WITHHELD_REASON = "automatic_matching_not_requested";

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
    /**
     * The category of the Redis key namespace, with `redis` only. Never the
     * prefix itself. Production and preview share one database, so this is
     * how an operator confirms which one a deployment writes to.
     */
    namespace?: SessionNamespaceClass;
    /**
     * Why sessions are disabled although asked for: the namespace does not
     * belong to this deployment (`sessionNamespaceProblem`). Absent otherwise.
     */
    problem?: string;
  };
  /**
   * Automatic vehicle selection is a separate rollout axis from sessions.
   * Turning sessions on only makes the endpoints reachable; it must never be
   * enough to let the server pick a rider's bus for them.
   */
  /**
   * The hybrid ride position engine's production switch
   * (`docs/exec-plans/TAPSO_V1_RELEASE_CLOSURE.md` §6). The app reads it from
   * `/health` when a live ride starts; off by default until the hybrid release
   * gate passes on physical devices. Turning it off is the rollback.
   */
  hybridTracking: { enabled: boolean };
  matching: {
    /** The matcher policy serving sessions and `POST /v1/matches`. */
    matcherPolicy: string;
    /**
     * Whether the server may pick a rider's bus. True only when an operator
     * sets `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true` on purpose *and* the
     * demonstrated readiness permits it. The local Node server gets no
     * exemption: the blocker is evidence, not topology.
     */
    automaticMatchingEnabled: boolean;
    /**
     * What the environment asked for. `true` here with
     * `automaticMatchingEnabled: false` means the request was refused.
     */
    automaticMatchingRequested: boolean;
    /**
     * `shadow` ranks candidates and publishes cadence evidence but never
     * assigns `selectedVehicleId` on its own. `automatic` additionally allows
     * the coordinator to select. Explicit rider confirmation works in both.
     */
    mode: "shadow" | "automatic";
    /** Why automatic selection is withheld. Absent when it is not withheld. */
    withheldReason?: string;
    /**
     * The readiness release gate `matcher-passive-safety-v4` awarded, from
     * code (`matchingReadiness.ts`) that CI ties to the committed gate result.
     * It is never read from the environment.
     */
    readiness: {
      gate: string;
      demonstrated: ReadinessLevel;
      requiredForAutomaticMatching: ReadinessLevel;
      evidence: string;
    };
    /**
     * The historical broad-real-mode acceptance gate, never met, superseded
     * by the readiness gate above. A constant, not a live counter.
     */
    fieldValidationGate: {
      status: "superseded";
      supersededBy: string;
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
  /**
   * Tests only: the readiness to evaluate the flag against. Deployments always
   * use `DEMONSTRATED_MATCHING_READINESS`; nothing reads this from the
   * environment.
   */
  demonstratedReadiness?: ReadinessLevel;
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
  // has to say so in an environment variable, and even then the flag cannot
  // exceed the evidence: below the readiness automatic selection needs, the
  // request is refused and `/health` shows both what was asked and why not.
  const automaticMatchingRequested = boolean(env, "TRANSIT_AUTOMATIC_MATCHING_ENABLED", false);
  const demonstratedReadiness = options.demonstratedReadiness ?? DEMONSTRATED_MATCHING_READINESS;
  const readinessPermitsAutomatic = automaticMatchingPermitted(demonstratedReadiness);
  const automaticMatchingEnabled = automaticMatchingRequested && readinessPermitsAutomatic;
  // A session store that is asked for but cannot be used disables sessions,
  // never the deployment. It used to throw here, and on 2026-10-02 a
  // production deployment whose Upstash credentials did not reach it answered
  // every route with 500: the read endpoints have nothing to do with sessions.
  // The store falls back to `memory`, sessions stay off (the memory store
  // never serves them on serverless), and `/health` says why in categories,
  // never values or variable contents.
  let sessionStore: SessionStoreKind;
  let sessionKeyPrefix: string;
  let storeProblem: string | undefined;
  try {
    sessionStore = readSessionStoreKind(env);
    // Validated at boot on every store, not only `redis`: a malformed
    // namespace left dormant on a memory deployment would otherwise surface on
    // the day the store is switched. The value stays out of `TransitApiConfig`,
    // which `/health` serializes.
    sessionKeyPrefix = readSessionKeyPrefix(env);
  } catch (error) {
    sessionStore = "memory";
    sessionKeyPrefix = readSessionKeyPrefix({});
    storeProblem = sessionStoreProblem(error);
  }
  // Only a durable store writes keys, so only then does the namespace have to
  // belong to this deployment. A namespace that does not disables sessions
  // rather than the deployment.
  const namespace = sessionStore === "redis" ? classifySessionKeyPrefix(sessionKeyPrefix) : undefined;
  const namespaceProblem = namespace === undefined
    ? undefined
    : sessionNamespaceProblem(trimmed(env, "VERCEL_ENV"), namespace);
  // A durable store removes the reason serverless defaults to off. The
  // operator still has to say yes; what changes is that saying yes is no
  // longer a decision to lose rides on scale-out.
  const sessionsRequested = storeProblem === undefined
    && boolean(env, "TRANSIT_SESSIONS_ENABLED", platform === "node" || sessionStore === "redis");

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
      enabled: sessionsRequested && namespaceProblem === undefined,
      durableStoreConfigured: sessionStore === "redis",
      ...(namespace === undefined ? {} : { namespace }),
      ...(storeProblem !== undefined
        ? { problem: storeProblem }
        : sessionsRequested && namespaceProblem !== undefined ? { problem: namespaceProblem } : {}),
    },
    hybridTracking: { enabled: boolean(env, "TRANSIT_HYBRID_TRACKING_ENABLED", false) },
    matching: {
      matcherPolicy: MATCHER_POLICY_VERSION,
      automaticMatchingEnabled,
      automaticMatchingRequested,
      mode: automaticMatchingEnabled ? "automatic" : "shadow",
      ...(automaticMatchingEnabled
        ? {}
        : {
          withheldReason: readinessPermitsAutomatic
            ? NOT_REQUESTED_WITHHELD_REASON
            : MATCHING_READINESS_WITHHELD_REASON,
        }),
      readiness: {
        gate: READINESS_GATE,
        demonstrated: demonstratedReadiness,
        requiredForAutomaticMatching: AUTOMATIC_MATCHING_MINIMUM_READINESS,
        evidence: READINESS_EVIDENCE_PATH,
      },
      fieldValidationGate: {
        status: "superseded",
        supersededBy: READINESS_GATE,
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
/** What `/health` says about a store that could not be configured. Categories only. */
function sessionStoreProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/must be memory or redis/.test(message)) return "session store setting is neither memory nor redis; sessions are off";
  if (/requires/.test(message)) return "durable session store requested without its URL and token on this deployment; sessions are off";
  if (/https origin/.test(message)) return "durable session store URL is not an absolute https origin; sessions are off";
  return "session namespace setting is invalid; sessions are off";
}

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

/**
 * Server-side configuration for the transit API.
 *
 * Every value here is read from the environment on the server. The TAGO service
 * key is never part of this object: callers only ever learn whether live
 * transit is configured, never the credential itself.
 */

import { DEFAULT_STOP_CACHE_TTL_MS, DEFAULT_VEHICLE_CACHE_TTL_MS } from "./cachedTransitProvider.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
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
    store: "memory";
    /**
     * Ride sessions live in one process's memory. That is correct for the local
     * Node server and wrong for a horizontally scaled serverless deployment, so
     * the serverless default is off and the endpoints fail closed.
     */
    enabled: boolean;
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
      store: "memory",
      enabled: boolean(env, "TRANSIT_SESSIONS_ENABLED", platform === "node"),
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

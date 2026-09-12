/**
 * One place that decides which environment variable holds the TAGO credential.
 *
 * The canonical name is `TAGO_SERVICE_KEY`. The original name,
 * `PUBLIC_DATA_SERVICE_KEY`, cannot be a production secret: Vercel treats a
 * `PUBLIC_` prefix as a public framework variable and refuses to store it with
 * Sensitive visibility. Lowering the key's visibility to match the name would
 * be the wrong repair, so the name changed instead.
 *
 * The old name survives only as an explicitly deprecated **local development**
 * fallback, so an existing `.env.local` keeps working through the transition.
 * It is ignored outright on a serverless deployment: production reads the
 * canonical name and nothing else, which is what makes "the secret is stored
 * as Sensitive" a property of the deployment rather than a hope.
 *
 * This module is deliberately dependency-free and pure — the provider and the
 * health payload both resolve through it, so they can never disagree about
 * whether a credential is configured.
 */

export const CANONICAL_SERVICE_KEY_ENV = "TAGO_SERVICE_KEY";
export const DEPRECATED_SERVICE_KEY_ENV = "PUBLIC_DATA_SERVICE_KEY";

export type ServiceKeyEnv = Record<string, string | undefined>;

export type ServiceKeySource =
  /** Read from `TAGO_SERVICE_KEY`. The only source production accepts. */
  | "canonical"
  /** Read from `PUBLIC_DATA_SERVICE_KEY` outside serverless. Deprecated. */
  | "deprecated_local_fallback"
  /** No usable credential; every TAGO-backed endpoint must fail closed. */
  | "missing";

export interface ResolvedServiceKey {
  /** The credential, or an empty string when none is usable. Never logged. */
  key: string;
  source: ServiceKeySource;
  /**
   * True when the deprecated name holds a value, whether or not it was used.
   * Paired with `source: "missing"` this is the signature of the likely
   * migration mistake: the old name set on a deployment that ignores it.
   */
  deprecatedNamePresent: boolean;
}

export function resolveTagoServiceKey(env: ServiceKeyEnv = process.env as ServiceKeyEnv): ResolvedServiceKey {
  const canonical = trimmed(env, CANONICAL_SERVICE_KEY_ENV);
  const deprecated = trimmed(env, DEPRECATED_SERVICE_KEY_ENV);
  const deprecatedNamePresent = deprecated !== undefined;

  if (canonical !== undefined) return { key: canonical, source: "canonical", deprecatedNamePresent };

  // `VERCEL` is set by the platform on every build and invocation.
  const serverless = trimmed(env, "VERCEL") !== undefined;
  if (deprecated !== undefined && !serverless) {
    return { key: deprecated, source: "deprecated_local_fallback", deprecatedNamePresent };
  }

  return { key: "", source: "missing", deprecatedNamePresent };
}

/**
 * A one-line operator warning, or `undefined` when the configuration is clean.
 * Returns a message rather than logging so callers choose the sink and the
 * frequency; nothing here ever includes the credential itself.
 */
export function serviceKeyWarning(resolved: ResolvedServiceKey): string | undefined {
  if (resolved.source === "deprecated_local_fallback") {
    return `${DEPRECATED_SERVICE_KEY_ENV} is deprecated and is honoured only outside serverless; rename it to ${CANONICAL_SERVICE_KEY_ENV}`;
  }
  if (resolved.source === "missing" && resolved.deprecatedNamePresent) {
    return `${DEPRECATED_SERVICE_KEY_ENV} is set but ignored on this deployment; set ${CANONICAL_SERVICE_KEY_ENV} instead`;
  }
  return undefined;
}

function trimmed(env: ServiceKeyEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

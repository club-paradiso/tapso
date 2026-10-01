/**
 * Redis key namespaces for journey sessions.
 *
 * One physical Upstash database can host several TAPSO environments, and
 * unrelated applications, only if every environment writes under a namespace
 * that no other writer can reach. This module decides what a namespace may
 * look like; `UpstashJourneySessionStore` is handed one and never reads the
 * environment itself.
 *
 * The accepted shape, in full:
 *
 *   tapso:(<segment>:){0,3}journey-session:
 *   <segment> = [a-z0-9][a-z0-9_-]{0,31}, and never `journey-session`
 *
 * and at most `MAX_SESSION_KEY_PREFIX_LENGTH` characters. So:
 *
 *   tapso:journey-session:                 the default, and today's format
 *   tapso:preview:journey-session:         a preview deployment
 *   tapso:prod:journey-session:            production, once it moves off memory
 *   tapso:verify:journey-session:          scripts/upstash/verify-session-store.ts
 *
 * Why each rule exists:
 *
 *  - Lowercase ASCII letters, digits, `_`, `-` and `:` only. That rules out
 *    whitespace, control characters, every glob metacharacter Redis gives
 *    meaning to (`* ? [ ] ^ \`), and `{}`, which a cluster reads as a hash tag.
 *  - The `tapso:` head keeps every TAPSO key out of whatever else shares the
 *    database, and makes the empty or global namespace unspellable.
 *  - The fixed `journey-session:` tail, together with the rule that no middle
 *    segment may itself be `journey-session`, makes the accepted set
 *    prefix-free: no valid prefix is a proper prefix of another. Two
 *    environments with different prefixes therefore can never produce the
 *    same key, whatever characters a session id holds.
 */

export const DEFAULT_SESSION_KEY_PREFIX = "tapso:journey-session:";

/** Where the live verification script writes, apart from any runtime namespace. */
export const VERIFY_SESSION_KEY_PREFIX = "tapso:verify:journey-session:";

/** Production's namespace, and only production's. See `sessionNamespaceProblem`. */
export const PRODUCTION_SESSION_KEY_PREFIX = "tapso:prod:journey-session:";

/**
 * What a namespace is for, by category. `/health` publishes this category and
 * never the prefix itself, so an operator can confirm which namespace a
 * deployment writes under without the key layout leaving the server.
 */
export type SessionNamespaceClass = "production" | "preview" | "verification" | "default" | "custom";

export const SESSION_KEY_PREFIX_ENV = "TRANSIT_SESSION_KEY_PREFIX";

export const MAX_SESSION_KEY_PREFIX_LENGTH = 96;

export const SESSION_KEY_PREFIX_PATTERN =
  /^tapso:(?:[a-z0-9][a-z0-9_-]{0,31}:){0,3}journey-session:$/;

const TAIL_SEGMENT = "journey-session";

/**
 * Returns `raw` unchanged if it is a safe namespace, and throws otherwise.
 *
 * Nothing is trimmed or lowercased: a value that needs repairing is a value
 * someone typed wrong, and repairing it would hide which namespace they meant.
 */
export function validateSessionKeyPrefix(raw: string, source = "the session key prefix"): string {
  if (raw.length === 0) throw new RangeError(`${source} must not be empty`);
  if (raw.length > MAX_SESSION_KEY_PREFIX_LENGTH) {
    throw new RangeError(`${source} must be at most ${MAX_SESSION_KEY_PREFIX_LENGTH} characters`);
  }
  // Checked before the pattern only so the message names the actual mistake.
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new RangeError(`${source} must not contain control characters`);
  if (/\s/.test(raw)) throw new RangeError(`${source} must not contain whitespace`);
  if (/[*?[\]^\\{}]/.test(raw)) throw new RangeError(`${source} must not contain Redis pattern characters`);
  if (!SESSION_KEY_PREFIX_PATTERN.test(raw)) {
    throw new RangeError(
      `${source} must match tapso:[<segment>:]journey-session: using only a-z, 0-9, _ and -`,
    );
  }
  const middle = raw.split(":").slice(1, -2);
  if (middle.includes(TAIL_SEGMENT)) {
    throw new RangeError(`${source} must not nest one journey-session namespace inside another`);
  }
  return raw;
}

/**
 * The runtime namespace. Unset means the default, which is the key format
 * every existing row already uses.
 *
 * Set-but-invalid throws, and that includes set-but-empty. A deployment that
 * named a namespace and silently got the default would write preview rides
 * into whatever else uses the default — the collision this setting exists to
 * prevent.
 */
export function readSessionKeyPrefix(env: Record<string, string | undefined>): string {
  const raw = env[SESSION_KEY_PREFIX_ENV];
  if (raw === undefined) return DEFAULT_SESSION_KEY_PREFIX;
  return validateSessionKeyPrefix(raw, SESSION_KEY_PREFIX_ENV);
}

/**
 * The verification script's namespace.
 *
 * An explicit value passes the same validation as the runtime one, and must
 * still differ from the default runtime namespace and from any runtime
 * namespace configured alongside it: the script deletes what it writes, and it
 * must never be able to address a row a real ride could own.
 */
export function resolveVerificationKeyPrefix(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
): string {
  const prefix = explicit === undefined
    ? VERIFY_SESSION_KEY_PREFIX
    : validateSessionKeyPrefix(explicit, "the verification key prefix");
  const runtime = new Set([DEFAULT_SESSION_KEY_PREFIX, readSessionKeyPrefix(env)]);
  if (runtime.has(prefix)) {
    throw new RangeError("the verification key prefix must differ from every runtime session namespace");
  }
  return prefix;
}

/** The category of an already validated namespace. */
export function classifySessionKeyPrefix(prefix: string): SessionNamespaceClass {
  if (prefix === PRODUCTION_SESSION_KEY_PREFIX) return "production";
  if (prefix === DEFAULT_SESSION_KEY_PREFIX) return "default";
  const middle = prefix.split(":").slice(1, -2);
  if (middle.includes("verify")) return "verification";
  if (middle.includes("preview")) return "preview";
  return "custom";
}

/**
 * Why a deployment must not serve journey sessions from a namespace, or
 * `undefined` when it may.
 *
 * Production and preview deployments share one Upstash database, so the
 * namespace is the only thing keeping a preview's test rides out of real
 * riders' sessions, and the reverse. The rules make the production namespace
 * and the production deployment imply each other:
 *
 *  - a production deployment (`VERCEL_ENV=production`) serves sessions only
 *    from `PRODUCTION_SESSION_KEY_PREFIX`, never from the shared default or a
 *    preview namespace someone forgot to change;
 *  - nothing else, preview, development or a local process, may use the
 *    production namespace;
 *  - the verification namespace belongs to `scripts/upstash`, which deletes
 *    what it writes, and is never a runtime namespace.
 *
 * A violation disables sessions and says why in `/health`. It does not stop
 * the deployment booting: the read endpoints have nothing to do with it.
 */
export function sessionNamespaceProblem(
  deploymentEnvironment: string | undefined,
  namespace: SessionNamespaceClass,
): string | undefined {
  if (namespace === "verification") {
    return "the verification session namespace is reserved for scripts/upstash and is never served";
  }
  if (deploymentEnvironment === "production" && namespace !== "production") {
    return "a production deployment serves sessions only from the production namespace";
  }
  if (deploymentEnvironment !== "production" && namespace === "production") {
    return "only a production deployment may use the production session namespace";
  }
  return undefined;
}

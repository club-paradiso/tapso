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

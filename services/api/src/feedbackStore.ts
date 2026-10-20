/**
 * Beta tester feedback: `POST /v1/feedback`, read by the operator at
 * `GET /operator/feedback`.
 *
 * A tester picks what went wrong, may write a few lines, and may attach the
 * app's privacy-scrubbed ride record. The app says "sent" only after this
 * service answers 201 with a receipt id; anything else is a failure the app
 * shows as such, with a copy-and-share fallback.
 *
 * What is stored, and nothing more: the category, the tester's text, app and
 * OS versions, the device model identifier, the journey language, and the
 * diagnostics only when the tester ticked the consent box. No IP address, no
 * location, no account. Entries expire after `FEEDBACK_RETENTION_MS`.
 */

import { randomUUID } from "node:crypto";

import { upstashCommand, type UpstashConnection } from "./upstashRest.ts";

export const FEEDBACK_CATEGORIES = [
  "bus_not_found",
  "wrong_bus_selected",
  "wrong_remaining_stops",
  "missed_alert",
  "app_froze_or_quit",
  "translation_or_wording",
  "design_or_usability",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FEEDBACK_MESSAGE_MAX = 2_000;
export const FEEDBACK_DIAGNOSTICS_MAX = 24_000;
const SHORT_TEXT_MAX = 64;

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  appVersion: string;
  build: string;
  gitCommit?: string;
  buildConfiguration?: string;
  osVersion: string;
  deviceModel: string;
  language: string;
  /** Present only with `diagnosticsConsent: true`. */
  diagnostics?: string;
}

export interface FeedbackEntry extends FeedbackInput {
  id: string;
  receivedAt: string;
}

export class FeedbackInputError extends Error {
  readonly code = "INVALID_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "FeedbackInputError";
  }
}

export class FeedbackStoreError extends Error {
  readonly code = "FEEDBACK_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "FeedbackStoreError";
  }
}

function text(value: unknown, field: string, max: number, required = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new FeedbackInputError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new FeedbackInputError(`${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new FeedbackInputError(`${field} is required`);
  if ([...trimmed].length > max) throw new FeedbackInputError(`${field} is longer than ${max} characters`);
  return trimmed || undefined;
}

/** Validates a submission. Diagnostics without explicit consent are refused, not silently dropped. */
export function parseFeedback(value: unknown): FeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackInputError("JSON object required");
  const body = value as Record<string, unknown>;
  const category = body.category;
  if (typeof category !== "string" || !(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    throw new FeedbackInputError(`category must be one of ${FEEDBACK_CATEGORIES.join(", ")}`);
  }
  const consent = body.diagnosticsConsent === true;
  if (body.diagnostics !== undefined && body.diagnostics !== null && !consent) {
    throw new FeedbackInputError("diagnostics need diagnosticsConsent: true");
  }
  const gitCommit = text(body.gitCommit, "gitCommit", SHORT_TEXT_MAX, false);
  const buildConfiguration = text(body.buildConfiguration, "buildConfiguration", SHORT_TEXT_MAX, false);
  const diagnostics = consent ? text(body.diagnostics, "diagnostics", FEEDBACK_DIAGNOSTICS_MAX, false) : undefined;
  return {
    category: category as FeedbackCategory,
    message: text(body.message, "message", FEEDBACK_MESSAGE_MAX, false) ?? "",
    appVersion: text(body.appVersion, "appVersion", SHORT_TEXT_MAX)!,
    build: text(body.build, "build", SHORT_TEXT_MAX)!,
    ...(gitCommit ? { gitCommit } : {}),
    ...(buildConfiguration ? { buildConfiguration } : {}),
    osVersion: text(body.osVersion, "osVersion", SHORT_TEXT_MAX)!,
    deviceModel: text(body.deviceModel, "deviceModel", SHORT_TEXT_MAX)!,
    language: text(body.language, "language", SHORT_TEXT_MAX)!,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export interface FeedbackStore {
  /** `durable` is false for the in-process store: the receipt is real but survives no restart. */
  readonly durable: boolean;
  add(input: FeedbackInput, nowMs?: number): Promise<FeedbackEntry>;
  recent(limit: number, nowMs?: number): Promise<FeedbackEntry[]>;
}

function entry(input: FeedbackInput, nowMs: number): FeedbackEntry {
  return { id: randomUUID(), receivedAt: new Date(nowMs).toISOString(), ...input };
}

export class MemoryFeedbackStore implements FeedbackStore {
  readonly durable = false;
  private readonly entries: FeedbackEntry[] = [];

  async add(input: FeedbackInput, nowMs = Date.now()): Promise<FeedbackEntry> {
    const added = entry(input, nowMs);
    this.entries.unshift(added);
    this.entries.length = Math.min(this.entries.length, 500);
    return added;
  }

  async recent(limit: number, nowMs = Date.now()): Promise<FeedbackEntry[]> {
    return this.entries.filter((item) => nowMs - Date.parse(item.receivedAt) < FEEDBACK_RETENTION_MS).slice(0, limit);
  }
}

/**
 * One key per entry (`<prefix>feedback:<id>`, expiring after the retention
 * window) and a sorted index by receipt time, pruned on every write. The
 * prefix is the session store's namespace; session ids cannot contain `:`, so
 * no feedback key can collide with a session.
 */
export class UpstashFeedbackStore implements FeedbackStore {
  readonly durable = true;
  private readonly connection: UpstashConnection;
  private readonly keyPrefix: string;

  constructor(connection: UpstashConnection, keyPrefix: string) {
    this.connection = connection;
    this.keyPrefix = keyPrefix;
  }

  private command(command: string[]): Promise<unknown> {
    return upstashCommand(this.connection, command, "the feedback store", (message) => new FeedbackStoreError(message));
  }

  private get index(): string {
    return `${this.keyPrefix}feedback-index`;
  }

  async add(input: FeedbackInput, nowMs = Date.now()): Promise<FeedbackEntry> {
    const added = entry(input, nowMs);
    const key = `${this.keyPrefix}feedback:${added.id}`;
    const stored = await this.command(["SET", key, JSON.stringify(added), "PX", String(FEEDBACK_RETENTION_MS), "NX"]);
    if (stored !== "OK") throw new FeedbackStoreError("the feedback store did not keep the entry");
    await this.command(["ZADD", this.index, String(nowMs), added.id]);
    await this.command(["ZREMRANGEBYSCORE", this.index, "-inf", String(nowMs - FEEDBACK_RETENTION_MS)]);
    return added;
  }

  async recent(limit: number): Promise<FeedbackEntry[]> {
    const ids = await this.command(["ZRANGE", this.index, "0", String(Math.max(0, limit - 1)), "REV"]);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const rows = await this.command(["MGET", ...ids.map((id) => `${this.keyPrefix}feedback:${String(id)}`)]);
    if (!Array.isArray(rows)) throw new FeedbackStoreError("the feedback store returned a malformed list");
    return rows.flatMap((row) => {
      if (typeof row !== "string") return [];
      try {
        return [JSON.parse(row) as FeedbackEntry];
      } catch {
        return [];
      }
    });
  }
}

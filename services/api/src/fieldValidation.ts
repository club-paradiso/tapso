/**
 * Durable field-validation submissions: a completed Railway ride, replayed and
 * counted on the server, with its raw capture kept for any later replay.
 *
 * The raw `RideCapture` is the only source of truth. On submit the server runs
 * the CURRENT `analyzeRideCapture` over it, classifies the result with the
 * same `classifyReplayedRide` the campaign CLI uses, and stores three things:
 *
 *   raw        gzip + base64, chunked; vehicle numbers and coordinates, private
 *   report     the sanitized report the analyzer produced from that raw
 *   submission sanitized gate metadata, the only thing the campaign reads
 *
 * No report is ever accepted from a client. Nothing here enables automatic
 * matching, and reaching thirty closes nothing: the summary says so.
 *
 * Storage is Upstash Redis, the same REST client and database family the
 * journey-session store already uses, under its own `tapso:field-validation:`
 * namespace. Keys carry a random submission id or a content hash, never a
 * vehicle number or a route-and-time that could identify a rider.
 */

import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { SelectionVerdict } from "./matchReplay.ts";
import { classifyReplayedRide, GATE_BOARDINGS_REQUIRED, type EvidenceBucket } from "./rideCampaign.ts";
import { analyzeRideCapture, type RideCapture, type RideCaptureReport } from "./rideCapture.ts";
import type { NumberSummary } from "./stats.ts";
import { upstashCommand, type UpstashConnection } from "./upstashRest.ts";

export const FIELD_VALIDATION_CAMPAIGN_ID = "broad-real-mode-30-boardings-v1";
export const FIELD_VALIDATION_KEY_PREFIX = "tapso:field-validation:v1:";
export const FIELD_SUBMISSION_SCHEMA_VERSION = 1;
/** Base64 characters per stored raw chunk; well under any Upstash request limit. */
export const RAW_CHUNK_CHARS = 256 * 1_024;

export class FieldValidationError extends Error {
  readonly kind: "unavailable" | "storage" | "invalid";
  constructor(message: string, kind: "unavailable" | "storage" | "invalid" = "storage") {
    super(message);
    this.kind = kind;
  }
}

/** Sanitized per-ride metadata. No vehicle number, no coordinate, no raw. */
export interface FieldRideSubmission {
  schemaVersion: number;
  id: string;
  campaignId: string;
  routeId: string;
  cityCode: string;
  startedAt: string;
  endedAt?: string;
  captureEngine: string;
  rawObjectKey: string;
  rawSha256: string;
  reportSha256: string;
  rawBytes: number;
  snapshotCount: number;
  evidenceVerdict: string;
  usableForGate: boolean;
  selectionVerdict: SelectionVerdict;
  contestedDecisions: number;
  candidateMargin: NumberSummary;
  boardedDirectionChanges: number;
  selectionsWhileNotFresh: number;
  boardedCadenceStates: Record<string, number>;
  bucket: EvidenceBucket;
  policy: "DECIDED" | "UNRESOLVED";
  reasons: string[];
  /** False when replay under the current matcher disagrees with the ride-time report. */
  replayAgreesWithRideTimeReport?: boolean;
  /** Another submission with the same route, start and engine but different bytes. */
  sameRideAs?: string;
  analyzerSchemaVersion: number;
  submittedAt: string;
}

export interface FieldValidationStore {
  /** SET NX: the first caller claims the hash; later callers get the claimant's id. */
  claimRawHash(rawSha256: string, submissionId: string): Promise<{ claimed: boolean; submissionId: string }>;
  /** Same, keyed by route + start + engine. Advisory only; never used to reject. */
  claimRideKey(rideKey: string, submissionId: string): Promise<{ claimed: boolean; submissionId: string }>;
  putRaw(submissionId: string, chunks: string[], meta: { rawSha256: string; rawBytes: number }): Promise<string>;
  readRaw(submissionId: string): Promise<{ chunks: string[]; rawSha256: string } | undefined>;
  putReport(submissionId: string, report: RideCaptureReport): Promise<void>;
  /** Written last: its presence is what makes a submission committed. */
  putSubmission(record: FieldRideSubmission): Promise<void>;
  getSubmission(submissionId: string): Promise<FieldRideSubmission | undefined>;
  addToCampaign(campaignId: string, submissionId: string): Promise<void>;
  listCampaign(campaignId: string): Promise<FieldRideSubmission[]>;
}

/* ------------------------------------------------------------ campaign view */

export interface FieldCampaignSummary {
  campaignId: string;
  submissions: number;
  cleanObservedBoardings: number;
  remainingToThirty: number;
  /** Always false. Thirty is necessary, not sufficient; a human closes the gate. */
  gateClosed: false;
  note: string;
  routeCount: number;
  cleanRouteCount: number;
  buckets: Record<EvidenceBucket, number>;
  verdictCounts: Record<SelectionVerdict, number>;
  contestedDecisions: number;
  ridesWithContestedDecisions: number;
  directionReversals: number;
  staleSelections: number;
  /** Anything a human must look at before trusting the count. */
  alerts: string[];
  /** Submission ids in submission order. Random ids, safe to show. */
  order: string[];
}

export function summarizeCampaign(campaignId: string, records: FieldRideSubmission[]): FieldCampaignSummary {
  const buckets: Record<EvidenceBucket, number> = {
    CLEAN_GATE_CANDIDATE: 0,
    HISTORICAL_MATCHER_EVIDENCE: 0,
    HISTORICAL_CONFOUNDED: 0,
    EXCLUDED: 0,
    REPORT_ONLY_NO_RAW: 0,
  };
  const verdicts: Record<SelectionVerdict, number> = { correct: 0, wrong: 0, never_committed: 0, no_boarded_vehicle: 0 };
  const routes = new Set<string>();
  const cleanRoutes = new Set<string>();
  let contested = 0;
  let contestedRides = 0;
  let reversals = 0;
  let stale = 0;
  const alerts: string[] = [];
  for (const record of records) {
    buckets[record.bucket] += 1;
    verdicts[record.selectionVerdict] += 1;
    routes.add(record.routeId);
    if (record.bucket === "CLEAN_GATE_CANDIDATE") cleanRoutes.add(record.routeId);
    contested += record.contestedDecisions;
    if (record.contestedDecisions > 0) contestedRides += 1;
    reversals += record.boardedDirectionChanges;
    stale += record.selectionsWhileNotFresh;
    if (record.replayAgreesWithRideTimeReport === false) {
      alerts.push(`submission ${record.id} replays differently under the current matcher than at ride time`);
    }
    if (record.sameRideAs) alerts.push(`submission ${record.id} shares route, start and engine with ${record.sameRideAs}`);
  }
  if (verdicts.wrong > 0) alerts.unshift(`GATE_FAILURE: ${verdicts.wrong} ride(s) committed to the wrong bus`);
  if (reversals > 0) alerts.unshift(`GATE_FAILURE: ${reversals} boarded direction change(s)`);
  if (stale > 0) alerts.unshift(`FAIL_CLOSED_BUG: ${stale} selection(s) on non-fresh cadence`);
  const clean = buckets.CLEAN_GATE_CANDIDATE;
  return {
    campaignId,
    submissions: records.length,
    cleanObservedBoardings: clean,
    remainingToThirty: Math.max(0, GATE_BOARDINGS_REQUIRED - clean),
    gateClosed: false,
    note: "Reaching 30 does NOT close the gate or enable automatic matching; every criterion in docs/DATA_VALIDATION.md must also hold and a human must decide.",
    routeCount: routes.size,
    cleanRouteCount: cleanRoutes.size,
    buckets,
    verdictCounts: verdicts,
    contestedDecisions: contested,
    ridesWithContestedDecisions: contestedRides,
    directionReversals: reversals,
    staleSelections: stale,
    alerts,
    order: records.map((record) => record.id),
  };
}

/* ------------------------------------------------------------------ submit */

export interface SubmissionReceipt {
  submissionId: string;
  duplicate: boolean;
  bucket: EvidenceBucket;
  policy: "DECIDED" | "UNRESOLVED";
  reasons: string[];
  selectionVerdict: SelectionVerdict;
  usableForGate: boolean;
  evidenceVerdict: string;
  routeId: string;
  startedAt: string;
  /** 1-based position of this ride among the campaign's submissions, in submission order. */
  fieldRideNumber: number;
  campaign: FieldCampaignSummary;
}

export interface SubmitOptions {
  store: FieldValidationStore;
  campaignId?: string;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Persist and count one completed raw capture.
 *
 * Idempotent on the raw bytes: the same capture submitted twice returns the
 * first submission with `duplicate: true` and changes no count. A submission
 * interrupted by a storage failure resumes under the same id on retry, because
 * the hash claim is taken first and the record is written last.
 */
export async function submitCompletedCapture(
  raw: RideCapture,
  rideTimeReport: RideCaptureReport | undefined,
  options: SubmitOptions,
): Promise<SubmissionReceipt> {
  const { store } = options;
  const campaignId = options.campaignId ?? FIELD_VALIDATION_CAMPAIGN_ID;
  const now = options.now ?? (() => new Date());
  if (!raw.endedAt) throw new FieldValidationError("only a completed capture can be submitted", "invalid");

  const canonical = canonicalJson(raw);
  const rawSha256 = sha256(canonical);
  // The current matcher, over the raw. Never a report someone handed us.
  const report = analyzeRideCapture(raw);
  const ride = classifyReplayedRide(`${raw.routeId}-${raw.startedAt}`, report);
  const gate = ride.matchGate!;

  const claim = await store.claimRawHash(rawSha256, (options.newId ?? randomUUID)());
  const existing = await store.getSubmission(claim.submissionId);
  if (existing) return receipt(existing, true, await campaignFor(store, campaignId));

  const submissionId = claim.submissionId;
  const rideKey = sha256(`${raw.routeId}|${raw.startedAt}|${raw.captureEngine ?? "unknown"}`);
  const rideClaim = await store.claimRideKey(rideKey, submissionId);

  const compressed = gzipSync(Buffer.from(canonical, "utf8")).toString("base64");
  const chunks: string[] = [];
  for (let offset = 0; offset < compressed.length; offset += RAW_CHUNK_CHARS) {
    chunks.push(compressed.slice(offset, offset + RAW_CHUNK_CHARS));
  }
  const rawBytes = Buffer.byteLength(canonical, "utf8");
  const rawObjectKey = await store.putRaw(submissionId, chunks, { rawSha256, rawBytes });
  await store.putReport(submissionId, report);

  const record: FieldRideSubmission = {
    schemaVersion: FIELD_SUBMISSION_SCHEMA_VERSION,
    id: submissionId,
    campaignId,
    routeId: raw.routeId,
    cityCode: raw.cityCode,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    captureEngine: report.captureEngine,
    rawObjectKey,
    rawSha256,
    reportSha256: sha256(canonicalJson(report)),
    rawBytes,
    snapshotCount: report.snapshotCount,
    evidenceVerdict: report.evidenceCompleteness.verdict,
    usableForGate: gate.usableForGate,
    selectionVerdict: gate.selectionVerdict,
    contestedDecisions: gate.contestedDecisions,
    candidateMargin: gate.candidateMargin,
    boardedDirectionChanges: gate.boardedDirectionChanges,
    selectionsWhileNotFresh: gate.selectionsWhileNotFresh,
    boardedCadenceStates: gate.boardedCadenceStates,
    bucket: ride.bucket,
    policy: ride.policy,
    reasons: ride.reasons,
    ...(rideTimeReport ? { replayAgreesWithRideTimeReport: sameGate(report, rideTimeReport) } : {}),
    ...(!rideClaim.claimed && rideClaim.submissionId !== submissionId ? { sameRideAs: rideClaim.submissionId } : {}),
    analyzerSchemaVersion: report.schemaVersion,
    submittedAt: now().toISOString(),
  };
  assertSanitized(record, raw);
  await store.putSubmission(record);
  await store.addToCampaign(campaignId, submissionId);
  const result = receipt(record, false, await campaignFor(store, campaignId));
  assertSanitized(result, raw);
  return result;
}

export async function campaignFor(store: FieldValidationStore, campaignId = FIELD_VALIDATION_CAMPAIGN_ID) {
  return summarizeCampaign(campaignId, await store.listCampaign(campaignId));
}

/** Decode a stored raw capture back to the exact canonical JSON that was hashed. */
export async function loadStoredRaw(store: FieldValidationStore, submissionId: string): Promise<RideCapture | undefined> {
  const stored = await store.readRaw(submissionId);
  if (!stored) return undefined;
  const json = gunzipSync(Buffer.from(stored.chunks.join(""), "base64")).toString("utf8");
  if (sha256(json) !== stored.rawSha256) throw new FieldValidationError("stored raw capture failed its checksum");
  return JSON.parse(json) as RideCapture;
}

function receipt(record: FieldRideSubmission, duplicate: boolean, campaign: FieldCampaignSummary): SubmissionReceipt {
  return {
    submissionId: record.id,
    duplicate,
    bucket: record.bucket,
    policy: record.policy,
    reasons: record.reasons,
    selectionVerdict: record.selectionVerdict,
    usableForGate: record.usableForGate,
    evidenceVerdict: record.evidenceVerdict,
    routeId: record.routeId,
    startedAt: record.startedAt,
    fieldRideNumber: campaign.order.indexOf(record.id) + 1,
    campaign,
  };
}

function sameGate(a: RideCaptureReport, b: RideCaptureReport): boolean {
  const pick = (report: RideCaptureReport) => canonicalJson({
    usableForGate: report.matchGate?.usableForGate,
    selectionVerdict: report.matchGate?.selectionVerdict,
    contestedDecisions: report.matchGate?.contestedDecisions,
    candidateMargin: report.matchGate?.candidateMargin,
    boardedDirectionChanges: report.matchGate?.directionReversal?.boardedDirectionChanges,
    selectionsWhileNotFresh: report.matchGate?.staleData?.selectionsWhileNotFresh,
  });
  return pick(a) === pick(b);
}

/** Second lock: no vehicle number or coordinate may reach sanitized output. */
function assertSanitized(value: unknown, raw: RideCapture): void {
  const text = JSON.stringify(value);
  const ids = new Set<string>();
  if (raw.boardedVehicleId) ids.add(raw.boardedVehicleId);
  for (const snapshot of raw.snapshots) for (const vehicle of snapshot.vehicles) ids.add(vehicle.vehicleId);
  for (const id of ids) {
    if (id && text.includes(id)) throw new FieldValidationError("sanitized output would contain a vehicle identifier", "invalid");
  }
  if (/"(latitude|longitude)"\s*:/.test(text)) {
    throw new FieldValidationError("sanitized output would contain coordinates", "invalid");
  }
}

/** JSON with object keys sorted, so the same capture always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/* ------------------------------------------------------------------ stores */

/** Process memory. Tests only: it is not durable and the collector never uses it in production. */
export class MemoryFieldValidationStore implements FieldValidationStore {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

  async claimRawHash(rawSha256: string, submissionId: string) {
    return this.claim(`hash:${rawSha256}`, submissionId);
  }

  async claimRideKey(rideKey: string, submissionId: string) {
    return this.claim(`ride:${rideKey}`, submissionId);
  }

  async putRaw(submissionId: string, chunks: string[], meta: { rawSha256: string; rawBytes: number }) {
    chunks.forEach((chunk, index) => this.values.set(`raw:${submissionId}:${index}`, chunk));
    this.values.set(`raw:${submissionId}:meta`, JSON.stringify({ ...meta, chunks: chunks.length, encoding: "gzip+base64" }));
    return `raw:${submissionId}`;
  }

  async readRaw(submissionId: string) {
    const meta = this.values.get(`raw:${submissionId}:meta`);
    if (!meta) return undefined;
    const parsed = JSON.parse(meta) as { chunks: number; rawSha256: string };
    const chunks = Array.from({ length: parsed.chunks }, (_, index) => this.values.get(`raw:${submissionId}:${index}`) ?? "");
    return { chunks, rawSha256: parsed.rawSha256 };
  }

  async putReport(submissionId: string, report: RideCaptureReport) {
    this.values.set(`report:${submissionId}`, JSON.stringify(report));
  }

  async putSubmission(record: FieldRideSubmission) {
    this.values.set(`submission:${record.id}`, JSON.stringify(record));
  }

  async getSubmission(submissionId: string) {
    const value = this.values.get(`submission:${submissionId}`);
    return value ? JSON.parse(value) as FieldRideSubmission : undefined;
  }

  async addToCampaign(campaignId: string, submissionId: string) {
    const set = this.sets.get(campaignId) ?? new Set<string>();
    set.add(submissionId);
    this.sets.set(campaignId, set);
  }

  async listCampaign(campaignId: string) {
    const records: FieldRideSubmission[] = [];
    for (const id of [...(this.sets.get(campaignId) ?? [])].sort()) {
      const record = await this.getSubmission(id);
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));
  }

  private claim(key: string, submissionId: string) {
    const existing = this.values.get(key);
    if (existing) return { claimed: false, submissionId: existing };
    this.values.set(key, submissionId);
    return { claimed: true, submissionId };
  }
}

/**
 * Upstash Redis over REST. Keys, all under `FIELD_VALIDATION_KEY_PREFIX`:
 *
 *   hash:<rawSha256>            submission id (SET NX)     dedupe identity
 *   ride:<sha(route|start|eng)> submission id (SET NX)     advisory only
 *   raw:<id>:meta               {chunks, rawSha256, ...}
 *   raw:<id>:<n>                gzip+base64 chunk n        sensitive
 *   report:<id>                 sanitized report JSON
 *   submission:<id>             sanitized FieldRideSubmission
 *   campaign:<campaignId>       set of submission ids      (SADD, idempotent)
 *
 * No TTL: this is evidence. The database must not evict keys; see
 * docs/DATA_VALIDATION.md for the one-time setup.
 */
export class UpstashFieldValidationStore implements FieldValidationStore {
  private readonly connection: UpstashConnection;
  private readonly prefix: string;

  constructor(connection: UpstashConnection, prefix = FIELD_VALIDATION_KEY_PREFIX) {
    this.connection = connection;
    this.prefix = prefix;
  }

  async claimRawHash(rawSha256: string, submissionId: string) {
    return this.claim(`hash:${rawSha256}`, submissionId);
  }

  async claimRideKey(rideKey: string, submissionId: string) {
    return this.claim(`ride:${rideKey}`, submissionId);
  }

  async putRaw(submissionId: string, chunks: string[], meta: { rawSha256: string; rawBytes: number }) {
    for (const [index, chunk] of chunks.entries()) {
      await this.command(["SET", this.key(`raw:${submissionId}:${index}`), chunk]);
    }
    await this.command(["SET", this.key(`raw:${submissionId}:meta`),
      JSON.stringify({ ...meta, chunks: chunks.length, encoding: "gzip+base64" })]);
    return `raw:${submissionId}`;
  }

  async readRaw(submissionId: string) {
    const meta = await this.command(["GET", this.key(`raw:${submissionId}:meta`)]);
    if (typeof meta !== "string") return undefined;
    const parsed = JSON.parse(meta) as { chunks: number; rawSha256: string };
    const chunks: string[] = [];
    for (let index = 0; index < parsed.chunks; index += 1) {
      const chunk = await this.command(["GET", this.key(`raw:${submissionId}:${index}`)]);
      if (typeof chunk !== "string") throw new FieldValidationError("a stored raw chunk is missing");
      chunks.push(chunk);
    }
    return { chunks, rawSha256: parsed.rawSha256 };
  }

  async putReport(submissionId: string, report: RideCaptureReport) {
    await this.command(["SET", this.key(`report:${submissionId}`), JSON.stringify(report)]);
  }

  async putSubmission(record: FieldRideSubmission) {
    await this.command(["SET", this.key(`submission:${record.id}`), JSON.stringify(record)]);
  }

  async getSubmission(submissionId: string) {
    const value = await this.command(["GET", this.key(`submission:${submissionId}`)]);
    return typeof value === "string" ? JSON.parse(value) as FieldRideSubmission : undefined;
  }

  async addToCampaign(campaignId: string, submissionId: string) {
    await this.command(["SADD", this.key(`campaign:${campaignId}`), submissionId]);
  }

  async listCampaign(campaignId: string) {
    const ids = await this.command(["SMEMBERS", this.key(`campaign:${campaignId}`)]);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const values = await this.command(["MGET", ...ids.map((id) => this.key(`submission:${String(id)}`))]);
    const records = (Array.isArray(values) ? values : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as FieldRideSubmission);
    return records.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));
  }

  private async claim(key: string, submissionId: string) {
    const set = await this.command(["SET", this.key(key), submissionId, "NX"]);
    if (set === "OK") return { claimed: true, submissionId };
    const existing = await this.command(["GET", this.key(key)]);
    if (typeof existing !== "string") throw new FieldValidationError("a submission claim vanished");
    return { claimed: false, submissionId: existing };
  }

  private key(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }

  private command(command: string[]): Promise<unknown> {
    return upstashCommand(this.connection, command, "the field-validation store",
      (message) => new FieldValidationError(message));
  }
}

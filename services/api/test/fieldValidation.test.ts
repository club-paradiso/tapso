import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createBackgroundRequestHandler } from "../src/backgroundHttp.ts";
import {
  FIELD_VALIDATION_KEY_PREFIX,
  loadStoredRaw,
  MemoryFieldValidationStore,
  summarizeCampaign,
  UpstashFieldValidationStore,
  type FieldRideSubmission,
  type FieldValidationStore,
  type SubmissionReceipt,
} from "../src/fieldValidation.ts";
import { analyzeRideCapture, type RideCapture } from "../src/rideCapture.ts";
import {
  exclusionReason,
  shouldWarnBeforeLeaving,
  submissionView,
  submitFailureView,
} from "../public/ride-capture/background-client-core.js";
import { BOARDED, DECOY, railwayHarness, TOKEN } from "./syntheticRailway.ts";

type Harness = ReturnType<typeof railwayHarness>;

async function serve(h: Harness, store: FieldValidationStore | null = new MemoryFieldValidationStore()) {
  const server = createServer(createBackgroundRequestHandler({
    captures: h.coordinator,
    operator: { configured: true, token: TOKEN },
    allowedOrigins: [],
    health: () => ({ ok: true }),
    log: () => {},
    ...(store ? { fieldValidation: { store } } : {}),
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (method: string, route: string, { token = TOKEN, body }: { token?: string; body?: unknown } = {}) =>
    fetch(base + route, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    store,
    submit: (id: string, options?: { token?: string; body?: unknown }) => call("POST", `/capture/${id}/submit`, options),
    campaign: (token = TOKEN) => call("GET", "/field-validation/campaign", { token }),
    raw: (id: string) => call("GET", `/capture/${id}/raw`),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function assertSanitized(text: string) {
  assert.ok(!text.includes(BOARDED) && !text.includes(DECOY), "no vehicle number");
  assert.ok(!/"(latitude|longitude)"\s*:/.test(text), "no coordinate");
  assert.ok(!/"snapshots"\s*:/.test(text), "no raw capture content");
}

/** Fails the first N writes of one kind, then behaves. */
class FlakyStore extends MemoryFieldValidationStore {
  failures: number;
  constructor(failures: number) {
    super();
    this.failures = failures;
  }
  override async putReport(...args: Parameters<MemoryFieldValidationStore["putReport"]>) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new (await import("../src/fieldValidation.ts")).FieldValidationError("synthetic storage outage");
    }
    return super.putReport(...args);
  }
}

/* ------------------------------------------------------------------ submit */

test("a completed clean ride is replayed, stored durably, and counted", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const api = await serve(h);
  try {
    const response = await api.submit(done.sessionId);
    assert.equal(response.status, 201);
    const text = await response.text();
    assertSanitized(text);
    const receipt = JSON.parse(text) as SubmissionReceipt;
    assert.equal(receipt.duplicate, false);
    assert.equal(receipt.bucket, "CLEAN_GATE_CANDIDATE");
    assert.equal(receipt.selectionVerdict, "correct");
    assert.equal(receipt.fieldRideNumber, 1);
    assert.equal(receipt.campaign.cleanObservedBoardings, 1);
    assert.equal(receipt.campaign.remainingToThirty, 29);
    assert.equal(receipt.campaign.gateClosed, false);

    // Raw persisted exactly, report persisted, and both replay the same.
    const store = api.store as MemoryFieldValidationStore;
    const stored = await loadStoredRaw(store, receipt.submissionId);
    assert.deepEqual(stored, h.coordinator.completedCapture(done.sessionId));
    assert.ok(store.values.has(`report:${receipt.submissionId}`));
    const record = (await store.getSubmission(receipt.submissionId))!;
    const replay = analyzeRideCapture(stored as RideCapture).matchGate;
    assert.equal(record.selectionVerdict, replay.selectionVerdict);
    assert.equal(record.contestedDecisions, replay.contestedDecisions);
    assert.deepEqual(record.candidateMargin, replay.candidateMargin);
    assert.equal(record.replayAgreesWithRideTimeReport, true);
    assertSanitized(JSON.stringify(record));
  } finally {
    await api.close();
  }
});

test("re-submitting the same capture is idempotent and never counts twice", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const api = await serve(h);
  try {
    const first = await (await api.submit(done.sessionId)).json() as SubmissionReceipt;
    const second = await api.submit(done.sessionId);
    assert.equal(second.status, 200);
    const again = await second.json() as SubmissionReceipt;
    assert.equal(again.duplicate, true);
    assert.equal(again.submissionId, first.submissionId);
    assert.equal(again.fieldRideNumber, 1);
    assert.equal(again.campaign.cleanObservedBoardings, 1);
    assert.equal(again.campaign.submissions, 1);
  } finally {
    await api.close();
  }
});

test("a ride that commits to the wrong bus is stored, excluded, and surfaced", async () => {
  const h = railwayHarness({ "SYN-ROUTE-W": "wrong" });
  const done = await h.completedRide("SYN-ROUTE-W");
  const api = await serve(h);
  try {
    const receipt = await (await api.submit(done.sessionId)).json() as SubmissionReceipt;
    assert.equal(receipt.selectionVerdict, "wrong");
    assert.equal(receipt.bucket, "EXCLUDED");
    assert.equal(receipt.campaign.cleanObservedBoardings, 0);
    assert.equal(receipt.campaign.verdictCounts.wrong, 1);
    assert.match(receipt.campaign.alerts[0]!, /GATE_FAILURE/);
    assert.equal(exclusionReason(receipt), "WRONG_VEHICLE_SELECTED");
  } finally {
    await api.close();
  }
});

test("a client-supplied report is ignored: the raw decides", async () => {
  const h = railwayHarness({ "SYN-ROUTE-W": "wrong" });
  const done = await h.completedRide("SYN-ROUTE-W");
  const api = await serve(h);
  try {
    const forged = { report: { matchGate: { selectionVerdict: "correct", usableForGate: true } }, bucket: "CLEAN_GATE_CANDIDATE" };
    const receipt = await (await api.submit(done.sessionId, { body: forged })).json() as SubmissionReceipt;
    assert.equal(receipt.bucket, "EXCLUDED");
    assert.equal(receipt.selectionVerdict, "wrong");
  } finally {
    await api.close();
  }
});

test("a report without a live session cannot be submitted, so report-only never counts", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const report = h.coordinator.status(done.sessionId).report;
  const api = await serve(h);
  try {
    const response = await api.submit("00000000-0000-0000-0000-000000000000", { body: { report } });
    assert.equal(response.status, 404);
    const campaign = await (await api.campaign()).json() as { cleanObservedBoardings: number };
    assert.equal(campaign.cleanObservedBoardings, 0);
  } finally {
    await api.close();
  }
});

test("active and unknown captures cannot be submitted, and auth is required", async () => {
  const h = railwayHarness();
  const active = await h.start("SYN-ROUTE-A");
  const done = await h.completedRide("SYN-ROUTE-B");
  const api = await serve(h);
  try {
    assert.equal((await api.submit(active.sessionId)).status, 409);
    assert.equal((await api.submit("not*valid")).status, 400);
    assert.equal((await api.submit(done.sessionId, { token: "" })).status, 401);
    assert.equal((await api.submit(done.sessionId, { token: "wrong-token-wrong-token-wrong" })).status, 401);
    assert.equal((await api.campaign("")).status, 401);
    assert.equal((await api.campaign()).status, 200, "the token still works");
  } finally {
    await api.close();
  }
});

test("each submission stores only its own session's capture", async () => {
  const h = railwayHarness();
  const a = await h.completedRide("SYN-ROUTE-A");
  const b = await h.completedRide("SYN-ROUTE-B");
  const api = await serve(h);
  try {
    const ra = await (await api.submit(a.sessionId)).json() as SubmissionReceipt;
    const rb = await (await api.submit(b.sessionId)).json() as SubmissionReceipt;
    assert.notEqual(ra.submissionId, rb.submissionId);
    assert.equal(ra.routeId, "SYN-ROUTE-A");
    assert.equal(rb.routeId, "SYN-ROUTE-B");
    assert.equal((await loadStoredRaw(api.store!, ra.submissionId))!.routeId, "SYN-ROUTE-A");
    assert.equal((await loadStoredRaw(api.store!, rb.submissionId))!.routeId, "SYN-ROUTE-B");
    assert.equal(rb.campaign.cleanObservedBoardings, 2);
    assert.equal(rb.campaign.routeCount, 2);
    assert.equal(rb.fieldRideNumber, 2);
  } finally {
    await api.close();
  }
});

/* ------------------------------------------------------------ failure paths */

test("a storage failure keeps the ride, and a retry completes it without double counting", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const store = new FlakyStore(1);
  const api = await serve(h, store);
  try {
    const failed = await api.submit(done.sessionId);
    assert.equal(failed.status, 503);
    const body = await failed.json() as { error: string; message: string };
    assert.equal(body.error, "SUBMISSION_FAILED");
    assert.match(body.message, /still holds the raw capture/);

    // The source session is untouched: manual export and retry both still work.
    assert.equal((await api.raw(done.sessionId)).status, 200);
    const retried = await api.submit(done.sessionId);
    assert.equal(retried.status, 201);
    const receipt = await retried.json() as SubmissionReceipt;
    assert.equal(receipt.duplicate, false);
    assert.equal(receipt.campaign.cleanObservedBoardings, 1);
    assert.equal(receipt.campaign.submissions, 1);
  } finally {
    await api.close();
  }
});

/** Fails the first N campaign additions, after the submission itself is stored. */
class FlakyCampaignStore extends MemoryFieldValidationStore {
  failures: number;
  constructor(failures: number) {
    super();
    this.failures = failures;
  }
  override async addToCampaign(...args: Parameters<MemoryFieldValidationStore["addToCampaign"]>) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new (await import("../src/fieldValidation.ts")).FieldValidationError("synthetic storage outage");
    }
    return super.addToCampaign(...args);
  }
}

test("a failure between storing a submission and counting it heals on retry, once", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const store = new FlakyCampaignStore(1);
  const api = await serve(h, store);
  try {
    assert.equal((await api.submit(done.sessionId)).status, 503);
    // The record is stored but not counted. The retry finds it and counts it.
    const retried = await api.submit(done.sessionId);
    const receipt = await retried.json() as SubmissionReceipt;
    assert.equal(receipt.duplicate, true);
    assert.equal(receipt.campaign.submissions, 1);
    assert.equal(receipt.campaign.cleanObservedBoardings, 1);
    // And a third submission still counts it once.
    const again = await (await api.submit(done.sessionId)).json() as SubmissionReceipt;
    assert.equal(again.campaign.submissions, 1);
  } finally {
    await api.close();
  }
});

test("without durable storage, submit refuses and manual export still works", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const api = await serve(h, null);
  try {
    const response = await api.submit(done.sessionId);
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: string }).error, "FIELD_VALIDATION_UNAVAILABLE");
    assert.equal((await api.raw(done.sessionId)).status, 200);
    assert.equal((await api.campaign()).status, 503);
  } finally {
    await api.close();
  }
});

test("manual raw download keeps working after a submission", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const api = await serve(h);
  try {
    await api.submit(done.sessionId);
    const raw = await api.raw(done.sessionId);
    assert.equal(raw.status, 200);
    assert.equal(((await raw.json()) as RideCapture).captureEngine, "railway-background");
  } finally {
    await api.close();
  }
});

/* ---------------------------------------------------------------- campaign */

test("the campaign endpoint is sanitized", async () => {
  const h = railwayHarness({ "SYN-ROUTE-W": "wrong" });
  const a = await h.completedRide("SYN-ROUTE-A");
  const w = await h.completedRide("SYN-ROUTE-W");
  const api = await serve(h);
  try {
    await api.submit(a.sessionId);
    await api.submit(w.sessionId);
    const response = await api.campaign();
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const text = await response.text();
    assertSanitized(text);
    const summary = JSON.parse(text) as ReturnType<typeof summarizeCampaign>;
    assert.equal(summary.cleanObservedBoardings, 1);
    assert.equal(summary.verdictCounts.correct, 1);
    assert.equal(summary.verdictCounts.wrong, 1);
    assert.equal(summary.routeCount, 2);
  } finally {
    await api.close();
  }
});

test("thirty clean rides close nothing and automatic matching stays off", () => {
  const record = (index: number): FieldRideSubmission => ({
    schemaVersion: 1, id: `id-${String(index).padStart(2, "0")}`, campaignId: "c", routeId: `R${index % 6}`, cityCode: "999",
    startedAt: new Date(index * 60_000).toISOString(), captureEngine: "railway-background",
    rawObjectKey: `raw:${index}`, rawSha256: `h${index}`, reportSha256: `r${index}`, rawBytes: 1, snapshotCount: 20,
    evidenceVerdict: "SUFFICIENT", usableForGate: true, selectionVerdict: "correct", contestedDecisions: 0,
    candidateMargin: { count: 0 }, boardedDirectionChanges: 0, selectionsWhileNotFresh: 0, boardedCadenceStates: {},
    bucket: "CLEAN_GATE_CANDIDATE", policy: "DECIDED", reasons: [], analyzerSchemaVersion: 1,
    submittedAt: new Date(index * 60_000).toISOString(),
  });
  const summary = summarizeCampaign("c", Array.from({ length: 30 }, (_, index) => record(index)));
  assert.equal(summary.cleanObservedBoardings, 30);
  assert.equal(summary.remainingToThirty, 0);
  assert.equal(summary.gateClosed, false);
  assert.match(summary.note, /does NOT close the gate/);
  assert.equal(readTransitApiConfig({}, { nodeVersion: "v22.18.0" }).matching.automaticMatchingEnabled, false);
});

/* ----------------------------------------------------------- Upstash store */

/** A fake Upstash REST endpoint: SET [NX], GET, SADD, SMEMBERS, MGET. */
function fakeUpstash() {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const fetchImpl = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    const [name, key, ...args] = JSON.parse(String(init.body)) as string[];
    let result: unknown = null;
    if (name === "SET") {
      if (args.includes("NX") && values.has(key!)) result = null;
      else { values.set(key!, args[0]!); result = "OK"; }
    } else if (name === "GET") result = values.get(key!) ?? null;
    else if (name === "SADD") {
      const set = sets.get(key!) ?? new Set();
      set.add(args[0]!);
      sets.set(key!, set);
      result = 1;
    } else if (name === "SMEMBERS") result = [...(sets.get(key!) ?? [])];
    else if (name === "MGET") result = [key!, ...args].map((k) => values.get(k) ?? null);
    else return new Response(JSON.stringify({ error: `unsupported ${name}` }), { status: 200 });
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { values, sets, fetchImpl };
}

test("the Upstash store keeps everything under its namespace, with no identifying key", async () => {
  const h = railwayHarness();
  const done = await h.completedRide();
  const upstash = fakeUpstash();
  const store = new UpstashFieldValidationStore({ restUrl: "https://synthetic.upstash.io", restToken: "synthetic", fetchImpl: upstash.fetchImpl });
  const api = await serve(h, store);
  try {
    const receipt = await (await api.submit(done.sessionId)).json() as SubmissionReceipt;
    assert.equal(receipt.bucket, "CLEAN_GATE_CANDIDATE");
    const again = await (await api.submit(done.sessionId)).json() as SubmissionReceipt;
    assert.equal(again.duplicate, true);
    assert.equal(again.campaign.cleanObservedBoardings, 1);

    const keys = [...upstash.values.keys(), ...upstash.sets.keys()];
    assert.ok(keys.every((key) => key.startsWith(FIELD_VALIDATION_KEY_PREFIX)));
    assert.ok(keys.every((key) => !key.includes(BOARDED) && !key.includes("SYN-ROUTE")), "keys name no vehicle or route");
    const rawChunks = [...upstash.values.entries()].filter(([key]) => /:raw:[^:]+:\d+$/.test(key));
    assert.ok(rawChunks.length >= 1);
    assert.ok(rawChunks.every(([, value]) => !value.includes(BOARDED)), "raw chunks are compressed, not plain JSON");
    assert.deepEqual(await loadStoredRaw(store, receipt.submissionId), h.coordinator.completedCapture(done.sessionId));
  } finally {
    await api.close();
  }
});

/* ------------------------------------------------------------------ client */

test("the finish screen reads the receipt without inventing anything", () => {
  const base = {
    submissionId: "s1", duplicate: false, policy: "DECIDED", reasons: [], usableForGate: true,
    evidenceVerdict: "SUFFICIENT", routeId: "R", startedAt: "t", fieldRideNumber: 7,
    campaign: { cleanObservedBoardings: 7, remainingToThirty: 23, alerts: [] },
  };
  const counted = submissionView({ ...base, bucket: "CLEAN_GATE_CANDIDATE", selectionVerdict: "correct" });
  assert.equal(counted.headline, "제출 완료");
  assert.equal(counted.title, "Field Ride #7");
  assert.equal(counted.counted, true);
  assert.ok(counted.lines.includes("캠페인 7 / 30"));
  assert.ok(counted.lines.includes("남은 기록 23"));

  const excluded = submissionView({ ...base, bucket: "EXCLUDED", selectionVerdict: "no_boarded_vehicle", usableForGate: false });
  assert.equal(excluded.counted, false);
  assert.ok(excluded.lines.includes("이번 기록은 검증 카운트에 포함되지 않음"));
  assert.ok(excluded.lines.includes("이유: NO_BOARDED_VEHICLE"));
  assert.equal(submissionView({ ...base, duplicate: true, bucket: "CLEAN_GATE_CANDIDATE", selectionVerdict: "correct" }).headline,
    "이미 제출된 기록입니다");

  const failed = submitFailureView({ status: 503, code: "SUBMISSION_FAILED" }, new Date("2026-09-23T11:00:00Z"));
  assert.equal(failed.headline, "제출 실패");
  assert.ok(failed.lines[0]!.includes("원본은 서버에서 아직 보관 중입니다"));
  assert.equal(failed.retry, true);
  assert.equal(submitFailureView({ status: 404 }).retry, false);

  assert.equal(shouldWarnBeforeLeaving({}), true);
  assert.equal(shouldWarnBeforeLeaving({ submitted: true }), false);
  assert.equal(shouldWarnBeforeLeaving({ rawRequested: true }), false);
});

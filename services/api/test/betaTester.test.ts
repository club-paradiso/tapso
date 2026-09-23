import test from "node:test";
import assert from "node:assert/strict";

import { ALIGHT_STOP_UNKNOWN_NOTE, DESTINATION_UNKNOWN_NOTE } from "../src/backgroundRideCapture.ts";
import { BETA_MATCHER_CAMPAIGN_ID } from "../src/betaCampaign.ts";
import {
  BETA_TESTER_KEY_PREFIX,
  MemoryBetaTesterStore,
  UpstashBetaTesterStore,
  hashSecret,
  newInviteSecret,
  newTesterCredential,
} from "../src/betaTester.ts";
import {
  FIELD_VALIDATION_CAMPAIGN_ID,
  FieldValidationError,
  loadStoredRaw,
  MemoryFieldValidationStore,
} from "../src/fieldValidation.ts";
import { analyzeRideCapture } from "../src/rideCapture.ts";
import { BOARDED, betaHarness, DECOY, OPERATOR, TWIN } from "./syntheticBeta.ts";

type Harness = Awaited<ReturnType<typeof betaHarness>>;

async function withHarness(fn: (h: Harness) => Promise<void>, options: Parameters<typeof betaHarness>[0] = {}) {
  const h = await betaHarness(options);
  try {
    await fn(h);
  } finally {
    await h.close();
  }
}

/** A full clean ride for one tester: start, 24 polls, 하차 완료, post-alight window. */
async function cleanRide(h: Harness, credential: string) {
  const started = await h.startRide(credential);
  assert.equal(started.status, 201, started.text);
  const id = started.json.sessionId as string;
  await h.poll(id, 24);
  const finished = await h.call("POST", `/beta/rides/${id}/finish`, { token: credential });
  assert.equal(finished.status, 200, finished.text);
  await h.poll(id, 5);
  const done = await h.call("GET", `/beta/rides/${id}`, { token: credential });
  return { id, started, finished, done };
}

/** Nothing a tester sees may carry a vehicle number, a coordinate, raw content, or internal classification. */
function assertTesterSafe(text: string) {
  for (const vehicle of [BOARDED, DECOY, TWIN]) assert.ok(!text.includes(vehicle), "no vehicle number");
  assert.ok(!/"(latitude|longitude)"\s*:/.test(text), "no coordinate");
  assert.ok(!/"(snapshots|vehicles|markers|report)"\s*:/.test(text), "no raw or report content");
  for (const word of ["CLEAN_GATE", "MATCHER_FIELD", "EXCLUDED", "bucket", "selectionVerdict", "candidateMargin", "campaign", "tst_", OPERATOR]) {
    assert.ok(!text.includes(word), `no ${word}`);
  }
}

/* ============================================================ invites */

test("invite secrets and tester credentials are 256-bit, prefixed and unique", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const secret = newInviteSecret();
    const credential = newTesterCredential();
    assert.match(secret, /^tbi_[A-Za-z0-9_-]{43}$/);
    assert.match(credential, /^tbt_[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(secret.slice(4), "base64url").length, 32);
    assert.ok(!seen.has(secret) && !seen.has(credential));
    seen.add(secret);
    seen.add(credential);
  }
});

test("creating, listing and revoking invites require the operator token", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    for (const token of [undefined, "wrong-token-wrong-token-wrong", credential]) {
      assert.equal((await h.call("POST", "/beta/invites", { token, body: {} })).status, 401);
      assert.equal((await h.call("GET", "/beta/invites", { token })).status, 401);
      assert.equal((await h.call("POST", "/beta/invites/inv_x/revoke", { token })).status, 401);
      assert.equal((await h.call("GET", "/beta/campaign", { token })).status, 401);
    }
  });
});

test("an invite is created with defaults, shown once, and stored only as a digest", async () => {
  await withHarness(async (h) => {
    const created = await h.call("POST", "/beta/invites", {
      token: OPERATOR,
      body: { label: "친구 A" },
      headers: { origin: "https://tapso-api.example" },
    });
    assert.equal(created.status, 201);
    const secret = String(created.json.invitePath).split("#invite=")[1]!;
    assert.match(secret, /^tbi_/);
    assert.equal(created.json.inviteUrl, `https://tapso-api.example/ride-capture/beta.html#invite=${secret}`);
    assert.equal(created.json.maxRides, 10);
    assert.equal(Date.parse(created.json.expiresAt) - Date.parse(created.json.createdAt), 14 * 86_400_000);
    assert.equal(created.json.status, "pending");

    const redeemed = await h.call("POST", "/beta/session", { body: { invite: secret } });
    const credential = redeemed.json.credential as string;
    const stored = JSON.stringify([...h.betaStore.values.entries()]);
    assert.ok(!stored.includes(secret), "invite secret never stored");
    assert.ok(!stored.includes(credential), "tester credential never stored");
    assert.ok(stored.includes(hashSecret(secret)), "only its digest");

    const list = await h.call("GET", "/beta/invites", { token: OPERATOR });
    assert.equal(list.status, 200);
    assert.ok(!list.text.includes(secret) && !list.text.includes("tbi_"), "list never returns a secret");
    assert.ok(!list.text.includes(hashSecret(secret)), "nor its digest");
    assert.ok(!list.text.includes(credential));
    assert.equal(list.json.invites[0].label, "친구 A");
    assert.equal(list.json.invites[0].status, "active");
  }, { allowedOrigins: ["https://tapso-api.example"] });
});

test("an origin outside the allow-list gets no absolute invite URL", async () => {
  await withHarness(async (h) => {
    const created = await h.call("POST", "/beta/invites", { token: OPERATOR, body: {}, headers: { origin: "https://evil.example" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.inviteUrl, undefined);
    assert.match(created.json.invitePath, /^\/ride-capture\/beta\.html#invite=tbi_/);
  });
});

test("invite parameters are bounded", async () => {
  await withHarness(async (h) => {
    for (const body of [{ days: 0 }, { days: 31 }, { maxRides: 0 }, { maxRides: 51 }, { days: 1.5 }, { label: 12 }]) {
      assert.equal((await h.call("POST", "/beta/invites", { token: OPERATOR, body })).status, 400, JSON.stringify(body));
    }
    const long = await h.invite({ label: "x".repeat(200), days: 3, maxRides: 2 });
    assert.equal(long.label.length, 40);
    assert.equal(long.maxRides, 2);
  });
});

test("an invite redeems exactly once; malformed, expired and revoked invites are refused", async () => {
  await withHarness(async (h) => {
    const first = await h.invite();
    assert.equal((await h.call("POST", "/beta/session", { body: { invite: first.secret } })).status, 201);
    const again = await h.call("POST", "/beta/session", { body: { invite: first.secret } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "INVITE_USED");

    for (const invite of [undefined, "", "tbi_short", newInviteSecret(), OPERATOR, newTesterCredential()]) {
      const refused = await h.call("POST", "/beta/session", { body: { invite } });
      assert.equal(refused.status, 401, String(invite));
      assert.equal(refused.json.error, "INVITE_INVALID");
    }

    const revoked = await h.invite();
    assert.equal((await h.call("POST", `/beta/invites/${revoked.inviteId}/revoke`, { token: OPERATOR })).status, 200);
    assert.equal((await h.call("POST", "/beta/session", { body: { invite: revoked.secret } })).json.error, "INVITE_REVOKED");

    const expiring = await h.invite({ days: 1 });
    h.advance(86_400_000);
    assert.equal((await h.call("POST", "/beta/session", { body: { invite: expiring.secret } })).json.error, "INVITE_EXPIRED");
  });
});

test("concurrent redemptions of one invite yield exactly one working credential", async () => {
  await withHarness(async (h) => {
    const created = await h.invite();
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      h.call("POST", "/beta/session", { body: { invite: created.secret } })));
    const winners = results.filter((result) => result.status === 201);
    assert.equal(winners.length, 1);
    assert.equal((await h.call("GET", "/beta/me", { token: winners[0]!.json.credential })).status, 200);
  });
});

test("a beta credential can never act as the operator, and the operator token is not a tester credential", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    const operatorOnly: Array<[string, string, unknown?]> = [
      ["POST", "/capture/start", {}],
      ["GET", `/capture/${id}`],
      ["GET", `/capture/${id}/raw`],
      ["POST", `/capture/${id}/submit`],
      ["POST", `/capture/${id}/marker`, { stopSequence: 4 }],
      ["POST", `/capture/${id}/alight`, {}],
      ["GET", "/field-validation/campaign"],
      ["GET", "/beta/campaign"],
      ["GET", "/beta/invites"],
      ["POST", "/beta/invites", {}],
    ];
    for (const [method, route, body] of operatorOnly) {
      const response = await h.call(method, route, { token: credential, ...(body === undefined ? {} : { body }) });
      assert.equal(response.status, 401, `${method} ${route}`);
    }
    for (const [method, route] of [["GET", "/beta/me"], ["POST", "/beta/rides"], ["GET", `/beta/rides/${id}`], ["POST", `/beta/rides/${id}/finish`]]) {
      const response = await h.call(method!, route!, { token: OPERATOR, ...(method === "POST" ? { body: {} } : {}) });
      assert.equal(response.status, 401, `operator token on ${route}`);
    }
    assert.equal((await h.call("GET", "/beta/me")).status, 401);
    assert.equal((await h.call("GET", "/beta/me", { token: newTesterCredential() })).status, 401);
  });
});

test("revoking an invite cuts its tester off immediately", async () => {
  await withHarness(async (h) => {
    const { credential, inviteId } = await h.tester();
    assert.equal((await h.call("GET", "/beta/me", { token: credential })).status, 200);
    await h.call("POST", `/beta/invites/${inviteId}/revoke`, { token: OPERATOR });
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.status, 401);
    assert.equal(me.json.error, "BETA_REVOKED");
    const list = await h.call("GET", "/beta/invites", { token: OPERATOR });
    assert.equal(list.json.invites[0].status, "revoked");
  });
});

/* ============================================================ ownership */

test("a tester starts, reads, resumes and finishes only their own ride", async () => {
  await withHarness(async (h) => {
    const a = await h.tester();
    const b = await h.tester();
    const started = await h.startRide(a.credential);
    assert.equal(started.status, 201);
    assert.equal(started.json.state, "recording");
    assertTesterSafe(started.text);
    const id = started.json.sessionId as string;

    const own = await h.call("GET", `/beta/rides/${id}`, { token: a.credential });
    assert.equal(own.status, 200);
    assert.equal(own.json.state, "recording");

    // Resume: the server, not the browser, knows the open ride.
    const me = await h.call("GET", "/beta/me", { token: a.credential });
    assert.equal(me.json.activeRide.sessionId, id);
    assert.equal(me.json.activeRide.state, "recording");
    assert.equal(me.json.canStart, false);
    assertTesterSafe(me.text);

    // Tester B cannot read, finish or discover it, and gets what a missing ride gets.
    const peek = await h.call("GET", `/beta/rides/${id}`, { token: b.credential });
    const stop = await h.call("POST", `/beta/rides/${id}/finish`, { token: b.credential });
    const missing = await h.call("GET", `/beta/rides/${crypto.randomUUID()}`, { token: b.credential });
    assert.equal(peek.status, 404);
    assert.equal(stop.status, 404);
    assert.deepEqual(peek.json, missing.json, "foreign and nonexistent are indistinguishable");
    assert.equal((await h.call("GET", "/beta/me", { token: b.credential })).json.activeRide, undefined);
    assert.equal(h.coordinator.status(id).phase, "active", "B's attempt changed nothing");

    for (const guess of ["../capture", "x".repeat(65), "%2e%2e", crypto.randomUUID()]) {
      assert.equal((await h.call("GET", `/beta/rides/${guess}`, { token: a.credential })).status, 404, guess);
    }
    // There is no listing endpoint to enumerate.
    assert.equal((await h.call("GET", "/beta/rides", { token: a.credential })).status, 404);
  });
});

test("tester B cannot cause tester A's ride to be submitted", async () => {
  await withHarness(async (h) => {
    const a = await h.tester();
    const b = await h.tester();
    const started = await h.startRide(a.credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    assert.equal((await h.call("POST", `/beta/rides/${id}/finish`, { token: b.credential })).status, 404);
    await h.poll(id, 5);
    assert.equal(h.coordinator.status(id).phase, "active");
    assert.equal((await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 0);
  });
});

/* ============================================================ ride flow */

test("하차 완료 completes, replays, stores and classifies the ride with nothing else to press", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const { id, finished, done } = await cleanRide(h, credential);
    assert.equal(finished.json.state, "finishing");
    assert.equal(done.status, 200);
    assert.equal(done.json.state, "done");
    assert.equal(done.json.endedAutomatically, undefined);
    assertTesterSafe(finished.text);
    assertTesterSafe(done.text);

    const records = await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(records.length, 1);
    const record = records[0]!;
    assert.equal(record.campaignId, BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(record.matcherCampaign?.bucket, "MATCHER_FIELD_CLEAN");
    assert.equal(record.matcherCampaign?.policyVersion, "beta-matcher-v2");
    assert.equal(record.matcherCampaign?.markerLagSamples, 0, "no physical markers were asked for");
    assert.equal(record.evidenceVerdict, "INSUFFICIENT_EVIDENCE", "the v1 evidence verdict is untouched");

    // The stored record is the CURRENT matcher replayed over the stored raw.
    const raw = await loadStoredRaw(h.fieldValidation, record.id);
    assert.deepEqual(raw, h.coordinator.completedCapture(id));
    const replay = analyzeRideCapture(raw!).matchGate;
    assert.equal(record.selectionVerdict, replay.selectionVerdict);
    assert.equal(record.contestedDecisions, replay.contestedDecisions);
    assert.deepEqual(record.candidateMargin, replay.candidateMargin);

    // Never counted in v1 as well.
    assert.equal((await h.fieldValidation.listCampaign(FIELD_VALIDATION_CAMPAIGN_ID)).length, 0);

    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.activeRide, undefined, "a completed ride is not reopened as active");
    assert.equal(me.json.ridesUsed, 1);
    assert.equal(me.json.canStart, true);

    const summary = await h.call("GET", "/beta/campaign", { token: OPERATOR });
    assert.equal(summary.json.matcherFieldRides.clean, 1);
    assert.equal(summary.json.testers, 1);
    assert.equal(summary.json.gateClosed, false);
    assert.equal(summary.json.automaticMatching, "disabled");
  });
});

test("finishing twice, concurrently, or after completion never double-counts", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    const taps = await Promise.all([1, 2, 3].map(() => h.call("POST", `/beta/rides/${id}/finish`, { token: credential })));
    assert.ok(taps.every((tap) => tap.status === 200));
    await h.poll(id, 5);
    const results = await Promise.all([1, 2, 3].map(() => h.call("POST", `/beta/rides/${id}/finish`, { token: credential })));
    assert.ok(results.every((result) => result.json.state === "done"));
    const again = await h.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    assert.equal(again.json.state, "done");
    assert.equal((await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
    assert.equal(await h.betaStore.countRides((await h.betaStore.getCapture(id))!.testerId), 1);
    const markers = h.coordinator.completedCapture(id).markers.filter((marker) => marker.note === ALIGHT_STOP_UNKNOWN_NOTE);
    assert.equal(markers.length, 1, "one finish marker whatever the number of taps");
  });
});

test("a storage failure keeps the ride recoverable and the retry stores it once", async () => {
  class FlakyStore extends MemoryFieldValidationStore {
    // One for the collector's own attempt at completion, one for the tester's read.
    failures = 2;
    override async putReport(...args: Parameters<MemoryFieldValidationStore["putReport"]>) {
      if (this.failures > 0) {
        this.failures -= 1;
        throw new FieldValidationError("synthetic storage outage");
      }
      return super.putReport(...args);
    }
  }
  const store = new FlakyStore();
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const { id, done } = await cleanRide(h, credential);
    assert.equal(done.json.state, "retry", "the first attempt failed and says so plainly");
    assertTesterSafe(done.text);
    assert.ok(!h.logs.some((line) => line.includes("synthetic storage outage")), "storage error text not logged");

    // Resume after a reload still points at the unfinished ride.
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.activeRide.sessionId, id);

    // [다시 시도] is the same idempotent finish.
    let state = me.json.activeRide.state as string;
    for (let attempt = 0; attempt < 3 && state !== "done"; attempt += 1) {
      state = (await h.call("POST", `/beta/rides/${id}/finish`, { token: credential })).json.state;
    }
    assert.equal(state, "done");
    assert.equal((await store.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
  }, { fieldValidation: store });
});

test("the collector submits a completed beta ride even when the tester never comes back", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    // The operator side (or the 90-minute cap) closes it; no tester request follows.
    h.coordinator.alight(id);
    await h.poll(id, 5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
    const view = await h.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(view.json.state, "done");
    assert.equal(view.json.endedAutomatically, true);
  });
});

test("a collector restart marks the ride lost, hands the ride slot back, and allows a new ride", async () => {
  const betaStore = new MemoryBetaTesterStore();
  const fieldValidation = new MemoryFieldValidationStore();
  let credential = "";
  let id = "";
  await withHarness(async (h) => {
    ({ credential } = await h.tester());
    id = (await h.startRide(credential)).json.sessionId;
  }, { betaStore, fieldValidation });
  await withHarness(async (h) => {
    const view = await h.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(view.json.state, "lost");
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.ridesUsed, 0);
    assert.equal(me.json.canStart, true);
    assert.equal((await h.startRide(credential)).status, 201);
  }, { betaStore, fieldValidation });
});

test("one open ride at a time, and the ride budget is enforced", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester({ maxRides: 1 });
    const first = await h.startRide(credential);
    assert.equal(first.status, 201);
    const second = await h.startRide(credential);
    assert.equal(second.status, 409);
    assert.equal(second.json.error, "BETA_RIDE_IN_PROGRESS");
    const id = first.json.sessionId as string;
    await h.poll(id, 24);
    await h.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    await h.poll(id, 5);
    await h.call("GET", `/beta/rides/${id}`, { token: credential });
    const third = await h.startRide(credential);
    assert.equal(third.status, 403);
    assert.equal(third.json.error, "BETA_RIDE_LIMIT");
    const list = await h.call("GET", "/beta/invites", { token: OPERATOR });
    assert.equal(list.json.invites[0].ridesUsed, 1);
  });
});

test("an expiry during a ride lets the tester finish it, but not start another", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester({ days: 1 });
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    h.advance(86_400_000 - 60_000); // one minute before expiry …
    await h.poll(id, 20);           // … and the ride runs past it
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.status, "expired");
    assert.equal(me.json.activeRide.sessionId, id);
    const finished = await h.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    assert.equal(finished.status, 200);
    await h.poll(id, 5);
    assert.equal((await h.call("GET", `/beta/rides/${id}`, { token: credential })).json.state, "done");
    const again = await h.startRide(credential);
    assert.equal(again.status, 403);
    assert.equal(again.json.error, "BETA_EXPIRED");
    h.advance(5 * 60 * 60 * 1_000);
    assert.equal((await h.call("GET", `/beta/rides/${id}`, { token: credential })).status, 403, "the grace is bounded");
  });
});

test("a ride whose tester is revoked mid-ride is held, not counted", async () => {
  await withHarness(async (h) => {
    const { credential, inviteId } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    await h.call("POST", `/beta/invites/${inviteId}/revoke`, { token: OPERATOR });
    h.coordinator.alight(id);
    await h.poll(id, 5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 0);
    assert.equal((await h.betaStore.getCapture(id))?.state, "held_revoked");
    // The operator can still rescue the raw.
    assert.equal((await h.call("GET", `/capture/${id}/raw`, { token: OPERATOR })).status, 200);
  });
});

test("a bus the provider does not report, or cannot tell apart, is refused before recording", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const missing = await h.startRide(credential, { plateSuffix: "1234" });
    assert.equal(missing.status, 409);
    assert.equal(missing.json.error, "BUS_NOT_FOUND");
    for (const body of [{ plateSuffix: "99" }, { boardingStopSequence: 99 }, { boardingStopSequence: 30 }, { routeId: "../x" }, { destinationStopSequence: 2 }, { routeNo: "<script>" }]) {
      assert.equal((await h.startRide(credential, body)).status, 400, JSON.stringify(body));
    }
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.ridesUsed, 0, "refused starts cost no ride");
  });
});

test("the operator cannot also count a beta ride in v1", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    h.coordinator.alight(id);
    await h.poll(id, 5);
    const submit = await h.call("POST", `/capture/${id}/submit`, { token: OPERATOR });
    assert.equal(submit.status, 409);
    assert.equal(submit.json.error, "BETA_CAPTURE");
    assert.equal((await h.fieldValidation.listCampaign(FIELD_VALIDATION_CAMPAIGN_ID)).length, 0);
  });
});

test("without a destination the capture names no alighting stop; with one it does", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const { id } = await cleanRide(h, credential);
    const raw = h.coordinator.completedCapture(id);
    assert.equal(raw.destinationStopSequence, 30);
    assert.ok(raw.markers.some((marker) => marker.note === DESTINATION_UNKNOWN_NOTE));
    assert.ok(!raw.markers.some((marker) => marker.kind === "alighted"), "no fabricated alighting stop");
    assert.ok(!raw.markers.some((marker) => marker.kind === "passed_stop"), "the tester tapped no markers");

    const next = await h.startRide(credential, { destinationStopSequence: 12 });
    assert.equal(next.status, 201);
    assert.equal(next.json.destinationStopName, "Synthetic 12");
    const nextId = next.json.sessionId as string;
    await h.call("POST", `/beta/rides/${nextId}/finish`, { token: credential });
    const markers = h.coordinator.status(nextId).markerCount;
    assert.equal(markers, 2, "boarded + alighted");
  });
});

test("a client-supplied report or bucket is ignored", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    const id = started.json.sessionId as string;
    await h.poll(id, 24);
    await h.call("POST", `/beta/rides/${id}/finish`, {
      token: credential,
      body: { report: { matchGate: { selectionVerdict: "correct" } }, bucket: "MATCHER_FIELD_CLEAN" },
    });
    await h.poll(id, 5);
    await h.call("GET", `/beta/rides/${id}`, { token: credential });
    const [record] = await h.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(record!.rawSha256.length, 64, "stored from the collector's own raw");
  });
});

test("wrong-bus and never-committed beta rides are stored, surfaced to the operator, and not counted", async () => {
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    h.setKind("wrong");
    const wrong = await cleanRide(h, credential);
    assert.equal(wrong.done.json.state, "done", "the tester just sees 기록 완료");
    assertTesterSafe(wrong.done.text);
    h.setKind("ambiguous");
    const ambiguous = await cleanRide(h, credential);
    assert.equal(ambiguous.done.json.state, "done");

    const summary = (await h.call("GET", "/beta/campaign", { token: OPERATOR })).json;
    assert.equal(summary.matcherFieldRides.clean, 0);
    assert.equal(summary.buckets.MATCHER_FIELD_FAILURE, 1);
    assert.equal(summary.buckets.MATCHER_FIELD_NOT_COUNTED, 1);
    assert.equal(summary.verdictCounts.wrong, 1);
    assert.equal(summary.verdictCounts.never_committed, 1);
    assert.match(summary.alerts[0], /GATE_FAILURE/);
    assert.ok(!JSON.stringify(summary).includes(BOARDED));
  });
});

/* ============================================================ privacy and logs */

test("logs carry no secret, credential or session id; responses carry no credential but the one issued", async () => {
  await withHarness(async (h) => {
    const created = await h.invite();
    const session = await h.call("POST", "/beta/session", { body: { invite: created.secret } });
    const credential = session.json.credential as string;
    assert.deepEqual(Object.keys(session.json).sort(), ["credential", "expiresAt", "maxRides"]);
    const { id } = await cleanRide(h, credential);
    const logs = h.logs.join("\n");
    assert.ok(!logs.includes(created.secret));
    assert.ok(!logs.includes(credential));
    assert.ok(!logs.includes(id));
    assert.ok(!logs.includes(OPERATOR));
    assert.ok(!logs.includes(BOARDED));
    assert.ok(logs.includes('"route":"beta_finish"'));
  });
});

test("the beta store namespace is its own, and key names carry no route, stop or vehicle", async () => {
  const commands: string[][] = [];
  const store = new UpstashBetaTesterStore({
    restUrl: "https://synthetic-upstash.invalid",
    restToken: "synthetic-token",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      const command = JSON.parse(String(init.body)) as string[];
      commands.push(command);
      const result = command[0] === "SET" ? "OK" : command[0] === "SCARD" ? 0 : command[0] === "SMEMBERS" ? [] : null;
      return new Response(JSON.stringify({ result }), { status: 200 });
    }) as typeof fetch,
  });
  await store.putInvite({ id: "inv_a", secretHash: "ab", label: "x", createdAt: "t", expiresAt: "t", maxRides: 1 });
  await store.putCapture({
    sessionId: "s1", testerId: "tst_1", inviteId: "inv_a", createdAt: "t", state: "recording",
    display: { routeNo: "365", boardingStopName: "Synthetic 3" }, updatedAt: "t",
  });
  await store.acquireStartLock("tst_1", 30);
  await store.countRides("tst_1");
  for (const command of commands) {
    assert.ok(command[1]!.startsWith(BETA_TESTER_KEY_PREFIX), command[1]);
    assert.ok(!/365|Synthetic|SYN-/.test(command[1]!), `key name ${command[1]} carries ride data`);
  }
  assert.deepEqual(commands.find((command) => command[1]!.endsWith("start-lock"))?.slice(3), ["NX", "EX", "30"]);
});

test("while storage stays down, the finished ride waits in 다시 시도 and blocks a new ride instead of being abandoned", async () => {
  class DownStore extends MemoryFieldValidationStore {
    override async putReport(): Promise<void> {
      throw new FieldValidationError("synthetic storage outage");
    }
  }
  await withHarness(async (h) => {
    const { credential } = await h.tester();
    const { id, done } = await cleanRide(h, credential);
    assert.equal(done.json.state, "retry");
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.activeRide.sessionId, id);
    assert.equal(me.json.activeRide.state, "retry");
    assert.equal(me.json.canStart, false);
    assert.equal((await h.startRide(credential)).json.error, "BETA_RIDE_IN_PROGRESS");
    // The raw is still with the collector for the operator.
    assert.equal((await h.call("GET", `/capture/${id}/raw`, { token: OPERATOR })).status, 200);
  }, { fieldValidation: new DownStore() });
});

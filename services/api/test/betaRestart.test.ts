/**
 * Collector restart simulation. Two `betaHarness` instances share one clock,
 * one beta store, one field-validation store and one capture journal: process
 * A starts a ride and "dies" (it is simply never called again), process B
 * starts from nothing but the shared durable state, exactly as a redeployed
 * Railway collector would.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { BETA_MATCHER_CAMPAIGN_ID } from "../src/betaCampaign.ts";
import { MemoryBetaTesterStore } from "../src/betaTester.ts";
import { JOURNAL_LEASE_SECONDS, MemoryCaptureJournal } from "../src/captureJournal.ts";
import { canonicalJson, FieldValidationError, loadStoredRaw, MemoryFieldValidationStore } from "../src/fieldValidation.ts";
import { analyzeRideCapture } from "../src/rideCapture.ts";
import { betaHarness, syntheticClock } from "./syntheticBeta.ts";

const LEASE_MS = JOURNAL_LEASE_SECONDS * 1_000;

function shared(fieldValidation = new MemoryFieldValidationStore()) {
  const clock = syntheticClock();
  return {
    clock,
    betaStore: new MemoryBetaTesterStore(),
    fieldValidation,
    journal: new MemoryCaptureJournal(clock.ms),
  };
}

async function processes(state: ReturnType<typeof shared>) {
  const a = await betaHarness({ ...state, instanceId: "collector-A" });
  return {
    a,
    async restart() {
      await a.close();
      return betaHarness({ ...state, instanceId: "collector-B" });
    },
  };
}

test("an active beta ride survives a collector restart: resume, keep collecting, finish, one submission", async () => {
  const state = shared();
  const { a, restart } = await processes(state);
  const { credential } = await a.tester();
  const other = await a.tester();
  const id = (await a.startRide(credential)).json.sessionId as string;
  await a.poll(id, 12);
  assert.equal(a.coordinator.status(id).snapshotCount, 13);
  assert.equal((await state.journal.load(id))!.snapshots.length, 13, "every snapshot is durable");

  // Process A dies mid-ride. Its lease lapses; B comes up with empty memory.
  state.clock.advance(LEASE_MS + 5_000);
  const b = await restart();
  try {
    assert.equal(b.coordinator.owns(id), false, "B starts with nothing in memory");

    // The tester reopens the page: the same ride, still recording.
    const me = await b.call("GET", "/beta/me", { token: credential });
    assert.equal(me.status, 200);
    assert.equal(me.json.activeRide.sessionId, id);
    assert.equal(me.json.activeRide.state, "recording");
    assert.equal(b.coordinator.owns(id), true, "B took the ride over from the journal");
    assert.equal(state.journal.leaseOwner(id), "collector-B");
    assert.equal(b.coordinator.status(id).snapshotCount, 13, "collected evidence survived the restart");

    // Ownership still holds after recovery.
    assert.equal((await b.call("GET", `/beta/rides/${id}`, { token: other.credential })).status, 404);
    assert.equal((await b.call("POST", `/beta/rides/${id}/finish`, { token: other.credential })).status, 404);

    // Collection continues in B, then the tester finishes, twice.
    await b.poll(id, 12);
    await b.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    await b.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    await b.poll(id, 5);
    const done = await b.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(done.json.state, "done");
    await b.beta.recoverAll();
    await b.call("POST", `/beta/rides/${id}/finish`, { token: credential });

    const records = await state.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(records.length, 1, "exactly one submission");
    const raw = (await loadStoredRaw(state.fieldValidation, records[0]!.id))!;
    const times = raw.snapshots.map((snapshot) => snapshot.capturedAt);
    assert.equal(new Set(times).size, times.length, "no duplicate snapshots");
    assert.equal(raw.snapshots.length, 13 + 12 + 4, "the 20 s post-alight window closes on the fourth poll");
    assert.equal(raw.events?.filter((event) => event.kind === "resumed").length, 1, "the restart is on the record");
    assert.equal(analyzeRideCapture(raw).lifecycle.recoveries, 1);
    assert.equal(records[0]!.matcherCampaign?.bucket, "MATCHER_FIELD_CLEAN");
    assert.deepEqual(await state.journal.listOpen(), [], "the journal is closed once the ride is stored");
    assert.equal((await b.call("GET", "/beta/me", { token: credential })).json.ridesUsed, 1);
  } finally {
    await b.close();
  }
});

test("exactly one collector polls after recovery: a zombie that lost its lease writes nothing", async () => {
  const state = shared();
  const a = await betaHarness({ ...state, instanceId: "collector-A" });
  const b = await betaHarness({ ...state, instanceId: "collector-B" });
  try {
    const { credential } = await a.tester();
    const id = (await a.startRide(credential)).json.sessionId as string;
    await a.poll(id, 6);

    // A is alive and holds the lease: B leaves the ride alone.
    assert.deepEqual(await b.beta.recoverAll(), { restored: 0, skipped: 1, closed: 0 });
    assert.equal(b.coordinator.owns(id), false);
    const peek = await b.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(peek.json.state, "recording", "the ride is honestly still recording, in A");

    // A stalls past its lease (e.g. a redeploy overlap); B takes over.
    state.clock.advance(LEASE_MS + 1_000);
    assert.deepEqual(await b.beta.recoverAll(), { restored: 1, skipped: 0, closed: 0 });
    assert.equal(state.journal.leaseOwner(id), "collector-B");
    const durable = (await state.journal.load(id))!.snapshots.length;

    // A wakes up and polls: fenced, detached, nothing appended.
    await a.coordinator.pollNow(id).catch(() => undefined);
    assert.equal(a.coordinator.owns(id), false, "the zombie stopped");
    assert.equal((await state.journal.load(id))!.snapshots.length, durable, "the zombie wrote nothing");

    await b.poll(id, 3);
    const snapshots = (await state.journal.load(id))!.snapshots.map((snapshot) => snapshot.capturedAt);
    assert.equal(new Set(snapshots).size, snapshots.length);
  } finally {
    await a.close();
    await b.close();
  }
});

test("a restart after 하차 완료 still completes the ride once, with one finish marker", async () => {
  const state = shared();
  const { a, restart } = await processes(state);
  const { credential } = await a.tester();
  const id = (await a.startRide(credential)).json.sessionId as string;
  await a.poll(id, 24);
  assert.equal((await a.call("POST", `/beta/rides/${id}/finish`, { token: credential })).json.state, "finishing");
  state.clock.advance(LEASE_MS + 1_000);
  const b = await restart();
  try {
    await b.beta.recoverAll(); // the post-alight window has passed: B completes and submits
    const view = await b.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(view.json.state, "done");
    const records = await state.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(records.length, 1);
    const raw = (await loadStoredRaw(state.fieldValidation, records[0]!.id))!;
    assert.equal(raw.markers.filter((marker) => marker.note?.startsWith("rider finished")).length, 1);
    assert.equal((await b.call("POST", `/beta/rides/${id}/finish`, { token: credential })).json.state, "done");
    assert.equal((await state.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
  } finally {
    await b.close();
  }
});

test("a restart after completion but before storage submits the identical raw exactly once", async () => {
  class Switchable extends MemoryFieldValidationStore {
    down = true;
    override async putReport(...args: Parameters<MemoryFieldValidationStore["putReport"]>) {
      if (this.down) throw new FieldValidationError("synthetic storage outage");
      return super.putReport(...args);
    }
  }
  const store = new Switchable();
  const state = shared(store);
  const { a, restart } = await processes(state);
  const { credential } = await a.tester();
  const id = (await a.startRide(credential)).json.sessionId as string;
  await a.poll(id, 24);
  await a.call("POST", `/beta/rides/${id}/finish`, { token: credential });
  await a.poll(id, 5);
  assert.equal((await a.call("GET", `/beta/rides/${id}`, { token: credential })).json.state, "retry");
  const finishedInA = canonicalJson(a.coordinator.completedCapture(id));

  store.down = false;
  // A dies; nothing renews a completed ride's lease, so it lapses.
  state.clock.advance(LEASE_MS + 1_000);
  const b = await restart();
  try {
    const me = await b.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.activeRide.state, "done", "B restored the completed capture and stored it");
    const records = await store.listCampaign(BETA_MATCHER_CAMPAIGN_ID);
    assert.equal(records.length, 1);
    const stored = (await loadStoredRaw(store, records[0]!.id))!;
    assert.equal(canonicalJson(stored), finishedInA, "byte-identical to what A finished: no resumed event, no new snapshot");
    await b.beta.recoverAll();
    assert.equal((await store.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
  } finally {
    await b.close();
  }
});

test("a restart after a ride exceeded the 90-minute cap closes it at recovery instead of polling on", async () => {
  const state = shared();
  const { a, restart } = await processes(state);
  const { credential } = await a.tester();
  const id = (await a.startRide(credential)).json.sessionId as string;
  await a.poll(id, 24);
  state.clock.advance(91 * 60 * 1_000);
  const b = await restart();
  try {
    await b.beta.recoverAll();
    const view = await b.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(view.json.state, "done");
    assert.equal(view.json.endedAutomatically, true);
    assert.equal(b.provider.calls, 0, "no provider read for a ride already over");
  } finally {
    await b.close();
  }
});

test("operator rides are never journaled", async () => {
  const state = shared();
  const a = await betaHarness({ ...state, instanceId: "collector-A" });
  try {
    const started = await a.call("POST", "/capture/start", {
      token: "synthetic-operator-token-0123456789",
      body: { routeId: "SYN-BETA-ROUTE", cityCode: "999", boardedVehicleId: "제주79자9999", boardingStopSequence: 3, destinationStopSequence: 10 },
    });
    assert.equal(started.status, 201);
    await a.poll(started.json.sessionId, 3);
    assert.deepEqual(await state.journal.listOpen(), []);
    assert.equal(state.journal.lists.size, 0);
  } finally {
    await a.close();
  }
});

test("the Upstash journal fences every write in one script and keys only by session id", async () => {
  const { UpstashCaptureJournal } = await import("../src/captureJournal.ts");
  const commands: string[][] = [];
  const journal = new UpstashCaptureJournal({
    restUrl: "https://synthetic-upstash.invalid",
    restToken: "synthetic-token",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      const command = JSON.parse(String(init.body)) as string[];
      commands.push(command);
      const result = command[0] === "SET" ? "OK" : command[0] === "EVAL" ? 1 : command[0] === "SMEMBERS" ? [] : null;
      return new Response(JSON.stringify({ result }), { status: 200 });
    }) as typeof fetch,
  }, "tapso:beta-tester:v1:");
  const header = { capture: { routeId: "SYN-ROUTE", startedAt: "t" } as never, mode: "field" as const, destinationKnown: false };
  await journal.begin("sess-1", "collector-A", header, { state: { phase: "active" }, snapshots: [{ capturedAt: "t", vehicles: [] }], markers: [], events: [] });
  assert.equal(await journal.append("sess-1", "collector-A", "snapshots", { capturedAt: "t2", vehicles: [] }), true);
  assert.equal(await journal.setState("sess-1", "collector-A", { phase: "completed", endedAt: "t3" }), true);
  const evals = commands.filter((command) => command[0] === "EVAL");
  assert.equal(evals.length, 2);
  for (const command of evals) {
    assert.match(command[1]!, /redis\.call\('GET', KEYS\[1\]\)/);
    assert.equal(command[3], "tapso:beta-tester:v1:journal:sess-1:lease");
    assert.equal(command[5], "collector-A");
  }
  assert.deepEqual(commands[0], ["SET", "tapso:beta-tester:v1:journal:sess-1:lease", "collector-A", "NX", "EX", "30"]);
  for (const command of commands) {
    const keys = command[0] === "EVAL" ? command.slice(3, 5) : [command[1]!];
    for (const key of keys) {
      assert.ok(key.startsWith("tapso:beta-tester:v1:"), key);
      assert.ok(!key.includes("SYN-ROUTE"), `key ${key} carries ride data`);
    }
  }
  await journal.close("sess-1");
  assert.deepEqual(commands.at(-2), ["SREM", "tapso:beta-tester:v1:journals:open", "sess-1"]);
});

test("a ride that cannot be journaled does not start, and costs no ride", async () => {
  class DownJournal extends MemoryCaptureJournal {
    override async begin(): Promise<void> {
      throw new Error("synthetic journal outage");
    }
  }
  const clock = syntheticClock();
  const h = await betaHarness({ clock, journal: new DownJournal(clock.ms) });
  try {
    const { credential } = await h.tester();
    const started = await h.startRide(credential);
    assert.equal(started.status, 503);
    const me = await h.call("GET", "/beta/me", { token: credential });
    assert.equal(me.json.ridesUsed, 0);
    assert.equal(me.json.activeRide, undefined);
    assert.equal(me.json.canStart, true);
  } finally {
    await h.close();
  }
});

test("하차 완료 during a restart overlap is not dropped: the collector that owns the ride applies it", async () => {
  const state = shared();
  const a = await betaHarness({ ...state, instanceId: "collector-A" });
  const b = await betaHarness({ ...state, instanceId: "collector-B" });
  try {
    const { credential } = await a.tester();
    const id = (await a.startRide(credential)).json.sessionId as string;
    await a.poll(id, 24);
    // The tester's request lands on B while A still holds the ride.
    const tapped = await b.call("POST", `/beta/rides/${id}/finish`, { token: credential });
    assert.equal(tapped.status, 200);
    assert.equal(tapped.json.state, "finishing");
    assert.equal(b.coordinator.owns(id), false);
    // A (the owner) sees the request on its next read and alights.
    await a.call("GET", `/beta/rides/${id}`, { token: credential });
    assert.equal(a.coordinator.status(id).phase, "post_alight");
    await a.poll(id, 5);
    assert.equal((await b.call("GET", `/beta/rides/${id}`, { token: credential })).json.state, "done");
    assert.equal((await state.fieldValidation.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 1);
  } finally {
    await a.close();
    await b.close();
  }
});

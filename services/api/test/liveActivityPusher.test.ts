/**
 * Milestone 4 end to end inside the server: a confirmed ride with a registered
 * token is pushed on change, each milestone alerts once, a rejected token is
 * forgotten, a slow APNs cannot hold up the rider, and ending the ride sends
 * `end`. SYNTHETIC route, buses and token; the sender is a fake.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ApnsOutcome, LiveActivityPush } from "../src/apns.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { LiveActivityPusher } from "../src/liveActivityPusher.ts";
import type { TransitProvider } from "../src/provider.ts";

const routeId = "SYN-ROUTE-LA";
const stops: StopOnRoute[] = Array.from({ length: 12 }, (_, index) => ({ stopId: `S${index + 1}`, name: `합성 정류장 ${index + 1}`, sequence: index + 1 }));
const TOKEN = "ab".repeat(32);

class Provider implements TransitProvider {
  sequence = 2;
  at = new Date(0);
  async stops(_request: RouteRequest): Promise<StopOnRoute[]> { return stops.map((stop) => ({ ...stop })); }
  async vehicles(_request: RouteRequest): Promise<VehicleObservation[]> {
    return [{ vehicleId: "SYN70가0001", routeId, observedAt: new Date(0).toISOString(), receivedAt: this.at.toISOString(), timestampSource: "unavailable", stopSequence: this.sequence }];
  }
}

class Sender {
  sent: LiveActivityPush[] = [];
  answer: ApnsOutcome = { kind: "delivered" };
  delayMs = 0;
  async send(push: LiveActivityPush): Promise<ApnsOutcome> {
    this.sent.push(push);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.answer;
  }
}

async function ride() {
  const provider = new Provider();
  let now = new Date("2026-10-02T06:00:00.000Z");
  provider.at = now;
  const sessions = new JourneySessionCoordinator(provider, { now: () => now, idFactory: () => "syn-la" });
  const sender = new Sender();
  const logs: Array<Record<string, unknown>> = [];
  const pusher = new LiveActivityPusher(sender, sessions, { now: () => now.getTime(), log: (entry) => logs.push(entry), budgetMs: 50 });
  await sessions.create({ routeId, cityCode: "999", boardingStopSequence: 3, destinationStopSequence: 9 });
  const step = async (sequence: number) => {
    now = new Date(now.getTime() + 10_000);
    provider.at = now;
    provider.sequence = sequence;
    const view = await sessions.refresh("syn-la");
    await pusher.afterRead(view);
    return view;
  };
  return { sessions, sender, pusher, logs, step, confirm: async () => {
    now = new Date(now.getTime() + 10_000);
    provider.at = now;
    provider.sequence = 3;
    const view = await sessions.confirm("syn-la", { vehicleId: "SYN70가0001" });
    await pusher.afterRead(view);
  } };
}

test("nothing is pushed without a registered token or before the rider confirms", async () => {
  const { sessions, sender, step, confirm } = await ride();
  await step(2);
  await sessions.registerLiveActivityToken("syn-la", { pushToken: TOKEN });
  await step(2);
  assert.equal(sender.sent.length, 0, "no confirmed bus");
  await confirm();
  for (const sequence of [4, 5]) await step(sequence);
  assert.ok(sender.sent.length >= 1);
  assert.ok(sender.sent.every((push) => push.token === TOKEN && push.event === "update"));
});

test("each milestone alerts once, in order, and the record survives a token rotation", async () => {
  const { sessions, sender, step, confirm } = await ride();
  await sessions.registerLiveActivityToken("syn-la", { pushToken: TOKEN });
  await confirm();
  for (const sequence of [4, 5, 6, 7]) await step(sequence);
  await sessions.registerLiveActivityToken("syn-la", { pushToken: "cd".repeat(32) });
  for (const sequence of [7, 8, 9, 9]) await step(sequence);
  const alerts = sender.sent.filter((push) => push.alert).map((push) => push.alert!.title);
  assert.deepEqual(alerts, ["2정거장 남았어요", "다음에 내려요", "여기서 내려요"]);
  const timestamps = sender.sent.map((push) => push.timestampMs);
  assert.deepEqual(timestamps, [...timestamps].sort((left, right) => left - right), "never older than the last");
  assert.equal(new Set(timestamps).size, timestamps.length);
});

test("a token APNs rejects is forgotten; a rotated one is not", async () => {
  const { sessions, sender, step, confirm } = await ride();
  await sessions.registerLiveActivityToken("syn-la", { pushToken: TOKEN });
  await confirm();
  sender.answer = { kind: "token_rejected", reason: "BadDeviceToken", dropToken: true };
  await step(4);
  assert.equal(await sessions.liveActivityTarget("syn-la"), undefined);
  const before = sender.sent.length;
  await step(5);
  assert.equal(sender.sent.length, before, "no token, no push");
});

test("a slow APNs cannot hold up the rider's read, and a failed push is retried on the next read", async () => {
  const { sessions, sender, step, confirm, logs } = await ride();
  await sessions.registerLiveActivityToken("syn-la", { pushToken: TOKEN });
  await confirm();
  sender.delayMs = 500;
  const started = Date.now();
  await step(4);
  assert.ok(Date.now() - started < 400, "the 50 ms budget ends the wait");
  assert.ok(logs.some((entry) => entry.event === "live_activity_push_skipped" && entry.reason === "PushBudgetExceeded"));
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
  sender.delayMs = 0;
  sender.answer = { kind: "unavailable", reason: "network" };
  await step(5);
  const unrecorded = (await sessions.liveActivityTarget("syn-la"))!.delivery;
  sender.answer = { kind: "delivered" };
  await step(5);
  const recorded = (await sessions.liveActivityTarget("syn-la"))!.delivery;
  assert.ok(recorded && (!unrecorded || recorded.lastTimestampMs > unrecorded.lastTimestampMs));
});

test("ending the ride ends the activity, then the row and its token are gone", async () => {
  const { sessions, sender, pusher, confirm } = await ride();
  await sessions.registerLiveActivityToken("syn-la", { pushToken: TOKEN });
  await confirm();
  await pusher.beforeEnd("syn-la");
  await sessions.end("syn-la");
  const end = sender.sent.at(-1)!;
  assert.equal(end.event, "end");
  assert.equal(end.contentState.phase, "completed");
  await pusher.beforeEnd("syn-la");
  assert.equal(sender.sent.at(-1), end, "an ended session has no token to push to");
});

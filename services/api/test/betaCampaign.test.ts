import test from "node:test";
import assert from "node:assert/strict";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { BackgroundRideCaptureCoordinator } from "../src/backgroundRideCapture.ts";
import {
  BETA_EXCLUDED_EVIDENCE,
  BETA_MATCHER_CAMPAIGN_ID,
  BETA_REQUIRED_EVIDENCE,
  classifyBetaMatcherRide,
  summarizeBetaCampaign,
} from "../src/betaCampaign.ts";
import {
  FIELD_VALIDATION_CAMPAIGN_ID,
  MemoryFieldValidationStore,
  submitCompletedCapture,
  type FieldRideSubmission,
} from "../src/fieldValidation.ts";
import { classifyReplayedRide, GATE_BOARDINGS_REQUIRED } from "../src/rideCampaign.ts";
import { analyzeRideCapture, type RideCapture } from "../src/rideCapture.ts";
import { BOARDED, BOARDING, CITY, ROUTE, syntheticProvider, type BetaRideKind } from "./syntheticBeta.ts";

/** A completed raw capture recorded the beta way: no physical markers, no destination. */
async function betaRaw(kind: BetaRideKind, polls: number): Promise<RideCapture> {
  let nowMs = Date.parse("2026-09-23T09:00:00.000Z");
  const now = () => new Date(nowMs);
  const provider = syntheticProvider(now, () => kind);
  const coordinator = new BackgroundRideCaptureCoordinator(provider, {
    now,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });
  const started = await coordinator.start({
    routeId: ROUTE,
    cityCode: CITY,
    boardedVehicleId: BOARDED,
    boardingStopSequence: BOARDING,
    destinationStopSequence: 30,
    destinationKnown: false,
  });
  for (let index = 0; index < polls; index += 1) {
    nowMs += 5_000;
    await coordinator.pollNow(started.sessionId);
  }
  coordinator.alight(started.sessionId);
  for (let index = 0; index < 5; index += 1) {
    nowMs += 5_000;
    await coordinator.pollNow(started.sessionId);
  }
  return coordinator.completedCapture(started.sessionId);
}

test("marker lag is a calibration criterion: a clean beta ride without markers counts under v2 only", async () => {
  const raw = await betaRaw("clean", 24);
  assert.equal(raw.markers.filter((marker) => marker.kind === "passed_stop").length, 0);
  const report = analyzeRideCapture(raw);
  // The v1 evidence verdict is computed exactly as before and still says so.
  assert.equal(report.evidenceCompleteness.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(report.evidenceCompleteness.unmetRequired, ["markerLagSamples"]);
  const beta = classifyBetaMatcherRide(report);
  assert.equal(beta.bucket, "MATCHER_FIELD_CLEAN");
  assert.equal(beta.markerLagSamples, 0);
  assert.equal(beta.groundTruth, "tester_confirmed_vehicle_server_verified_at_start");
  assert.ok(!beta.criteria.some((criterion) => (BETA_EXCLUDED_EVIDENCE as readonly string[]).includes(criterion.name)));
  for (const name of BETA_REQUIRED_EVIDENCE) {
    assert.ok(beta.criteria.find((criterion) => criterion.name === name)?.met, name);
  }
});

test("v2 is stricter than v1 on sample size: a short ride v1 would count does not count in v2", async () => {
  const report = analyzeRideCapture(await betaRaw("clean", 6));
  const v1 = classifyReplayedRide("short", report);
  assert.equal(v1.bucket, "CLEAN_GATE_CANDIDATE", "v1 is unchanged and reads no evidence verdict");
  const beta = classifyBetaMatcherRide(report);
  assert.equal(beta.bucket, "MATCHER_FIELD_NOT_COUNTED");
  assert.ok(beta.reasons.includes("evidence criterion successfulSnapshots not met"));
});

test("a never-committed ride is safe but not counted; a wrong first commit is a surfaced failure", async () => {
  const never = classifyBetaMatcherRide(analyzeRideCapture(await betaRaw("ambiguous", 24)));
  assert.equal(never.bucket, "MATCHER_FIELD_NOT_COUNTED");
  assert.match(never.reasons.join(" "), /never committed/);

  const wrong = classifyBetaMatcherRide(analyzeRideCapture(await betaRaw("wrong", 24)));
  assert.equal(wrong.bucket, "MATCHER_FIELD_FAILURE");
  assert.deepEqual(wrong.reasons, ["GATE_FAILURE: first commit was not the boarded vehicle"]);
});

test("only a Railway background capture can count", async () => {
  const raw = await betaRaw("clean", 24);
  const report = analyzeRideCapture({ ...raw, captureEngine: "local-device" });
  const beta = classifyBetaMatcherRide(report);
  assert.equal(beta.bucket, "MATCHER_FIELD_NOT_COUNTED");
  assert.match(beta.reasons[0]!, /Railway background collector/);
});

test("the two campaigns never mix", async () => {
  const raw = await betaRaw("clean", 24);
  const store = new MemoryFieldValidationStore();
  assert.notEqual(BETA_MATCHER_CAMPAIGN_ID, FIELD_VALIDATION_CAMPAIGN_ID);
  assert.equal(FIELD_VALIDATION_CAMPAIGN_ID, "broad-real-mode-30-boardings-v1");
  await assert.rejects(submitCompletedCapture(raw, undefined, { store, campaignId: FIELD_VALIDATION_CAMPAIGN_ID, betaMatcher: { testerId: "tst_x" } }));
  await assert.rejects(submitCompletedCapture(raw, undefined, { store, campaignId: BETA_MATCHER_CAMPAIGN_ID }));

  // Already counted in v1: the same bytes cannot also be counted in beta.
  const v1 = await submitCompletedCapture(raw, undefined, { store, campaignId: FIELD_VALIDATION_CAMPAIGN_ID });
  assert.equal(v1.matcherCampaign, undefined, "v1 records carry no beta block");
  await assert.rejects(
    submitCompletedCapture(raw, undefined, { store, campaignId: BETA_MATCHER_CAMPAIGN_ID, betaMatcher: { testerId: "tst_x" } }),
    /another campaign/,
  );
  assert.equal((await store.listCampaign(BETA_MATCHER_CAMPAIGN_ID)).length, 0);
});

function record(index: number, patch: Partial<FieldRideSubmission> = {}): FieldRideSubmission {
  return {
    schemaVersion: 1,
    id: `sub-${index}`,
    campaignId: BETA_MATCHER_CAMPAIGN_ID,
    routeId: `R${index % 7}`,
    cityCode: "999",
    startedAt: new Date(Date.UTC(2026, 8, 23, 9, index)).toISOString(),
    captureEngine: "railway-background",
    rawObjectKey: `raw:sub-${index}`,
    rawSha256: "0".repeat(64),
    reportSha256: "0".repeat(64),
    rawBytes: 1,
    snapshotCount: 30,
    evidenceVerdict: "INSUFFICIENT_EVIDENCE",
    usableForGate: true,
    selectionVerdict: "correct",
    contestedDecisions: index % 3 === 0 ? 2 : 0,
    candidateMargin: { count: 0 },
    boardedDirectionChanges: 0,
    selectionsWhileNotFresh: 0,
    boardedCadenceStates: {},
    bucket: "CLEAN_GATE_CANDIDATE",
    policy: "DECIDED",
    reasons: [],
    analyzerSchemaVersion: 1,
    submittedAt: new Date(Date.UTC(2026, 8, 23, 10, index)).toISOString(),
    matcherCampaign: {
      policyVersion: "beta-matcher-v2",
      bucket: "MATCHER_FIELD_CLEAN",
      reasons: [],
      criteria: [],
      groundTruth: "tester_confirmed_vehicle_server_verified_at_start",
      markerLagSamples: 0,
      testerId: `tst_${index % 5}`,
    },
    ...patch,
  } as FieldRideSubmission;
}

test("thirty clean beta rides fill the matcher field sample and close nothing", () => {
  const records = Array.from({ length: GATE_BOARDINGS_REQUIRED }, (_, index) => record(index));
  const summary = summarizeBetaCampaign(BETA_MATCHER_CAMPAIGN_ID, records);
  assert.deepEqual(summary.matcherFieldRides, { clean: 30, target: 30, remaining: 0 });
  assert.equal(summary.gateClosed, false);
  assert.equal(summary.automaticMatching, "disabled");
  assert.equal(summary.providerCadenceCalibration, "SEPARATE_REQUIREMENT_NOT_ADDRESSED_BY_BETA_RIDES");
  assert.match(summary.note, /does NOT close the gate/);
  assert.equal(summary.testers, 5);
  assert.equal(summary.routes, 7);
  assert.equal(summary.ridesWithContestedDecisions, 10);
  // And the live API default is untouched by any of this.
  assert.equal(readTransitApiConfig({}).matching.automaticMatchingEnabled, false);
});

test("a record in the beta set without a v2 classification is flagged, never counted", () => {
  const stray = record(1);
  delete stray.matcherCampaign;
  const summary = summarizeBetaCampaign(BETA_MATCHER_CAMPAIGN_ID, [stray, record(2)]);
  assert.equal(summary.matcherFieldRides.clean, 1);
  assert.match(summary.alerts.join(" "), /no beta-matcher-v2 classification/);
});

test("gate failures lead the alerts", () => {
  const summary = summarizeBetaCampaign(BETA_MATCHER_CAMPAIGN_ID, [
    record(1),
    record(2, {
      selectionVerdict: "wrong",
      matcherCampaign: { ...record(2).matcherCampaign!, bucket: "MATCHER_FIELD_FAILURE" },
    }),
    record(3, { selectionsWhileNotFresh: 1 }),
  ]);
  assert.match(summary.alerts[0]!, /FAIL_CLOSED_BUG/);
  assert.match(summary.alerts[1]!, /GATE_FAILURE: 1 ride\(s\) committed to the wrong bus/);
  assert.equal(summary.buckets.MATCHER_FIELD_FAILURE, 1);
});

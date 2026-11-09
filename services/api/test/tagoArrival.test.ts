/**
 * TAGO arrival prediction parser. Payloads are SYNTHETIC, shaped after the
 * contract read on 2026-11-08 (data.go.kr 15098530); the sample values the
 * page itself shows (북대전농협, DJB30300002, 816 s) are reused where noted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ARRIVAL_ENDPOINT, chooseArrivalProbeTargets, parseArrivalResponse, predictionAgreesWithPositions, predictionOffsetStops, type ArrivalProbeCandidate } from "../src/tagoArrival.ts";

const envelope = (items: unknown, totalCount = 1, resultCode = "00") => ({
  response: { header: { resultCode, resultMsg: "OK" }, body: { items, numOfRows: 10, pageNo: 1, totalCount } },
});

// The documented sample row (contract page), as a single object.
const sample = { nodeid: "DJB8001793", nodenm: "북대전농협", routeid: "DJB30300002", routeno: 5, routetp: "마을버스", arrprevstationcnt: 15, vehicletp: "저상버스", arrtime: 816 };

test("the documented sample parses; it carries no vehicle and no computation time", () => {
  const parsed = parseArrivalResponse(envelope({ item: sample }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    stopId: "DJB8001793", stopName: "북대전농협", routeId: "DJB30300002", routeNo: "5", routeType: "마을버스",
    stopsAway: 15, vehicleType: "저상버스", providerEstimateSeconds: 816, label: "PROVIDER_ESTIMATE", vehicle: null, computedAt: null,
  });
  assert.match(ARRIVAL_ENDPOINT, /^https:\/\/apis\.data\.go\.kr\/1613000\/ArvlInfoInqireService\/getSttnAcctoArvlPrearngeInfoList$/);
});

test("an empty answer ('' items) is zero rows, not an error", () => {
  const parsed = parseArrivalResponse(envelope("", 0));
  assert.deepEqual(parsed, { ok: true, totalCount: 0, rows: [], rejected: [] });
});

test("a provider error code fails closed", () => {
  const parsed = parseArrivalResponse(envelope("", 0, "30"));
  assert.equal(parsed.ok, false);
  assert.equal(parseArrivalResponse({}).ok, false);
  assert.equal(parseArrivalResponse(envelope("", -1)).ok, false);
});

test("a row it cannot read is rejected with a reason, never repaired", () => {
  const parsed = parseArrivalResponse(envelope({ item: [sample, { ...sample, arrtime: "soon" }, { ...sample, routeid: "" }, { ...sample, arrprevstationcnt: -1 }] }, 4));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rejected.map((entry) => entry.index), [1, 2, 3]);
});

test("cross-check with positions: agreement is consistency between two provider services, not correctness", () => {
  assert.equal(predictionAgreesWithPositions({ stopsAway: 3 }, 20, [17, 9]), "consistent");
  assert.equal(predictionAgreesWithPositions({ stopsAway: 3 }, 20, [18]), "inconsistent");
  assert.equal(predictionAgreesWithPositions({ stopsAway: 3 }, 20, []), "no_positions");
});

// SYNTHETIC variants: invented route IDs and stop IDs.
const variant = (routeId: string, routeNo: string, stopCount: number, vehicleSequences: number[]): ArrivalProbeCandidate => ({
  routeId,
  routeNo,
  stops: Array.from({ length: stopCount }, (_, index) => ({ stopId: `${routeId}-S${index + 1}`, name: `합성정류장${index + 1}`, sequence: index + 1 })),
  vehicleSequences,
});

test("probe targets sit just ahead of a reported bus, so a prediction for that variant is expected", () => {
  const targets = chooseArrivalProbeTargets([variant("SYN-A", "999", 30, [10, 4])]);
  // The bus with the most room ahead (sequence 4) is used: stops 2 and 5 ahead of it.
  assert.deepEqual(targets.map((target) => [target.routeId, target.stopSequence, target.vehicleSequence]), [["SYN-A", 6, 4], ["SYN-A", 9, 4]]);
  assert.equal(targets[0]!.stopId, "SYN-A-S6");
});

test("variants with no reported bus are not probed; none running gives no targets rather than empty probes", () => {
  assert.deepEqual(chooseArrivalProbeTargets([variant("SYN-A", "999", 30, []), variant("SYN-B", "999", 30, [])]), []);
  const targets = chooseArrivalProbeTargets([variant("SYN-A", "999", 30, []), variant("SYN-B", "998", 30, [3])]);
  assert.deepEqual([...new Set(targets.map((target) => target.routeId))], ["SYN-B"]);
});

test("a target never wraps past the last stop, and bad sequences are ignored", () => {
  const nearEnd = chooseArrivalProbeTargets([variant("SYN-A", "999", 12, [9])]);
  assert.deepEqual(nearEnd.map((target) => target.stopSequence), [11], "seq 9 + 5 = 14 is past the end and dropped");
  assert.deepEqual(chooseArrivalProbeTargets([variant("SYN-A", "999", 12, [0, -1, 1.5, 99, Number.NaN])]), []);
});

test("the sample is bounded: at most two variants per route number and six targets overall", () => {
  const many = ["1", "2", "3", "4"].map((suffix) => variant(`SYN-${suffix}`, "999", 40, [1]));
  const sameNumber = chooseArrivalProbeTargets(many);
  assert.deepEqual([...new Set(sameNumber.map((target) => target.routeId))], ["SYN-1", "SYN-2"]);

  const spread = chooseArrivalProbeTargets(["1", "2", "3", "4", "5"].map((suffix) => variant(`SYN-${suffix}`, `99${suffix}`, 40, [1])));
  assert.equal(spread.length, 6);
});

test("the sample spreads across route numbers before taking a second variant of any", () => {
  const targets = chooseArrivalProbeTargets([
    variant("SYN-A1", "999", 40, [1]),
    variant("SYN-A2", "999", 40, [1]),
    variant("SYN-B1", "998", 40, [1]),
    variant("SYN-C1", "997", 40, [1]),
  ]);
  assert.deepEqual([...new Set(targets.map((target) => target.routeId))], ["SYN-A1", "SYN-B1", "SYN-C1"]);
});

test("the offset says by how many stops a prediction differs from the nearest consistent bus behind the stop", () => {
  // Stop at sequence 12; buses at 10 and 3. A prediction of 3 stops is one more than the bus at 10 implies.
  assert.equal(predictionOffsetStops({ stopsAway: 3 }, 12, [10, 3]), 1);
  assert.equal(predictionOffsetStops({ stopsAway: 2 }, 12, [10, 3]), 0);
  assert.equal(predictionOffsetStops({ stopsAway: 1 }, 12, [10]), -1);
  // A bus at or past the stop cannot be the predicted one; none behind it gives no offset.
  assert.equal(predictionOffsetStops({ stopsAway: 2 }, 12, [12, 14]), null);
  assert.equal(predictionOffsetStops({ stopsAway: 2 }, 12, []), null);
});

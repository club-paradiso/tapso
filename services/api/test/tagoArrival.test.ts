/**
 * TAGO arrival prediction parser. Payloads are SYNTHETIC, shaped after the
 * contract read on 2026-11-08 (data.go.kr 15098530); the sample values the
 * page itself shows (북대전농협, DJB30300002, 816 s) are reused where noted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ARRIVAL_ENDPOINT, parseArrivalResponse, predictionAgreesWithPositions } from "../src/tagoArrival.ts";

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

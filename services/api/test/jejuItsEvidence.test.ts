import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeJejuIts, summarizeJejuIts } from "../../../scripts/data-sources/jeju-its-evidence.ts";

// SYNTHETIC: shaped after the documentation, never fetched from an API.
const row = { link_id: "0000000100", prcn_dt: "20261111000500", tfvl: "0", sped: 21, ocpy_rate: "3.5", trvl_hh: 90 };
const envelope = (...rows: unknown[]) => ({ result: "success", info_cnt: rows.length, Info: rows });

test("Jeju ITS normalizes units and KST without promoting processing time to observation", () => {
  const payload = envelope(row);
  assert.deepEqual(normalizeJejuIts(payload, "realtime").rows, [{
    linkId: "0000000100", sourceTimestamp: "2026-11-10T15:05:00.000Z",
    vehicleCount: 0, averageSpeedKmh: 21, occupancyPercent: 3.5, travelTimeSeconds: 90,
  }]);
  const summary = summarizeJejuIts(payload, "realtime");
  assert.equal(summary.status, "SCHEMA_VALID");
  assert.equal(summary.timestampKind, "processing_time");
  assert.equal(summary.sourceObservedAt, null);
  assert.equal(summary.sourceFetchedAt, null);
});

test("Jeju ITS hourly statistics use a KST hour bucket", () => {
  const bucket = { ...row, stat_dt: "20261111030000" };
  const fetchedAt = "2026-11-11T08:00:00.000Z";
  const summary = summarizeJejuIts(envelope(bucket), "hourly", fetchedAt);
  assert.equal(summary.timestampKind, "hourly_bucket");
  assert.equal(summary.lastSourceTimestamp, "2026-11-10T18:00:00.000Z");
  assert.equal(summary.sourceFetchedAt, fetchedAt);
  assert.equal(summary.sourceObservedAt, null);
  assert.throws(() => normalizeJejuIts(envelope({ ...bucket, stat_dt: "20261111033000" }), "hourly"), /row/);
  assert.throws(() => normalizeJejuIts(envelope(row), "hourly"), /row/);
});

test("Jeju ITS rejects error envelopes, mismatched counts, and malformed rows", () => {
  assert.throws(() => normalizeJejuIts({ result: "error", info_cnt: 0, Info: [] }, "realtime"), /envelope/);
  assert.throws(() => normalizeJejuIts({ ...envelope(row), info_cnt: 0 }, "realtime"), /count/);
  for (const invalid of [
    { ...row, link_id: 100 }, { ...row, sped: "" }, { ...row, tfvl: -1 },
    { ...row, ocpy_rate: 101 }, { ...row, trvl_hh: null },
    { ...row, prcn_dt: "20260230030000" }, { ...row, prcn_dt: "20261111240000" },
  ]) {
    assert.throws(() => normalizeJejuIts(envelope(invalid), "realtime"), /row/);
  }
});

test("Jeju ITS collapses identical duplicates and rejects conflicting readings", () => {
  const summary = summarizeJejuIts(envelope(row, { ...row, sped: "21" }), "realtime");
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.duplicateCount, 1);
  assert.throws(() => normalizeJejuIts(envelope(row, { ...row, sped: 22 }), "realtime"), /Conflicting/);
  assert.equal(summarizeJejuIts(envelope(), "realtime").status, "EMPTY");
});

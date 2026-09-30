import test from "node:test";
import assert from "node:assert/strict";

import {
  backgroundTopologySupported,
  backgroundAcceptanceVerdict,
  collectorHealthReady,
  finishedReportFromStatus,
  reportFilename,
  stopNameForSequence,
} from "../public/ride-capture/background-client-core.js";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

test("background capture is selected only for an explicitly ready collector", () => {
  assert.equal(collectorHealthReady(undefined), false);
  assert.equal(collectorHealthReady({ ok: true, service: "tapso-ride-collector" }), false);
  assert.equal(collectorHealthReady({
    ok: true,
    service: "tapso-ride-collector",
    liveTransitConfigured: true,
    operatorEnabled: false,
  }), false);
  assert.equal(collectorHealthReady({
    ok: true,
    service: "tapso-ride-collector",
    liveTransitConfigured: true,
    operatorEnabled: true,
  }), true);
});

test("the background client refuses a loop seam until the server supports it", () => {
  assert.equal(backgroundTopologySupported({ ok: true, wrapAround: false }), true);
  assert.equal(backgroundTopologySupported({ ok: true, wrapAround: true }), false);
  assert.equal(backgroundTopologySupported({ ok: false, wrapAround: false }), false);
});

test("status helpers expose only completed reports and official stop names", () => {
  const stops = [{ sequence: 3, name: "세 번째" }, { sequence: 4, name: "네 번째" }];
  assert.equal(stopNameForSequence(stops, 4), "네 번째");
  assert.equal(stopNameForSequence(stops, 9), undefined);
  assert.equal(finishedReportFromStatus({ phase: "active", report: { routeId: "R" } }), undefined);
  assert.deepEqual(finishedReportFromStatus({ phase: "completed", report: { routeId: "R" } }), { routeId: "R" });
});

test("report filenames are deterministic and filesystem-safe", () => {
  assert.equal(
    reportFilename({ routeId: "JEB405136521", startedAt: "2026-09-15T12:34:56.789Z" }),
    "JEB405136521-2026-09-15T12-34-56-789Z.report.json",
  );
});


test("background acceptance fails closed on provenance, browser background, and polling continuity", () => {
  const base = {
    captureEngine: "railway-background",
    configuredIntervalSeconds: 5,
    snapshotCount: 80,
    collectionIntervalSeconds: { max: 5.8 },
    lifecycle: { hiddenPeriods: 2, hiddenSeconds: 125 },
  };
  assert.equal(backgroundAcceptanceVerdict(base).verdict, "PASS");

  const local = backgroundAcceptanceVerdict({ ...base, captureEngine: "local-device" });
  assert.equal(local.verdict, "FAIL");
  assert.match(local.reasons.join(" "), /captureEngine/);

  const noBackground = backgroundAcceptanceVerdict({
    ...base,
    lifecycle: { hiddenPeriods: 0, hiddenSeconds: 0 },
  });
  assert.equal(noBackground.verdict, "FAIL");

  const stalled = backgroundAcceptanceVerdict({
    ...base,
    collectionIntervalSeconds: { max: 15.01 },
  });
  assert.equal(stalled.verdict, "FAIL");
});

test("raw capture and report share one exact stem so the campaign can pair them", async () => {
  const { captureFileStem, rawCaptureFilename } = await import("../public/ride-capture/background-client-core.js");
  const ride = { routeId: "JEB405136521", startedAt: "2026-09-15T12:34:56.789Z" };
  assert.equal(captureFileStem(ride), "JEB405136521-2026-09-15T12-34-56-789Z");
  assert.equal(rawCaptureFilename(ride), "JEB405136521-2026-09-15T12-34-56-789Z.json");
  assert.equal(reportFilename(ride), "JEB405136521-2026-09-15T12-34-56-789Z.report.json");
  assert.equal(
    rawCaptureFilename(ride).replace(/\.json$/, ""),
    reportFilename(ride).replace(/\.report\.json$/, ""),
  );
  // A route id is sanitized the same way on both halves.
  assert.equal(captureFileStem({ routeId: "a/b c", startedAt: ride.startedAt }), "a_b_c-2026-09-15T12-34-56-789Z");
});

test("the finish screen never claims a download landed, and flags a missing raw", async () => {
  const { exportChecklist, shouldWarnBeforeLeaving } = await import("../public/ride-capture/background-client-core.js");
  const nothing = exportChecklist({});
  assert.equal(nothing.rawMissing, true);
  assert.match(nothing.raw, /저장 안 함/);
  const both = exportChecklist({ rawRequested: true, reportRequested: true });
  assert.equal(both.rawMissing, false);
  assert.match(both.raw, /요청됨/);
  assert.match(both.report, /요청됨/);
  for (const text of [nothing.raw, nothing.report, both.raw, both.report]) {
    assert.ok(!/저장됨|완료/.test(text), `must not claim success: ${text}`);
  }
  assert.equal(shouldWarnBeforeLeaving({ rawRequested: false }), true);
  assert.equal(shouldWarnBeforeLeaving({ rawRequested: true }), false);
});

test("the raw export deadline is completion plus the collector's retention", async () => {
  const { rawExportDeadline, RAW_RETENTION_MS } = await import("../public/ride-capture/background-client-core.js");
  const { COMPLETED_RETENTION_MS } = await import("../src/backgroundRideCapture.ts");
  assert.equal(RAW_RETENTION_MS, COMPLETED_RETENTION_MS, "client and server agree on the window");
  assert.equal(
    rawExportDeadline({ endedAt: "2026-09-23T09:00:00.000Z" })?.toISOString(),
    "2026-09-23T11:00:00.000Z",
  );
  assert.equal(rawExportDeadline({}), undefined);
});

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

export const DEFAULT_COLLECTOR_BASE = "https://collector-production-af2c.up.railway.app";

/**
 * The launcher switches to server-side capture only when the collector explicitly
 * says both required credentials are configured. Anything ambiguous stays on the
 * existing device-owned recorder instead of starting a ride that cannot collect.
 */
export function collectorHealthReady(payload) {
  return Boolean(
    payload
      && payload.ok === true
      && payload.service === "tapso-ride-collector"
      && payload.liveTransitConfigured === true
      && payload.operatorEnabled === true,
  );
}

/**
 * The first server version is linear-segment only. A loop seam or ambiguous
 * repeating topology stays on the existing local controller until the server can
 * model that ride without lying about remaining-stop arithmetic.
 */
export function backgroundTopologySupported(verdict) {
  return Boolean(verdict?.ok) && verdict?.wrapAround !== true;
}

export function stopNameForSequence(stops, sequence) {
  if (!Number.isInteger(sequence)) return undefined;
  return (stops ?? []).find((stop) => stop?.sequence === sequence)?.name;
}

export function finishedReportFromStatus(status) {
  return status?.phase === "completed" && status?.report ? status.report : undefined;
}

export function reportFilename(report) {
  const routeId = String(report?.routeId ?? "ride").replace(/[^A-Za-z0-9_-]/g, "_");
  const startedAt = String(report?.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  return `${routeId}-${startedAt}.report.json`;
}

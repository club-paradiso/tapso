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

export function backgroundAcceptanceVerdict(report) {
  const reasons = [];
  const captureEngine = report?.captureEngine ?? "unknown";
  const configuredIntervalSeconds = Number(report?.configuredIntervalSeconds);
  const maxCollectionIntervalSeconds = Number(report?.collectionIntervalSeconds?.max);
  const hiddenPeriods = Number(report?.lifecycle?.hiddenPeriods ?? 0);
  const hiddenSeconds = Number(report?.lifecycle?.hiddenSeconds ?? 0);
  const snapshotCount = Number(report?.snapshotCount ?? 0);
  const maxAllowedGapSeconds = Number.isFinite(configuredIntervalSeconds)
    ? configuredIntervalSeconds * 3
    : undefined;

  if (captureEngine !== "railway-background") {
    reasons.push("captureEngine is not railway-background");
  }
  if (hiddenPeriods < 1 || hiddenSeconds < 60) {
    reasons.push("at least 60 seconds of browser background time was not observed");
  }
  if (snapshotCount < 20) {
    reasons.push("fewer than 20 snapshots were collected");
  }
  if (!Number.isFinite(maxCollectionIntervalSeconds) || !Number.isFinite(maxAllowedGapSeconds)) {
    reasons.push("collection interval evidence is missing");
  } else if (maxCollectionIntervalSeconds > maxAllowedGapSeconds) {
    reasons.push(`polling gap ${maxCollectionIntervalSeconds}s exceeded ${maxAllowedGapSeconds}s`);
  }

  return {
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    captureEngine,
    hiddenPeriods,
    hiddenSeconds,
    snapshotCount,
    maxCollectionIntervalSeconds: Number.isFinite(maxCollectionIntervalSeconds) ? maxCollectionIntervalSeconds : undefined,
    maxAllowedGapSeconds,
  };
}

export function reportFilename(report) {
  const routeId = String(report?.routeId ?? "ride").replace(/[^A-Za-z0-9_-]/g, "_");
  const startedAt = String(report?.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  return `${routeId}-${startedAt}.report.json`;
}

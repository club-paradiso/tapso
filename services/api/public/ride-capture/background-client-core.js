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

/**
 * One stem for both halves of a ride, `<routeId>-<startedAt>`, so the campaign
 * analyzer (`scripts/ride-capture/batch-analyze.ts`) pairs the raw capture and
 * its report by exact name. The raw capture and the report carry the same
 * `routeId` and `startedAt`, so either can name the pair.
 */
export function captureFileStem(ride) {
  const routeId = String(ride?.routeId ?? "ride").replace(/[^A-Za-z0-9_-]/g, "_");
  const startedAt = String(ride?.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  return `${routeId}-${startedAt}`;
}

export function reportFilename(report) {
  return `${captureFileStem(report)}.report.json`;
}

/** The raw `RideCapture`. Replayable evidence; holds vehicle numbers and coordinates. */
export function rawCaptureFilename(ride) {
  return `${captureFileStem(ride)}.json`;
}

/** Matches `COMPLETED_RETENTION_MS` in `backgroundRideCapture.ts`. */
export const RAW_RETENTION_MS = 2 * 60 * 60 * 1_000;

/**
 * The last moment the collector still holds the raw capture, or undefined when
 * the completion time is unknown. Shown so the operator knows the deadline.
 */
export function rawExportDeadline(status) {
  const ended = Date.parse(status?.endedAt ?? "");
  return Number.isFinite(ended) ? new Date(ended + RAW_RETENTION_MS) : undefined;
}

/**
 * What the finish screen says about each export. A browser gives the page no
 * signal that a download actually landed, so the strongest honest state is
 * "requested", never "saved".
 */
export function exportChecklist({ rawRequested = false, reportRequested = false } = {}) {
  return {
    raw: rawRequested ? "RAW 저장 요청됨 · 파일 앱에서 확인하세요" : "RAW 저장 안 함 · 검증에 필요합니다",
    report: reportRequested ? "REPORT 저장 요청됨" : "REPORT 저장 안 함",
    rawMissing: !rawRequested,
  };
}

/** Leaving the finish screen without requesting the raw loses the ride as evidence. */
export function shouldWarnBeforeLeaving({ rawRequested = false } = {}) {
  return !rawRequested;
}

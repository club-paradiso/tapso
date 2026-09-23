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
export function exportChecklist({ rawRequested = false, reportRequested = false, submitted = false } = {}) {
  return {
    raw: rawRequested ? "RAW 저장 요청됨 · 파일 앱에서 확인하세요"
      : submitted ? "RAW 수동 저장 안 함 · 제출로 서버에 보관됨 (선택)"
      : "RAW 저장 안 함 · 제출하지 않을 때는 필수",
    report: reportRequested ? "REPORT 저장 요청됨" : "REPORT 저장 안 함",
    rawMissing: !rawRequested && !submitted,
  };
}

/**
 * Leaving the finish screen loses the ride as evidence unless it was either
 * submitted to durable storage or its raw capture was saved by hand.
 */
export function shouldWarnBeforeLeaving({ rawRequested = false, submitted = false } = {}) {
  return !rawRequested && !submitted;
}

export const CAMPAIGN_TARGET = 30;

/**
 * Why a submitted ride does not count, as one short code a rider can read.
 * Derived from the server's receipt only; the rules live on the server.
 */
export function exclusionReason(receipt) {
  if (!receipt || receipt.bucket === "CLEAN_GATE_CANDIDATE") return undefined;
  if (receipt.selectionVerdict === "wrong") return "WRONG_VEHICLE_SELECTED";
  if (receipt.usableForGate === false) {
    return receipt.selectionVerdict === "no_boarded_vehicle" ? "NO_BOARDED_VEHICLE" : "NOT_USABLE_FOR_GATE";
  }
  const reasons = (receipt.reasons ?? []).join(" ");
  if (/direction/.test(reasons)) return "DIRECTION_REVERSAL";
  if (/non-fresh/.test(reasons)) return "STALE_SELECTION";
  if (receipt.evidenceVerdict === "INSUFFICIENT_EVIDENCE") return "INSUFFICIENT_EVIDENCE";
  return receipt.bucket ?? "NOT_COUNTED";
}

/** What the finish screen shows after the server accepted a submission. */
export function submissionView(receipt) {
  const campaign = receipt?.campaign ?? {};
  const counted = receipt?.bucket === "CLEAN_GATE_CANDIDATE";
  const lines = [];
  if (counted) {
    lines.push(`${receipt.bucket} · 검증 카운트에 포함`);
    if (receipt.selectionVerdict === "never_committed") {
      lines.push("매칭은 끝까지 버스를 고르지 않았습니다 (안전한 보류)");
    }
  } else {
    lines.push("이번 기록은 검증 카운트에 포함되지 않음");
    lines.push(`이유: ${exclusionReason(receipt)}`);
  }
  lines.push(`캠페인 ${campaign.cleanObservedBoardings ?? 0} / ${CAMPAIGN_TARGET}`);
  lines.push(`남은 기록 ${campaign.remainingToThirty ?? CAMPAIGN_TARGET}`);
  return {
    headline: receipt?.duplicate ? "이미 제출된 기록입니다" : "제출 완료",
    title: `Field Ride #${receipt?.fieldRideNumber ?? "?"}`,
    counted,
    lines,
    // Gate failures and anything else a human must look at, straight from the server.
    alerts: Array.isArray(campaign.alerts) ? campaign.alerts : [],
  };
}

/** What the finish screen shows when a submission did not go through. */
export function submitFailureView(error, deadline) {
  const status = Number(error?.status ?? 0);
  const lines = [];
  if (status === 404) {
    lines.push("서버 보관 기간이 지났거나 서버가 재시작되어 원본이 서버에 없습니다.");
    lines.push("이 화면이 원본을 이미 받아 두었다면 백업 내보내기로 저장할 수 있습니다.");
  } else if (status === 503 && error?.code === "FIELD_VALIDATION_UNAVAILABLE") {
    lines.push("서버에 검증 저장소가 설정되지 않았습니다.");
    lines.push("원본은 서버에서 아직 보관 중입니다. 백업 내보내기로 원본을 저장하세요.");
  } else {
    lines.push("원본은 서버에서 아직 보관 중입니다.");
    lines.push("다시 제출하거나, 백업 내보내기로 원본을 저장하세요.");
  }
  if (deadline && status !== 404) lines.push(`서버 보관 마감: ${deadline.toLocaleTimeString()}`);
  return { headline: "제출 실패", lines, retry: status !== 404 };
}

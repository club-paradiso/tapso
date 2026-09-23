/** Pure text for the operator's beta panel. Sanitized server numbers only. */

const DAY_MS = 24 * 60 * 60 * 1_000;

export function inviteRowText(invite, now) {
  const status = {
    pending: "미사용",
    active: "사용 중",
    expired: "만료",
    revoked: "폐기됨",
  }[invite?.status] ?? String(invite?.status ?? "");
  const daysLeft = Math.ceil((Date.parse(invite?.expiresAt ?? "") - now.getTime()) / DAY_MS);
  const remaining = invite?.status === "pending" || invite?.status === "active"
    ? ` · ${Math.max(0, daysLeft)}일 남음`
    : "";
  return `${invite?.label || invite?.inviteId} · ${status}${remaining} · ${invite?.ridesUsed ?? 0} / ${invite?.maxRides ?? 0} rides`;
}

export function betaCampaignLines(summary) {
  const rides = summary?.matcherFieldRides ?? {};
  const verdicts = summary?.verdictCounts ?? {};
  return [
    "Beta Matcher Validation",
    `${rides.clean ?? 0} / ${rides.target ?? 30} clean rides`,
    `${summary?.testers ?? 0} testers · ${summary?.routes ?? 0} routes`,
    `correct ${verdicts.correct ?? 0} · wrong ${verdicts.wrong ?? 0} · never committed ${verdicts.never_committed ?? 0}`,
    `contested rides ${summary?.ridesWithContestedDecisions ?? 0} · direction reversals ${summary?.directionReversals ?? 0} · stale selections ${summary?.staleSelections ?? 0}`,
    "Provider/cadence calibration: separate evidence requirement (beta rides carry no markers)",
    "gateClosed: false · automatic matching: OFF",
    ...(summary?.alerts ?? []),
  ];
}

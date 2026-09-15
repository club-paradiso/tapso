export function normalizePlateSuffix(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}

export function hasValidPlateSuffix(value) {
  return normalizePlateSuffix(value).length === 4;
}

export function exactRouteVariants(variants, routeNo) {
  const wanted = String(routeNo ?? "").trim().replace(/\s+/g, "").replace(/번$/u, "");
  return (variants ?? []).filter((variant) =>
    String(variant?.routeNumber ?? "").trim().replace(/\s+/g, "").replace(/번$/u, "") === wanted,
  );
}

export function vehiclePlateSuffix(vehicleId) {
  return normalizePlateSuffix(vehicleId);
}

export function matchingVehicles(vehicles, suffix) {
  const wanted = normalizePlateSuffix(suffix);
  if (wanted.length !== 4) return [];
  return (vehicles ?? []).filter((vehicle) => vehiclePlateSuffix(vehicle?.vehicleId) === wanted);
}

export function collectVehicleCandidates(routeSnapshots, suffix) {
  const candidates = [];
  for (const entry of routeSnapshots ?? []) {
    for (const vehicle of matchingVehicles(entry?.vehicles, suffix)) {
      candidates.push({ route: entry.route, vehicle });
    }
  }
  return candidates;
}

export function boardingCandidates(stops, providerSequence, behind = 3, ahead = 1) {
  const list = Array.isArray(stops) ? stops : [];
  if (!Number.isInteger(providerSequence)) return list.slice(0, Math.min(8, list.length));
  const index = list.findIndex((stop) => stop.sequence === providerSequence);
  if (index < 0) return list.slice(0, Math.min(8, list.length));
  return list.slice(Math.max(0, index - behind), Math.min(list.length, index + ahead + 1));
}

/**
 * A physical stop sequence should normally contribute at most one rider marker.
 * The UI may still allow an explicit second marker when the doors genuinely
 * reopen, but an accidental double tap must be detectable before it is stored.
 */
export function hasPassedStopMarker(markers, sequence) {
  return (markers ?? []).some((marker) => marker?.kind === "passed_stop" && marker?.stopSequence === sequence);
}

/**
 * Field Mode is driven only by rider-confirmed physical markers. Provider
 * position is intentionally absent from this helper: a delayed nodeord must not
 * make the UI suggest that the rider record the wrong physical stop.
 *
 * Before the first physical marker, the boarding stop is the first choice so
 * the rider can record the doors opening there. Afterwards the window advances
 * from the latest confirmed stop. Choosing a later stop naturally skips stops
 * where the doors never opened without fabricating markers for them.
 */
export function fieldStopChoices({
  stops,
  markers,
  boardingSequence,
  destinationSequence,
  wrapAround = false,
  limit = 4,
}) {
  const list = Array.isArray(stops) ? stops : [];
  if (!list.length || !Number.isInteger(boardingSequence) || !Number.isInteger(destinationSequence)) return [];

  const lastPassed = [...(markers ?? [])].reverse().find(
    (marker) => marker?.kind === "passed_stop" && Number.isInteger(marker?.stopSequence),
  );
  const anchor = lastPassed?.stopSequence ?? boardingSequence;
  const count = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 4;

  if (!wrapAround) {
    const start = lastPassed ? anchor + 1 : anchor;
    return list
      .filter((stop) => stop.sequence >= start && stop.sequence <= destinationSequence)
      .slice(0, count);
  }

  const anchorIndex = list.findIndex((stop) => stop.sequence === anchor);
  if (anchorIndex < 0) return [];
  const rotated = [...list.slice(anchorIndex), ...list.slice(0, anchorIndex)];
  const ahead = lastPassed ? rotated.slice(1) : rotated;
  const destinationIndex = ahead.findIndex((stop) => stop.sequence === destinationSequence);
  if (destinationIndex < 0) return [];
  return ahead.slice(0, destinationIndex + 1).slice(0, count);
}

/**
 * The post-alight gate is deliberately based on elapsed wall time plus the live
 * provider position. If the provider has not reached the destination, a capture
 * must remain open for the whole observation window instead of finalizing at the
 * physical alight marker. This is measurement plumbing, not a freshness policy.
 */
export function postAlightObservationState({
  remainingStops,
  alightedAtMs,
  nowMs,
  observeMs = 20_000,
}) {
  const started = Number(alightedAtMs);
  const current = Number(nowMs);
  const windowMs = Number.isFinite(Number(observeMs)) ? Math.max(0, Number(observeMs)) : 20_000;
  const destinationObserved = remainingStops === 0;
  const elapsedMs = Number.isFinite(started) && Number.isFinite(current)
    ? Math.max(0, current - started)
    : 0;
  const remainingMs = destinationObserved ? 0 : Math.max(0, windowMs - elapsedMs);
  return {
    destinationObserved,
    elapsedMs,
    remainingMs,
    canFinalize: destinationObserved || remainingMs === 0,
  };
}

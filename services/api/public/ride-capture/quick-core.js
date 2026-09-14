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

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

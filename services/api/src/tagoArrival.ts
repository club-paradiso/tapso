/**
 * TAGO stop arrival predictions (data.go.kr 15098530, 국토교통부_(TAGO)_버스도착정보).
 *
 * Contract `OFFICIAL_DATED`, read 2026-11-08 from
 * https://www.data.go.kr/data/15098530/openapi.do (page modified 2023-07-12):
 * `GET https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList`
 * with `serviceKey`, `cityCode`, `nodeId` (optional `pageNo`, `numOfRows`,
 * `_type`). Each row: `nodeid`, `nodenm`, `routeid`, `routeno`, `routetp`,
 * `arrprevstationcnt` (stops away), `vehicletp`, `arrtime` (seconds).
 *
 * What the contract does NOT give, and what this module therefore never
 * claims:
 * - no vehicle number: a prediction cannot be tied to the bus a rider
 *   confirmed;
 * - no time at which the estimate was computed: `arrtime` counts from an
 *   unknown instant, so its age cannot be bounded;
 * - no stated method or accuracy.
 *
 * Whether Jeju (city 39) is served is `UNKNOWN`: no authorised call has been
 * made (`scripts/data-sources/arrival-probe.ts` is the check). Nothing here is
 * wired into a passenger-facing path.
 */

export const ARRIVAL_ENDPOINT = "https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList";

export interface ArrivalPrediction {
  stopId: string;
  stopName: string;
  routeId: string;
  routeNo: string;
  routeType?: string;
  /** `arrprevstationcnt`: stops between the predicted bus and this stop. */
  stopsAway: number;
  vehicleType?: string;
  /** `arrtime`: the provider's estimate in seconds, from an unstated instant. */
  providerEstimateSeconds: number;
  label: "PROVIDER_ESTIMATE";
  /** The contract has no vehicle number. */
  vehicle: null;
  /** The contract has no computation time. */
  computedAt: null;
}

export type ArrivalParse =
  | { ok: true; totalCount: number; rows: ArrivalPrediction[]; rejected: { index: number; reason: string }[] }
  | { ok: false; reason: string };

/** Fail closed: an envelope TAPSO cannot read is `ok: false`; a row it cannot read is rejected, not repaired. */
export function parseArrivalResponse(raw: unknown): ArrivalParse {
  const response = record(record(raw)?.response);
  const header = record(response?.header);
  if (!header) return { ok: false, reason: "no response.header" };
  const code = String(header.resultCode ?? "");
  if (code !== "00") return { ok: false, reason: `resultCode ${code || "missing"}: ${String(header.resultMsg ?? "")}` };
  const body = record(response?.body);
  if (!body) return { ok: false, reason: "no response.body" };
  const totalCount = Number(body.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) return { ok: false, reason: "totalCount is not a count" };
  // data.go.kr JSON sends "" for an empty list and an object for a single row.
  const itemsNode = body.items === "" || body.items === undefined ? undefined : record(body.items);
  const items = itemsNode?.item === undefined ? [] : Array.isArray(itemsNode.item) ? itemsNode.item : [itemsNode.item];
  const rows: ArrivalPrediction[] = [];
  const rejected: { index: number; reason: string }[] = [];
  items.forEach((value, index) => {
    const item = record(value);
    if (!item) return rejected.push({ index, reason: "row is not an object" });
    const text = (key: string): string | undefined => (item[key] === undefined || item[key] === null || item[key] === "" ? undefined : String(item[key]));
    const stopsAway = Number(item.arrprevstationcnt);
    const seconds = Number(item.arrtime);
    const missing = ["nodeid", "nodenm", "routeid", "routeno"].filter((key) => text(key) === undefined);
    if (missing.length) return rejected.push({ index, reason: `missing ${missing.join(", ")}` });
    if (!Number.isInteger(stopsAway) || stopsAway < 0) return rejected.push({ index, reason: "arrprevstationcnt is not a non-negative integer" });
    if (!Number.isFinite(seconds) || seconds < 0) return rejected.push({ index, reason: "arrtime is not a non-negative number" });
    rows.push({
      stopId: text("nodeid")!,
      stopName: text("nodenm")!,
      routeId: text("routeid")!,
      routeNo: text("routeno")!,
      ...(text("routetp") ? { routeType: text("routetp") } : {}),
      stopsAway,
      ...(text("vehicletp") ? { vehicleType: text("vehicletp") } : {}),
      providerEstimateSeconds: seconds,
      label: "PROVIDER_ESTIMATE",
      vehicle: null,
      computedAt: null,
    });
    return undefined;
  });
  return { ok: true, totalCount, rows, rejected };
}

/**
 * Consistency of a prediction with the live positions of the same route
 * variant at about the same time: does any reported bus stand exactly
 * `stopsAway` stops before the stop? `consistent` is not "correct": it only
 * says the two provider services agree with each other, and they may share an
 * upstream (`ASSUMED`; not documented).
 */
export function predictionAgreesWithPositions(
  prediction: Pick<ArrivalPrediction, "stopsAway">,
  stopSequence: number,
  vehicleSequences: number[],
): "consistent" | "inconsistent" | "no_positions" {
  if (vehicleSequences.length === 0) return "no_positions";
  return vehicleSequences.some((sequence) => stopSequence - sequence === prediction.stopsAway) ? "consistent" : "inconsistent";
}

/**
 * By how many stops a prediction differs from what the nearest reported bus
 * behind the stop implies: `stopsAway - (stopSequence - vehicleSequence)`,
 * for the bus that makes the difference smallest. Positive means the
 * prediction counts more stops than the position does. `null` when no bus is
 * behind the stop. Two TAGO services are compared, neither is ground truth.
 */
export function predictionOffsetStops(
  prediction: Pick<ArrivalPrediction, "stopsAway">,
  stopSequence: number,
  vehicleSequences: number[],
): number | null {
  const behind = vehicleSequences.filter((sequence) => sequence < stopSequence);
  if (behind.length === 0) return null;
  return behind
    .map((sequence) => prediction.stopsAway - (stopSequence - sequence))
    .reduce((best, offset) => (Math.abs(offset) < Math.abs(best) ? offset : best));
}

/** A catalog variant with the live stop sequences TAGO reports on it now. */
export interface ArrivalProbeCandidate {
  routeId: string;
  routeNo: string;
  stops: Array<{ stopId: string; name: string; sequence: number }>;
  vehicleSequences: number[];
}

export interface ArrivalProbeTarget {
  routeId: string;
  routeNo: string;
  stopId: string;
  stopName: string;
  stopSequence: number;
  /** The reported bus the target is placed ahead of. */
  vehicleSequence: number;
}

/**
 * Stops to query for an arrival probe: a few stops ahead of a bus TAGO reports
 * on the variant right now, so a prediction for that variant is expected and
 * its `stopsAway` can be checked against the position. A variant with no
 * reported bus is not probed (a fixed sample at an empty moment tests
 * nothing: 2026-11-09 06:13, 213 rows, 0 comparable). The bus with the most
 * stops ahead is used; targets never wrap past the last stop. One variant of
 * every route number comes before a second of any; bounded per route number
 * and overall. Pure.
 */
export function chooseArrivalProbeTargets(
  candidates: ArrivalProbeCandidate[],
  options: { offsets?: number[]; maxTargets?: number; maxVariantsPerRouteNo?: number } = {},
): ArrivalProbeTarget[] {
  const offsets = options.offsets ?? [2, 5];
  const maxTargets = options.maxTargets ?? 6;
  const maxVariantsPerRouteNo = options.maxVariantsPerRouteNo ?? 2;
  const targets: ArrivalProbeTarget[] = [];
  const variantsPerRouteNo = new Map<string, number>();
  // One variant of every route number before a second of any: order running
  // variants by their rank within their route number, keeping catalog order.
  const rankSeen = new Map<string, number>();
  const ranked = candidates.map((candidate, index) => {
    const running = candidate.vehicleSequences.some((sequence) => Number.isInteger(sequence) && sequence >= 1);
    const rank = running ? (rankSeen.get(candidate.routeNo) ?? 0) : Number.POSITIVE_INFINITY;
    if (running) rankSeen.set(candidate.routeNo, rank + 1);
    return { candidate, rank, index };
  }).sort((left, right) => left.rank - right.rank || left.index - right.index);
  for (const { candidate } of ranked) {
    if (targets.length >= maxTargets) break;
    if ((variantsPerRouteNo.get(candidate.routeNo) ?? 0) >= maxVariantsPerRouteNo) continue;
    const last = Math.max(0, ...candidate.stops.map((stop) => stop.sequence));
    const valid = candidate.vehicleSequences.filter((sequence) => Number.isInteger(sequence) && sequence >= 1 && sequence <= last);
    if (valid.length === 0) continue;
    const vehicleSequence = Math.min(...valid);
    const chosen: ArrivalProbeTarget[] = [];
    for (const offset of offsets) {
      const stop = candidate.stops.find((candidateStop) => candidateStop.sequence === vehicleSequence + offset);
      if (!stop || chosen.some((target) => target.stopId === stop.stopId)) continue;
      chosen.push({ routeId: candidate.routeId, routeNo: candidate.routeNo, stopId: stop.stopId, stopName: stop.name, stopSequence: stop.sequence, vehicleSequence });
    }
    if (chosen.length === 0) continue;
    variantsPerRouteNo.set(candidate.routeNo, (variantsPerRouteNo.get(candidate.routeNo) ?? 0) + 1);
    targets.push(...chosen.slice(0, maxTargets - targets.length));
  }
  return targets;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

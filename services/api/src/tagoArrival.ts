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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

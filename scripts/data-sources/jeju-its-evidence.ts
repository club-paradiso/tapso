import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Jeju ITS documents Info rows for both operations. Processing and bucket
// timestamps do not establish when the underlying traffic was observed.
const sourceIds = {
  realtime: "15093660",
  hourly: "15093668",
} as const;

export type JejuItsFeed = keyof typeof sourceIds;

type TrafficRow = {
  linkId: string;
  sourceTimestamp: string;
  vehicleCount: number;
  averageSpeedKmh: number;
  occupancyPercent: number;
  travelTimeSeconds: number;
};

export class JejuItsEvidenceError extends Error {}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return NaN;
}

function parseKstTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{14}$/.test(value)) return undefined;
  const [year, month, day, hour, minute, second] = [
    value.slice(0, 4), value.slice(4, 6), value.slice(6, 8),
    value.slice(8, 10), value.slice(10, 12), value.slice(12, 14),
  ];
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const wallClock = new Date(`${local}Z`);
  if (!Number.isFinite(wallClock.getTime()) || wallClock.toISOString().slice(0, 19) !== local) return undefined;
  return new Date(`${local}+09:00`).toISOString();
}

export function normalizeJejuIts(payload: unknown, feed: JejuItsFeed) {
  const envelope = record(payload);
  if (envelope?.result !== "success" || !Array.isArray(envelope.Info)) {
    throw new JejuItsEvidenceError("Invalid success envelope");
  }
  if (numeric(envelope.info_cnt) !== envelope.Info.length) {
    throw new JejuItsEvidenceError("Response count does not match Info rows");
  }

  const byLinkAndTime = new Map<string, TrafficRow>();
  let duplicates = 0;
  for (const [index, value] of envelope.Info.entries()) {
    const raw = record(value);
    const linkId = raw?.link_id;
    const timestamp = feed === "realtime" ? raw?.prcn_dt : raw?.stat_dt;
    const sourceTimestamp = parseKstTimestamp(timestamp);
    const vehicleCount = numeric(raw?.tfvl);
    const averageSpeedKmh = numeric(raw?.sped);
    const occupancyPercent = numeric(raw?.ocpy_rate);
    const travelTimeSeconds = numeric(raw?.trvl_hh);

    if (typeof linkId !== "string" || !/^\d+$/.test(linkId) || !sourceTimestamp ||
        (feed === "hourly" && !sourceTimestamp.endsWith(":00:00.000Z")) ||
        !Number.isSafeInteger(vehicleCount) || vehicleCount < 0 ||
        !Number.isFinite(averageSpeedKmh) || averageSpeedKmh < 0 ||
        !Number.isFinite(occupancyPercent) || occupancyPercent < 0 || occupancyPercent > 100 ||
        !Number.isFinite(travelTimeSeconds) || travelTimeSeconds < 0) {
      throw new JejuItsEvidenceError(`Invalid Info row at index ${index}`);
    }

    const row = { linkId, sourceTimestamp, vehicleCount, averageSpeedKmh, occupancyPercent, travelTimeSeconds };
    const key = `${linkId}/${sourceTimestamp}`;
    const previous = byLinkAndTime.get(key);
    if (previous) {
      if (previous.vehicleCount !== vehicleCount || previous.averageSpeedKmh !== averageSpeedKmh ||
          previous.occupancyPercent !== occupancyPercent || previous.travelTimeSeconds !== travelTimeSeconds) {
        throw new JejuItsEvidenceError(`Conflicting Info row at index ${index}`);
      }
      duplicates++;
      continue;
    }
    byLinkAndTime.set(key, row);
  }

  return { rows: [...byLinkAndTime.values()], duplicates };
}

export function summarizeJejuIts(payload: unknown, feed: JejuItsFeed, sourceFetchedAt: string | null = null) {
  const { rows, duplicates } = normalizeJejuIts(payload, feed);
  const timestamps = rows.map((row) => row.sourceTimestamp).sort();
  return {
    datasetId: sourceIds[feed],
    provider: "Jeju Special Self-Governing Province",
    officialDocs: "https://jejuits.go.kr/open_api/open_apiView.do",
    status: rows.length === 0 ? "EMPTY" : "SCHEMA_VALID",
    timestampKind: feed === "realtime" ? "processing_time" : "hourly_bucket",
    firstSourceTimestamp: timestamps.at(0) ?? null,
    lastSourceTimestamp: timestamps.at(-1) ?? null,
    sourceObservedAt: null,
    sourceFetchedAt,
    linkCount: new Set(rows.map((row) => row.linkId)).size,
    rowCount: rows.length,
    duplicateCount: duplicates,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , feed, input, fetchedAt, ...extra] = process.argv;
  if ((feed !== "realtime" && feed !== "hourly") || !input || extra.length ||
      (fetchedAt !== undefined && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(fetchedAt) ||
        !Number.isFinite(Date.parse(fetchedAt)) || new Date(fetchedAt).toISOString() !== fetchedAt))) {
    console.error("Usage: node scripts/data-sources/jeju-its-evidence.ts <realtime|hourly> <file.json> [fetchedAt ISO UTC]");
    process.exitCode = 2;
  } else {
    try {
      const payload: unknown = JSON.parse(readFileSync(input, "utf8"));
      console.log(JSON.stringify(summarizeJejuIts(payload, feed, fetchedAt ?? null), null, 2));
    } catch (error) {
      // JSON syntax errors can quote the payload. Only emit fixed diagnostics
      // and errors controlled by the schema validator.
      console.error(error instanceof JejuItsEvidenceError ? error.message : "Cannot read or parse JSON input");
      process.exitCode = 1;
    }
  }
}

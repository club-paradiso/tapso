/**
 * Collects crosswalk evidence from the official 제주버스정보시스템 passenger
 * station page, one catalog stop at a time
 * (`docs/validation/JEJU_BIS_TAGO_STOP_CROSSWALK.md`).
 *
 *   node --experimental-strip-types scripts/crosswalk/collect-bis-station-evidence.ts \
 *     --out artifacts/jeju-stop-crosswalk/evidence.json [--limit N] [--offset N]
 *   … --ids JEB405002800,JEB405002801   # re-read only these stops and merge into --out
 *
 * For each stop it reads `/mobile/station/detailStation/<JEB-stripped id>?type=station&mode=ridebooking`
 * — the page a rider opens, never the site's own data requests — and records
 * what `parseStationPage` finds. The stripped id is only the hypothesis under
 * test. Paced at one request per 1.2 s, sequential, and it stops after ten
 * consecutive failed reads rather than hammer a struggling site; stops not
 * reached stay unchecked. Run by `.github/workflows/jeju-stop-crosswalk.yml`
 * because the agent environment cannot reach bus.jeju.go.kr. Offline research
 * only: nothing here is a runtime dependency.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { candidateBisStationId, parseStationPage, type StationEvidence } from "../../services/api/src/stopCrosswalk.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = option("--out") ?? "artifacts/jeju-stop-crosswalk/evidence.json";
const limit = Number(option("--limit") ?? Number.POSITIVE_INFINITY);
const offset = Number(option("--offset") ?? 0);
const ids = option("--ids")?.split(",").map((id) => id.trim()).filter(Boolean);
const PAUSE_MS = 1_200;
const MAX_CONSECUTIVE_FAILURES = 10;

const catalog = JSON.parse(readFileSync(new URL("../../services/api/data/jeju-transit-catalog.json", import.meta.url), "utf8")) as {
  stops: { id: string; name: string }[];
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function read(stationId: string): Promise<StationEvidence> {
  try {
    const response = await fetch(`https://bus.jeju.go.kr/mobile/station/detailStation/${stationId}?type=station&mode=ridebooking`, {
      headers: {
        "user-agent": "TAPSO-crosswalk-audit/1.0 (+https://github.com/club-paradiso/tapso)",
        "accept-language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200) return { kind: "read_failed" };
    return parseStationPage(await response.text(), stationId);
  } catch {
    return { kind: "read_failed" };
  }
}

type EvidenceFile = { collectedOn: string; amendedOn?: string; amended?: string[]; evidence: Record<string, StationEvidence> };
// With --ids the committed evidence is kept and only those stops are re-read.
const previous: EvidenceFile | undefined = ids ? JSON.parse(readFileSync(out, "utf8")) as EvidenceFile : undefined;
const evidence: Record<string, StationEvidence> = { ...(previous?.evidence ?? {}) };
const counts: Record<string, number> = { found: 0, not_found: 0, read_failed: 0, skipped: 0 };
let consecutiveFailures = 0;
const selected = ids
  ? catalog.stops.filter((stop) => ids.includes(stop.id))
  : catalog.stops.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
if (ids && selected.length !== ids.length) throw new Error("--ids names a stop that is not in the catalog");
for (const [index, stop] of selected.entries()) {
  const candidate = candidateBisStationId(stop.id);
  if (!candidate) {
    counts.skipped! += 1;
    continue;
  }
  if (index > 0) await pause(PAUSE_MS);
  const result = await read(candidate);
  // A failed re-read never replaces evidence already held.
  if (!(result.kind === "read_failed" && evidence[stop.id])) evidence[stop.id] = result;
  counts[result.kind]! += 1;
  consecutiveFailures = result.kind === "read_failed" ? consecutiveFailures + 1 : 0;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`stopping after ${MAX_CONSECUTIVE_FAILURES} consecutive failed reads at stop ${offset + index}`);
    break;
  }
  if ((index + 1) % 250 === 0) console.log(JSON.stringify({ progress: index + 1, of: selected.length, ...counts }));
}
mkdirSync(dirname(out), { recursive: true });
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const collectedOn = previous?.collectedOn ?? today;
const totals: Record<string, number> = { found: 0, not_found: 0, read_failed: 0 };
for (const value of Object.values(evidence)) totals[value.kind]! += 1;
writeFileSync(out, `${JSON.stringify({
  schemaVersion: "tapso-jeju-stop-crosswalk-evidence-v1",
  label: "OFFICIAL_DATED",
  source: "bus.jeju.go.kr passenger station page (/mobile/station/detailStation/<id>?type=station&mode=ridebooking), ko-KR",
  collectedOn,
  ...(previous ? { amendedOn: today, amended: [...new Set([...(previous.amended ?? []), ...ids!])].sort() } : {}),
  counts: { ...totals, skipped: counts.skipped },
  evidence,
}, null, 1)}\n`);
console.log(JSON.stringify({ done: Object.keys(evidence).length, ...counts }));
// A run that never reached the site (runner unreachable, site down) is not
// evidence about any stop: fail so the workflow commits nothing.
if (counts.found! + counts.not_found! === 0) {
  console.error("no page was read; nothing to classify");
  process.exitCode = 3;
}

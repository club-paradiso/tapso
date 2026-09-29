/**
 * Re-decide every former wrong commit at the instant it was made, under the
 * current matcher, from the committed sanitized ledger alone.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/redecide-ledger.ts \
 *     [--ledger=artifacts/passive-shadow-validation-v3-wrong-commits.json] \
 *     [--out=artifacts/matcher-directed-v1/former-wrong-commit-instants.json]
 *
 * What this can and cannot establish:
 *
 *   - The Passive Shadow v3 ledger records, for each of the 268 live wrong
 *     commits, every candidate in the snapshot at the commit decision: its
 *     stop sequence, its cadence state, and its role (selected / true bus /
 *     other). That is the whole matcher input at that instant except route
 *     topology and memory of vehicles absent from the snapshot.
 *   - So the question "does the current matcher still commit at that instant,
 *     and to whom?" can be answered exactly — provided topology is assumed
 *     permissively (a straight route, no repeated stop). Real topology and
 *     memory can only *add* abstentions, never a selection, so a "no commit"
 *     here stays "no commit" under the real inputs.
 *   - It cannot say what the matcher does *later* in each case's window (the
 *     true bus approaching, other buses appearing). That needs the raw streams:
 *     `scripts/passive-shadow/migrate.ts`.
 *
 * The legacy policy is replayed on the same reconstruction as a control: it
 * must reproduce the recorded selection, or the reconstruction is refused for
 * that record.
 *
 * Offline and read-only, like `scripts/passive-shadow/evaluate.ts`: `fetch` and
 * sockets are replaced, and the ledger's sha256 is checked before use.
 */

import { createHash } from "node:crypto";
import net from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StopOnRoute, VehicleObservation } from "../../services/api/src/domain.ts";
import { MATCHER_POLICY_VERSION, matchVehicleWithSourceFreshness } from "../../services/api/src/matching.ts";
import { LEGACY_MATCHER_POLICY_VERSION, matchVehicleLegacySymmetricV0 } from "../../services/api/src/matchingLegacy.ts";
import type { SourceFreshnessEvidence, SourceFreshnessState } from "../../services/api/src/sourceFreshness.ts";

/* ------------------------------------------------------- offline guard */

let networkAttempts = 0;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("redecide-ledger.ts is offline: a network call was attempted");
}) as typeof fetch;
net.Socket.prototype.connect = function guardedConnect(): never {
  networkAttempts += 1;
  throw new Error("redecide-ledger.ts is offline: a socket connection was attempted");
} as typeof net.Socket.prototype.connect;

/** The evidence of record, as published in docs/validation/PASSIVE_SHADOW_VALIDATION_V3_RESULTS.md. */
export const LEDGER_OF_RECORD_SHA256 = "a960d428caa9d967ddbde0e66f9f1a9963cfd65df519bc6acc58951532fd8773";

const options = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
const ledgerPath = path.resolve(options.get("ledger") || "artifacts/passive-shadow-validation-v3-wrong-commits.json");
const outPath = path.resolve(options.get("out") || "artifacts/matcher-directed-v1/former-wrong-commit-instants.json");

interface LedgerCandidate {
  role: "SELECTED" | "TRUTH" | "OTHER";
  stopSequence?: number;
  stopOffset?: number;
  score: number;
  cadence?: SourceFreshnessState;
  rejected: string[];
}

interface LedgerRecord {
  caseId: string;
  scenario: string;
  routeId: string;
  boardingSequence: number;
  commitAt: string;
  committedStopOffset: number;
  mechanism: string;
  commitDecision: { eligibleCount: number; candidates: LedgerCandidate[] };
  truthAtCommit: { inFeed: boolean };
}

const bytes = await readFile(ledgerPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== LEDGER_OF_RECORD_SHA256) {
  console.error(`ledger sha256 ${sha256} is not the evidence of record ${LEDGER_OF_RECORD_SHA256}; refusing`);
  process.exit(3);
}
const ledger = JSON.parse(bytes.toString("utf8")) as {
  total: number;
  records: LedgerRecord[];
  provenance: Record<string, unknown>;
};
if (ledger.records.length !== ledger.total) {
  console.error(`ledger claims ${ledger.total} records but holds ${ledger.records.length}; refusing`);
  process.exit(3);
}

// Every record is re-decided as a rider waiting at the stop. That is only a
// faithful model of WAIT_AT_STOP cases; any other scenario would be
// mis-modelled, so the script refuses rather than decide it anyway.
const otherScenarios = ledger.records.filter((record) => record.scenario !== "WAIT_AT_STOP");
if (otherScenarios.length > 0) {
  console.error(`${otherScenarios.length} ledger record(s) are not WAIT_AT_STOP (${otherScenarios[0]!.scenario}); refusing to model them as waiting riders`);
  process.exit(3);
}

const results = ledger.records.map(redecide);
const counts = (key: (row: ReturnType<typeof redecide>) => string) => results.reduce<Record<string, number>>((acc, row) => {
  const value = key(row);
  acc[value] = (acc[value] ?? 0) + 1;
  return acc;
}, {});

const output = {
  schemaVersion: 1,
  kind: "former-wrong-commit-instant-redecision",
  evidenceClass: "VERIFIED_BY_REPLAY",
  evidenceNote:
    "Instant-level replay of the recorded commit-decision inputs of every LIVE_PASSIVE wrong commit in the Passive Shadow v3 "
    + "evidence of record. Topology is assumed permissively (straight route, no repeated stop) and memory of absent vehicles is "
    + "empty; both can only add abstentions under the real inputs. This does not establish each case's outcome later in its "
    + "window; that requires the raw streams.",
  source: {
    ledger: path.relative(process.cwd(), ledgerPath),
    ledgerSha256: sha256,
    ledgerProvenance: ledger.provenance,
  },
  matcherPolicy: MATCHER_POLICY_VERSION,
  controlPolicy: LEGACY_MATCHER_POLICY_VERSION,
  networkAttempts,
  totals: {
    records: results.length,
    legacyReproducedRecordedSelection: results.filter((row) => row.legacyReproduced).length,
    currentPolicyStatus: counts((row) => row.current.status),
    currentPolicyCommitsToFormerWrongBus: results.filter((row) => row.current.selectedRole === "SELECTED").length,
    currentPolicyCommitsToTrueBus: results.filter((row) => row.current.selectedRole === "TRUTH").length,
    currentPolicyCommitsToOtherBus: results.filter((row) => row.current.selectedRole === "OTHER").length,
    formerSelectionZone: counts((row) => row.current.formerSelectionZone),
    trueBusZone: counts((row) => row.current.trueBusZone ?? "absent_from_feed"),
  },
  records: results,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), networkAttempts, totals: output.totals }, null, 2));
if (networkAttempts > 0) process.exit(4);

function redecide(record: LedgerRecord) {
  // Neutral pseudonyms, so that no role name can decide a tie-break.
  const ids = record.commitDecision.candidates.map((candidate, index) =>
    `v-${createHash("sha256").update(`${record.caseId}|${candidate.role}|${index}`).digest("hex").slice(0, 10)}`);
  const roleOf = new Map(ids.map((id, index) => [id, record.commitDecision.candidates[index]!.role]));
  const candidates: VehicleObservation[] = record.commitDecision.candidates.map((candidate, index) => ({
    vehicleId: ids[index]!,
    routeId: record.routeId,
    observedAt: new Date(0).toISOString(),
    receivedAt: record.commitAt,
    timestampSource: "unavailable",
    ...(candidate.stopSequence === undefined ? {} : { stopSequence: candidate.stopSequence }),
  }));
  const freshness = new Map<string, SourceFreshnessEvidence>();
  record.commitDecision.candidates.forEach((candidate, index) => {
    if (!candidate.cadence) return;
    freshness.set(ids[index]!, {
      state: candidate.cadence,
      sampleCount: 0,
      spanSeconds: 0,
      contentChangeCount: 0,
      sequenceDecreaseCount: 0,
      reason: "cadence state as recorded in the evidence-of-record ledger",
    });
  });
  const request = {
    routeId: record.routeId,
    boardingStopSequence: record.boardingSequence,
    now: record.commitAt,
    candidates,
    riderState: "waiting_at_stop" as const,
    stops: permissiveStops(record),
  };
  const legacy = matchVehicleLegacySymmetricV0(request, freshness);
  const current = matchVehicleWithSourceFreshness(request, freshness);
  const zoneOf = (role: string) => current.ranked.find((row) => roleOf.get(row.vehicleId) === role)?.zone;
  return {
    caseId: record.caseId,
    routeId: record.routeId,
    boardingSequence: record.boardingSequence,
    commitAt: record.commitAt,
    formerMechanism: record.mechanism,
    formerCommittedStopOffset: record.committedStopOffset,
    legacyReproduced: legacy.status === "matched" && roleOf.get(legacy.selectedVehicleId ?? "") === "SELECTED",
    current: {
      status: current.status,
      ...(current.selectedVehicleId ? { selectedRole: roleOf.get(current.selectedVehicleId) } : {}),
      abstentionReasons: current.abstentionReasons ?? [],
      formerSelectionZone: zoneOf("SELECTED") ?? "missing",
      ...(zoneOf("TRUTH") ? { trueBusZone: zoneOf("TRUTH") } : {}),
      formerSelectionRejectedBecause: current.ranked.find((row) => roleOf.get(row.vehicleId) === "SELECTED")?.rejectedReasons ?? [],
    },
  };
}

/**
 * The most permissive topology consistent with the record: a straight route
 * whose stops are all distinct. Labelled as an assumption; never a claim about
 * the real route.
 */
function permissiveStops(record: LedgerRecord): StopOnRoute[] {
  const highest = Math.max(
    record.boardingSequence + 1,
    ...record.commitDecision.candidates.map((candidate) => candidate.stopSequence ?? 0),
  );
  return Array.from({ length: highest + 1 }, (_, index) => ({
    stopId: `permissive-assumption-${index + 1}`,
    name: `permissive-assumption-${index + 1}`,
    sequence: index + 1,
  }));
}

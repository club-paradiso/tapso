/**
 * The evidence-of-record reproduction check, shared by `migrate.ts` and
 * `scripts/matcher-evidence/live-evidence.ts`: the legacy side of a migration
 * must reproduce the recorded live bucket counts and exactly the recorded
 * wrong-commit case ids before anything is compared with it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { MatcherMigration } from "../../services/api/src/passiveShadowMigration.ts";

export interface ReproductionResult {
  ok: boolean;
  checked: string[];
  detail: string;
}

export async function reproductionCheck(
  migration: Pick<MatcherMigration, "cases" | "rows" | "formerWrongCommits">,
  record: { summary?: string; ledger?: string },
): Promise<ReproductionResult> {
  const checked: string[] = [];
  const legacyWrong = new Set(migration.formerWrongCommits.map((row) => row.caseId));
  if (record.summary) {
    checked.push(`summary:${record.summary}`);
    const recorded = JSON.parse(await readFile(path.resolve(record.summary), "utf8")) as {
      live: { cases: number; buckets: Record<string, number> };
    };
    if (recorded.live.cases !== migration.cases) {
      return { ok: false, checked, detail: `recorded ${recorded.live.cases} live cases, replay produced ${migration.cases}` };
    }
    const legacyBuckets: Record<string, number> = {};
    for (const row of migration.rows) legacyBuckets[row.legacy.bucket] = (legacyBuckets[row.legacy.bucket] ?? 0) + 1;
    for (const [bucket, value] of Object.entries(recorded.live.buckets)) {
      if ((legacyBuckets[bucket] ?? 0) !== value) {
        return { ok: false, checked, detail: `bucket ${bucket}: recorded ${value}, legacy replay ${legacyBuckets[bucket] ?? 0}` };
      }
    }
  }
  if (record.ledger) {
    checked.push(`ledger:${record.ledger}`);
    const recorded = JSON.parse(await readFile(path.resolve(record.ledger), "utf8")) as { records: Array<{ caseId: string }> };
    const recordedIds = new Set(recorded.records.map((row) => row.caseId));
    const missing = [...recordedIds].filter((id) => !legacyWrong.has(id));
    const extra = [...legacyWrong].filter((id) => !recordedIds.has(id));
    if (missing.length > 0 || extra.length > 0) {
      return { ok: false, checked, detail: `wrong-commit ids differ: ${missing.length} recorded but not replayed, ${extra.length} replayed but not recorded` };
    }
  }
  return { ok: true, checked, detail: checked.length === 0 ? "no evidence of record supplied" : "legacy replay reproduces the evidence of record" };
}

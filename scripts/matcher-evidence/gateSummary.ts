/**
 * What a gate run says where a reviewer looks: the job summary and the
 * annotations, not only the JSON buried in the log.
 *
 * A green workflow means the gate ran and did not award less than the code
 * claims (`gate.ts --fail-below-claim`). It is not a domain-quality pass: a
 * criterion above the awarded level can FAIL while the run stays green, as
 * CA-5 did in gate-evidence run 36871560482 (issue #74). This renders every
 * criterion with its status and observation, and one `::warning` workflow
 * command per FAIL, so such a failure is visible on the run page. Pure: no
 * file, environment or process access; `gate.ts` decides where it goes.
 */

import type { GateResult } from "../../services/api/src/matcherSafetyGate.ts";

export interface GateSummary {
  /** Markdown for `$GITHUB_STEP_SUMMARY`. */
  markdown: string;
  /** One `::warning title=<id> FAIL::...` workflow command per FAIL criterion. */
  warnings: string[];
}

export function renderGateSummary(result: GateResult): GateSummary {
  const failing = result.criteria.filter((row) => row.status === "FAIL");
  const lines = [
    `### Release gate ${result.policyVersion}`,
    "",
    `Awarded: **${result.awarded}**.`,
    "",
    "A green run means the gate ran and awarded no less than the code claims. It is not a domain-quality pass:"
      + " any FAIL below is a criterion that is not met.",
    "",
    failing.length > 0
      ? `FAIL: ${failing.map((row) => row.id).join(", ")}.`
      : "No criterion FAILs. MISSING is never a pass.",
    "",
    "| Criterion | Status | Level | Observed | Required |",
    "| --- | --- | --- | --- | --- |",
    ...result.criteria.map((row) => `| ${cell(row.id)} | ${row.status} | ${row.level} | ${cell(row.observed)} | ${cell(row.required)} |`),
    "",
  ];
  const warnings = failing.map((row) =>
    `::warning title=${property(row.id)} FAIL::${data(`${row.title}: ${row.observed} (required ${row.required}); awarded ${result.awarded}`)}`);
  return { markdown: `${lines.join("\n")}\n`, warnings };
}

/** A markdown table cell: pipes escaped, one line. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Workflow command message escaping (`%`, CR, LF). */
function data(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Workflow command property escaping: as `data`, plus `:` and `,`. */
function property(value: string): string {
  return data(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

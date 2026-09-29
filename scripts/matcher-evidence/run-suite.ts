/**
 * Run the transit API suite and the deep property suite, and record the
 * outcome where the release gate can read it.
 *
 *   node --experimental-strip-types scripts/matcher-evidence/run-suite.ts \
 *     [--property-cases=2000] [--out=artifacts/matcher-directed-v1/test-suite.json]
 *
 * Two runs, both from `services/api`:
 *   1. every `test/*.test.ts` at its default sizes, except the tests that read
 *      the gate's own output (a gate result cannot be evidence for itself;
 *      `gate.ts --check` performs that comparison instead);
 *   2. `test/matcherProperties.test.ts` with `TAPSO_PROPERTY_CASES` fresh seeds
 *      per property, after every recorded regression seed.
 *
 * A skipped or todo test is never a pass: TAP prints it as `ok … # SKIP` or
 * `ok … # TODO`, so those lines are not counted as passing, and any skipped or
 * todo test fails the run. `--property-cases` must be a positive integer (the
 * property file would silently fall back to its default otherwise).
 *
 * The summary holds no timings, so the same code yields the same file.
 * Exit 1 when either run fails; the summary is written either way so the
 * failure can be read.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const options = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key!, value.join("=")];
}));
const propertyCases = Number(options.get("property-cases") || 2_000);
if (!Number.isSafeInteger(propertyCases) || propertyCases < 1) {
  console.error("--property-cases must be a positive integer");
  process.exit(2);
}
const outPath = path.resolve(options.get("out") || "artifacts/matcher-directed-v1/test-suite.json");
const apiRoot = path.resolve("services/api");

/** Tests of the gate's output, not of the matcher: excluded to break the cycle. */
const GATE_OUTPUT_TESTS = new Set(["matchingReadiness.test.ts"]);

function run(args: string[], env: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...args], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${child.stdout}\n${child.stderr}`;
  const count = (label: string) => Number(new RegExp(`^# ${label} (\\d+)$`, "m").exec(output)?.[1] ?? "NaN");
  return {
    exitCode: child.status,
    tests: count("tests"),
    pass: count("pass"),
    fail: count("fail"),
    skipped: count("skipped"),
    todo: count("todo"),
    failing: [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]!),
    // Only real passes: a skipped or todo test prints `ok … # SKIP` / `# TODO`.
    passingNames: [...output.matchAll(/^ok \d+ - (.+)$/gm)]
      .map((match) => match[1]!)
      .filter((name) => !/\s#\s*(SKIP|TODO)\b/i.test(name)),
  };
}

const allTestFiles = readdirSync(path.join(apiRoot, "test")).filter((name) => name.endsWith(".test.ts")).sort();
const suiteFiles = allTestFiles.filter((name) => !GATE_OUTPUT_TESTS.has(name)).map((name) => `test/${name}`);
const suite = run(suiteFiles);
const properties = run(["test/matcherProperties.test.ts"], { TAPSO_PROPERTY_CASES: String(propertyCases) });
const regressions = JSON.parse(readFileSync(path.join(apiRoot, "test/fixtures/matcher-property-regressions.json"), "utf8")) as { seeds: unknown[] };
const invariants = new Set(properties.passingNames.map((name) => /^P(\d+):/.exec(name)?.[1]).filter(Boolean));

const summary = {
  schemaVersion: 1,
  evidenceClass: "VERIFIED_BY_TEST",
  node: process.version.split(".")[0],
  suite: {
    files: suiteFiles.length,
    excludedFiles: allTestFiles.filter((name) => GATE_OUTPUT_TESTS.has(name)),
    ...suite,
    passingNames: undefined,
  },
  properties: { casesPerProperty: propertyCases, ...properties, passingNames: undefined },
  passed: suite.exitCode === 0 && properties.exitCode === 0 && suite.fail === 0 && properties.fail === 0
    && suite.skipped === 0 && suite.todo === 0 && properties.skipped === 0 && properties.todo === 0,
  propertySeedsPerInvariant: properties.exitCode === 0 && properties.skipped === 0 && properties.todo === 0 ? propertyCases : 0,
  propertyRegressionSeeds: regressions.seeds.length,
  propertyInvariantsCovered: invariants.size,
  /** Every top-level test that passed in either run: what a declared mitigation's named tests are checked against. */
  passingTests: [...new Set([...suite.passingNames, ...properties.passingNames])].sort(),
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), passed: summary.passed, suite: { tests: suite.tests, fail: suite.fail }, properties: { tests: properties.tests, fail: properties.fail, casesPerProperty: propertyCases }, invariants: summary.propertyInvariantsCovered }, null, 2));
if (!summary.passed) process.exit(1);

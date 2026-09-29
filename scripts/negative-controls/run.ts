/**
 * Mutation-based negative controls: prove that the test suite fails when a
 * leakage path or a fail-closed rule is deliberately put back.
 *
 *   node --experimental-strip-types scripts/negative-controls/run.ts \
 *     [--out=artifacts/matcher-directed-v1/negative-controls.json] \
 *     [--only=F1,F3a] [--jobs=2] [--typecheck] [--no-confirm] \
 *     [--timeout-ms=900000] [--keep-temp] [--list]
 *
 * For every control in `mutations.ts`:
 *
 *   1. A private copy of the repository layout is made under `os.tmpdir()`:
 *      `services/api` (minus `node_modules`, which is linked) and the root
 *      `scripts/` are copied; every other top-level entry is a symlink, so
 *      tests that read fixtures or Swift sources by relative path still work.
 *      The copy is taken once (the snapshot) and every control starts from it,
 *      so the baseline and all mutants see identical sources even if the
 *      working tree changes meanwhile.
 *   2. Each edit's `find` must occur exactly once in the copy, or the control
 *      is STALE: the protection moved and the control must be rewritten.
 *   3. Every edited module must still load (`import()` in a fresh process), or
 *      the control is INVALID: a kill by a module that cannot load proves
 *      nothing. With `--typecheck`, the mutant must also add no TypeScript
 *      error over the snapshot, so no kill can come from the CI typecheck job
 *      alone.
 *   4. The control's listed test files run against the mutant. A test that
 *      fails there and did not fail on the unmutated snapshot kills it.
 *   5. Every kill is confirmed: the killing tests are re-run on the unmutated
 *      snapshot and must pass again, so a flaky test cannot pass for a kill.
 *   6. If nothing in the listed files noticed, the rest of the suite runs
 *      (unless `--no-confirm`). A control is SURVIVED only when the whole
 *      suite stayed as green as the baseline: that is a protection with no
 *      test.
 *
 * The real working tree is never written: edits resolve inside the copy (a
 * realpath check refuses anything else), the SHA-256 of `services/api/src`
 * and `services/api/test` is compared before and after the run, and after the
 * run no control's replacement text may appear in the working tree (a check
 * that still holds when someone else edits the tree meanwhile). The only file
 * written outside the temporary directory is the report.
 *
 * The report names tests and files only. It carries no provider data and no
 * vehicle numbers; test names are scrubbed of anything shaped like a Korean
 * plate before they are written.
 *
 * Exit codes: 0 every control KILLED and the baseline green; 1 a control
 * SURVIVED, STALE, INVALID or TIMEOUT, or the baseline is red; 2 usage or
 * catalogue error; 3 `services/api/src` or `services/api/test` changed during
 * the run, or a control's edit text is present in the working tree (the report
 * is still written and says which; after a concurrent edit by another process,
 * rerun on a quiet tree).
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NEGATIVE_CONTROLS, validateCatalogue, type NegativeControl, type SourceEdit } from "./mutations.ts";

/* ------------------------------------------------------------ options */

interface Options {
  out?: string;
  only?: string[];
  jobs: number;
  typecheck: boolean;
  confirm: boolean;
  timeoutMs: number;
  keepTemp: boolean;
  list: boolean;
  help: boolean;
}

const USAGE = [
  "Usage: node --experimental-strip-types scripts/negative-controls/run.ts [options]",
  "  --out=<path>        report path (default artifacts/matcher-directed-v1/negative-controls.json)",
  "  --only=<id,id,...>  run a subset; the report is then marked incomplete",
  "  --jobs=<n>          controls run in parallel (default: half the CPUs, at least 1)",
  "  --typecheck         also require every mutant to add no TypeScript error (needs apps/web's TypeScript)",
  "  --no-confirm        do not run the rest of the suite before reporting SURVIVED",
  "  --timeout-ms=<n>    wall-clock limit for one test run (default 900000)",
  "  --keep-temp         keep the temporary copies for inspection",
  "  --list              print the catalogue and exit",
].join("\n");

function parseOptions(argv: string[]): Options {
  const options: Options = {
    jobs: Math.max(1, Math.floor(os.availableParallelism() / 2)),
    typecheck: false,
    confirm: true,
    timeoutMs: 900_000,
    keepTemp: false,
    list: false,
    help: false,
  };
  for (const arg of argv) {
    const [key = "", ...rest] = arg.replace(/^--/, "").split("=");
    const value = rest.join("=");
    switch (key) {
      case "out":
        if (!value) throw new UsageError("--out needs a path");
        options.out = value;
        break;
      case "only":
        options.only = value.split(",").map((id) => id.trim()).filter(Boolean);
        if (options.only.length === 0) throw new UsageError("--only needs at least one control id");
        break;
      case "jobs":
        options.jobs = positiveInteger(value, "--jobs");
        break;
      case "timeout-ms":
        options.timeoutMs = positiveInteger(value, "--timeout-ms");
        break;
      case "typecheck":
        options.typecheck = true;
        break;
      case "no-confirm":
        options.confirm = false;
        break;
      case "keep-temp":
        options.keepTemp = true;
        break;
      case "list":
        options.list = true;
        break;
      case "help":
      case "h":
        options.help = true;
        break;
      default:
        throw new UsageError(`unknown option ${arg}`);
    }
  }
  // A partial run is for debugging. It never overwrites the canonical report
  // the release gate reads, so it must name its own output.
  if (options.only && !options.out) throw new UsageError("--only needs --out: a partial run never writes the canonical report");
  return options;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`${flag} needs a positive integer`);
  return parsed;
}

class UsageError extends Error {}

/* ------------------------------------------------------------- paths */

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REAL_API = path.join(REPO_ROOT, "services", "api");
const DEFAULT_OUT = path.join(REPO_ROOT, "artifacts", "matcher-directed-v1", "negative-controls.json");
/** Relative to `services/api`, exactly as `npm test` globs it. */
const TEST_DIR = "test";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/* ------------------------------------------------------ tree digests */

interface TreeDigest {
  sha256: string;
  files: Map<string, string>;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function digestTree(root: string): Promise<TreeDigest> {
  const files = new Map<string, string>();
  const total = createHash("sha256");
  for (const file of await listFiles(root)) {
    const content = await readFile(path.join(root, file));
    const digest = createHash("sha256").update(content).digest("hex");
    files.set(toPosix(file), digest);
    total.update(`${toPosix(file)}\0${digest}\n`);
  }
  return { sha256: total.digest("hex"), files };
}

interface ApiDigest {
  src: TreeDigest;
  test: TreeDigest;
}

async function digestApi(apiDir: string): Promise<ApiDigest> {
  return { src: await digestTree(path.join(apiDir, "src")), test: await digestTree(path.join(apiDir, TEST_DIR)) };
}

function sameDigest(left: ApiDigest, right: ApiDigest): boolean {
  return left.src.sha256 === right.src.sha256 && left.test.sha256 === right.test.sha256;
}

function changedFiles(before: ApiDigest, after: ApiDigest): string[] {
  const changes: string[] = [];
  for (const [tree, prefix] of [["src", "services/api/src"], ["test", "services/api/test"]] as const) {
    const left = before[tree].files;
    const right = after[tree].files;
    for (const file of new Set([...left.keys(), ...right.keys()])) {
      if (left.get(file) !== right.get(file)) changes.push(`${prefix}/${file}`);
    }
  }
  return changes.sort();
}

/* --------------------------------------------------------- snapshot */

/**
 * A private copy of the repository layout. `services/api` and `scripts/` are
 * real copies (the second so root scripts that tests spawn import the copied
 * sources through their relative paths); everything else is linked, never
 * written.
 */
async function buildMirror(destination: string): Promise<void> {
  await mkdir(destination);
  for (const entry of await readdir(REPO_ROOT, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const source = path.join(REPO_ROOT, entry.name);
    const target = path.join(destination, entry.name);
    if (entry.name === "services" && entry.isDirectory()) {
      await mkdir(target);
      for (const service of await readdir(source, { withFileTypes: true })) {
        const serviceSource = path.join(source, service.name);
        const serviceTarget = path.join(target, service.name);
        if (service.name !== "api" || !service.isDirectory()) {
          await symlink(serviceSource, serviceTarget, service.isDirectory() ? "dir" : "file");
          continue;
        }
        await mkdir(serviceTarget);
        for (const item of await readdir(serviceSource, { withFileTypes: true })) {
          const itemSource = path.join(serviceSource, item.name);
          const itemTarget = path.join(serviceTarget, item.name);
          if (item.name === "node_modules") await symlink(itemSource, itemTarget, "dir");
          else await cp(itemSource, itemTarget, { recursive: true, verbatimSymlinks: true });
        }
      }
      continue;
    }
    if (entry.name === "scripts" && entry.isDirectory()) {
      await cp(source, target, { recursive: true, verbatimSymlinks: true });
      continue;
    }
    await symlink(source, target, entry.isDirectory() ? "dir" : "file");
  }
}

/** Copies the working tree until the copy provably matches it (a concurrent edit during the copy forces a retry). */
async function takeSnapshot(destination: string): Promise<ApiDigest> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const before = await digestApi(REAL_API);
    await rm(destination, { recursive: true, force: true });
    await buildMirror(destination);
    const copied = await digestApi(path.join(destination, "services", "api"));
    const after = await digestApi(REAL_API);
    if (sameDigest(before, copied) && sameDigest(before, after)) return before;
    process.stderr.write(`snapshot attempt ${attempt}: the working tree changed while it was copied; retrying\n`);
  }
  throw new Error("could not take a consistent snapshot of services/api: the working tree kept changing");
}

/* ------------------------------------------------------------ edits */

type EditOutcome =
  | { ok: true; occurrences: number[] }
  | { ok: false; file: string; occurrences: number; editIndex: number };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    // Overlapping matches count too: "exactly once" means one position, full stop.
    from = index + 1;
  }
}

async function applyEdits(mirrorRoot: string, edits: readonly SourceEdit[]): Promise<EditOutcome> {
  const root = await realpath(mirrorRoot);
  const occurrences: number[] = [];
  for (const [editIndex, edit] of edits.entries()) {
    const target = path.join(mirrorRoot, ...edit.file.split("/"));
    let resolved: string;
    try {
      resolved = await realpath(target);
    } catch {
      return { ok: false, file: edit.file, occurrences: 0, editIndex };
    }
    // The mirror links most of the repository; an edit must land in a copied file, never through a link.
    if (!isInside(root, resolved)) throw new Error(`refusing to edit ${edit.file}: it resolves outside the temporary copy`);
    const source = await readFile(resolved, "utf8");
    const count = countOccurrences(source, edit.find);
    if (count !== 1) return { ok: false, file: edit.file, occurrences: count, editIndex };
    const index = source.indexOf(edit.find);
    await writeFile(resolved, source.slice(0, index) + edit.replace + source.slice(index + edit.find.length));
    occurrences.push(count);
  }
  return { ok: true, occurrences };
}

/* ------------------------------------------------------- processes */

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Set inside `node --test` workers; inherited, it would make the child a worker instead of a runner.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/* -------------------------------------------------------- test runs */

/**
 * A `node:test` reporter that emits one JSON line per test start and result.
 * Written into the temporary directory at run time, so it never becomes part
 * of the repository.
 */
const REPORTER_SOURCE = `export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type !== "test:start" && event.type !== "test:pass" && event.type !== "test:fail") continue;
    const data = event.data ?? {};
    yield JSON.stringify({
      event: event.type,
      file: data.file ?? null,
      name: String(data.name ?? ""),
      nesting: Number(data.nesting ?? 0),
      skip: Boolean(data.skip),
      todo: Boolean(data.todo),
    }) + "\\n";
  }
}
`;

type TestStatus = "pass" | "fail" | "skip" | "todo";

interface TestRecord {
  key: string;
  /** Relative to `services/api`, POSIX separators. */
  file: string;
  /** The test's own name. */
  name: string;
  /** Parent names and the test's name, joined with " > ". */
  path: string;
  status: TestStatus;
  /** The runner's stand-in for a file that failed to load or crashed outside any test. */
  fileLevel: boolean;
}

interface TestRun {
  records: TestRecord[];
  files: string[];
  timedOut: boolean;
  exitCode: number | null;
  durationMs: number;
  stderrTail: string;
}

interface ReporterLine {
  event: "test:start" | "test:pass" | "test:fail";
  file: string | null;
  name: string;
  nesting: number;
  skip: boolean;
  todo: boolean;
}

function parseReporterOutput(stdout: string, apiDir: string): TestRecord[] {
  const stacks = new Map<string, string[]>();
  const seen = new Map<string, number>();
  const records: TestRecord[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let parsed: ReporterLine;
    try {
      parsed = JSON.parse(line) as ReporterLine;
    } catch {
      continue;
    }
    const absolute = parsed.file ?? "";
    const file = absolute ? toPosix(path.relative(apiDir, absolute)) : "<unknown>";
    const stack = stacks.get(file) ?? [];
    stacks.set(file, stack);
    if (parsed.event === "test:start") {
      stack.length = Math.max(0, parsed.nesting);
      stack.push(parsed.name);
      continue;
    }
    const testPath = [...stack.slice(0, Math.max(0, parsed.nesting)), parsed.name].join(" > ");
    const base = `${file}::${testPath}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const status: TestStatus = parsed.event === "test:fail"
      ? (parsed.todo ? "todo" : "fail")
      : parsed.skip ? "skip" : parsed.todo ? "todo" : "pass";
    records.push({
      key: occurrence === 1 ? base : `${base}#${occurrence}`,
      file,
      name: parsed.name,
      path: testPath,
      status,
      fileLevel: parsed.nesting === 0 && absolute !== "" && parsed.name === path.basename(absolute),
    });
  }
  return records;
}

async function runTests(apiDir: string, files: string[], reporter: string, timeoutMs: number): Promise<TestRun> {
  const args = [
    "--experimental-strip-types",
    "--test",
    `--test-reporter=${pathToFileURL(reporter).href}`,
    "--test-reporter-destination=stdout",
    // A hung test fails on its own rather than hanging the whole run.
    `--test-timeout=${Math.min(timeoutMs, 300_000)}`,
    ...files,
  ];
  const result = await runProcess(process.execPath, args, apiDir, timeoutMs);
  return {
    records: parseReporterOutput(result.stdout, apiDir),
    files,
    timedOut: result.timedOut,
    exitCode: result.code,
    durationMs: result.durationMs,
    stderrTail: result.stderr.slice(-4_000),
  };
}

/**
 * Tests of the release gate's own output, not of the matcher. The gate reads
 * this harness's report, so a baseline that depended on the gate's result
 * would be circular; `gate.ts --check` makes that comparison instead, exactly
 * as `scripts/matcher-evidence/run-suite.ts` excludes the same files.
 */
const GATE_OUTPUT_TESTS = new Set(["matchingReadiness.test.ts"]);

async function testFilesIn(apiDir: string): Promise<string[]> {
  const entries = await readdir(path.join(apiDir, TEST_DIR), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts") && !GATE_OUTPUT_TESTS.has(entry.name))
    .map((entry) => `${TEST_DIR}/${entry.name}`)
    .sort();
}

/* -------------------------------------------------- load & typecheck */

async function loadCheck(apiDir: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
  for (const file of files) {
    const url = pathToFileURL(path.join(apiDir, ...file.split("/"))).href;
    const result = await runProcess(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", "await import(process.argv[1]);", url],
      apiDir,
      120_000,
    );
    if (result.code !== 0 || result.timedOut) {
      const detail = result.stderr.split("\n").filter((line) => /Error|error/.test(line)).slice(0, 3).join(" | ");
      return { ok: false, error: `${file} does not load: ${detail || `exit ${String(result.code)}`}` };
    }
  }
  return { ok: true };
}

const TYPESCRIPT = path.join(REPO_ROOT, "apps", "web", "node_modules", "typescript", "bin", "tsc");
const TYPE_ROOTS = path.join(REPO_ROOT, "apps", "web", "node_modules", "@types");

/** Errors of the CI typecheck (`services/api/tsconfig.json`), without line numbers so edits that shift lines compare equal. */
async function typeErrors(apiDir: string, timeoutMs: number): Promise<Set<string>> {
  const result = await runProcess(
    process.execPath,
    [TYPESCRIPT, "--project", path.join(apiDir, "tsconfig.json"), "--typeRoots", TYPE_ROOTS, "--pretty", "false", "--noEmit"],
    apiDir,
    timeoutMs,
  );
  if (result.timedOut) throw new Error("the typecheck timed out");
  const errors = new Set<string>();
  for (const line of result.stdout.split("\n")) {
    const match = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line.trim());
    if (!match) continue;
    const [, file = "", code = "", message = ""] = match;
    errors.add(`${toPosix(path.relative(apiDir, path.resolve(apiDir, file)))}: ${code}: ${message}`);
  }
  if (result.code !== 0 && errors.size === 0) {
    throw new Error(`the typecheck failed without diagnostics: ${result.stderr.slice(-500) || result.stdout.slice(-500)}`);
  }
  return errors;
}

/* --------------------------------------------------------- results */

type Outcome = "KILLED" | "SURVIVED" | "STALE" | "INVALID" | "TIMEOUT";

interface KillingTest {
  file: string;
  test: string;
}

interface ControlResult {
  id: string;
  family: string;
  catalogue: "required" | "extra";
  description: string;
  protection: string;
  file: string;
  edits: Array<{ file: string; find: string; replace: string }>;
  testFiles: string[];
  missingTestFiles: string[];
  outcome: Outcome;
  reason: string;
  killedIn?: "listed-test-files" | "rest-of-suite";
  /** Tests that failed under the mutation and did not fail on the unmutated snapshot. */
  failingTestCount: number;
  /** Every failing test in the mutant runs, including ones already failing on the snapshot. */
  failingTestCountIncludingBaseline: number;
  killedBy: KillingTest[];
  mustBeKilledBy?: string[];
  requiredKillerFired?: boolean;
  /** Tests in the listed files that already fail on the snapshot, so could not count as kills. */
  baselineFailuresInListedFiles: KillingTest[];
  loadCheck: "passed" | "failed" | "not-run";
  typecheck: "passed" | "failed" | "not-run";
  diagnostics?: string[];
  testFilesRun: number;
  durationMs: number;
}

interface ControlState {
  control: NegativeControl;
  index: number;
  result: ControlResult;
  /** The listed test files the snapshot has, relative to `services/api`. */
  present: string[];
  failing: TestRecord[];
  /** Newly failing tests of the listed files, minus any the confirmation run found flaky. */
  fresh: TestRecord[];
  /** False while the control still needs the rest of the suite. */
  settled: boolean;
}

const MAX_LISTED_KILLERS = 12;

/** Korean plate shapes (region, 2-3 digits, one Hangul syllable, 4 digits; or without the region): scrubbed from every string the report carries. */
function scrub(value: string): string {
  return value
    .replace(/[\uac00-\ud7a3]{2}\s?\d{2,3}\s?[\uac00-\ud7a3]\s?\d{4}/g, "[vehicle-id]")
    .replace(/\d{2,3}\s?[\uac00-\ud7a3]\s?\d{4}/g, "[vehicle-id]");
}

function killer(record: TestRecord): KillingTest {
  return { file: `services/api/${record.file}`, test: scrub(record.fileLevel ? `${record.path} (file failed to load or crashed)` : record.path) };
}

function newlyFailing(records: TestRecord[], baseline: ReadonlyMap<string, TestRecord>, flaky: ReadonlySet<string>): TestRecord[] {
  return records.filter((record) => record.status === "fail" && baseline.get(record.key)?.status !== "fail" && !flaky.has(record.key));
}

function requiredHits(control: NegativeControl, failing: TestRecord[]): TestRecord[] {
  if (!control.mustBeKilledBy) return failing;
  const required = new Set(control.mustBeKilledBy);
  return failing.filter((record) => required.has(record.name));
}

/** The tests that killed a control, its required killers first, capped for the report. */
function killersFor(control: NegativeControl, fresh: TestRecord[]): KillingTest[] {
  const required = new Set(control.mustBeKilledBy ?? []);
  const ordered = [...fresh.filter((record) => required.has(record.name)), ...fresh.filter((record) => !required.has(record.name))];
  return ordered.slice(0, MAX_LISTED_KILLERS).map(killer);
}

/**
 * Every control edit whose replacement text now appears in the working tree
 * although the snapshot did not contain it: proof, independent of anyone else
 * editing the tree concurrently, that no mutation escaped its copy. Deletions
 * leave no text to look for and are covered by the hash check alone.
 */
async function leakedEdits(controls: readonly NegativeControl[], snapshotRoot: string): Promise<string[]> {
  const leaks: string[] = [];
  for (const control of controls) {
    for (const edit of control.edits) {
      if (edit.replace.trim().length === 0) continue;
      const original = await readFile(path.join(snapshotRoot, ...edit.file.split("/")), "utf8").catch(() => "");
      if (original.includes(edit.replace)) continue;
      const current = await readFile(path.join(REPO_ROOT, ...edit.file.split("/")), "utf8").catch(() => "");
      if (current.includes(edit.replace)) leaks.push(`${control.id}: ${edit.file}`);
    }
  }
  return leaks;
}

/* ------------------------------------------------------------ pool */

async function pool<T, R>(items: readonly T[], jobs: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(jobs, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------ main */

async function gitProvenance(): Promise<{ head?: string; servicesApiDirty?: boolean }> {
  const run = (args: string[]) => new Promise<string | undefined>((resolve) => {
    execFile("git", args, { cwd: REPO_ROOT, timeout: 20_000 }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
  const head = await run(["rev-parse", "HEAD"]);
  // --no-optional-locks: a status must not take .git/index.lock from anyone else.
  const status = await run(["--no-optional-locks", "status", "--porcelain", "--", "services/api/src", "services/api/test"]);
  return {
    ...(head ? { head } : {}),
    ...(status === undefined ? {} : { servicesApiDirty: status.length > 0 }),
  };
}

/** The whole working tree's status, so a write anywhere in the repository (not only services/api) is noticed. */
async function repositoryStatus(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], { cwd: REPO_ROOT, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? undefined : stdout));
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)} s`;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const problems = validateCatalogue(NEGATIVE_CONTROLS);
  if (problems.length > 0) {
    console.error(`the negative-control catalogue is malformed:\n  ${problems.join("\n  ")}`);
    return 2;
  }
  if (options.list) {
    for (const control of NEGATIVE_CONTROLS) {
      console.log(`${control.id.padEnd(18)} ${control.catalogue.padEnd(8)} ${[...new Set(control.edits.map((edit) => edit.file))].join(", ")}\n  ${control.description}`);
    }
    return 0;
  }
  const unknown = (options.only ?? []).filter((id) => !NEGATIVE_CONTROLS.some((control) => control.id === id));
  if (unknown.length > 0) {
    console.error(`unknown control id(s): ${unknown.join(", ")}\n(see --list)`);
    return 2;
  }
  const controls = options.only
    ? NEGATIVE_CONTROLS.filter((control) => options.only!.includes(control.id))
    : [...NEGATIVE_CONTROLS];

  const outPath = options.out ? path.resolve(options.out) : DEFAULT_OUT;
  for (const guarded of [path.join(REAL_API, "src"), path.join(REAL_API, TEST_DIR)]) {
    if (outPath === guarded || isInside(guarded, outPath)) {
      console.error(`--out may not point into ${path.relative(REPO_ROOT, guarded)}`);
      return 2;
    }
  }
  if (options.typecheck && !(await exists(TYPESCRIPT))) {
    console.error(`--typecheck needs ${path.relative(REPO_ROOT, TYPESCRIPT)} (run npm ci in apps/web)`);
    return 2;
  }

  const started = Date.now();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "tapso-negative-controls-"));
  const reporter = path.join(workspace, "reporter.mjs");
  const snapshotRoot = path.join(workspace, "snapshot");
  const snapshotApi = path.join(snapshotRoot, "services", "api");
  try {
    await writeFile(reporter, REPORTER_SOURCE);
    const repositoryBefore = await repositoryStatus();
    const before = await takeSnapshot(snapshotRoot);
    const provenance = await gitProvenance();
    const matchingSource = await readFile(path.join(snapshotApi, "src", "matching.ts"), "utf8").catch(() => "");
    const matcherPolicy = /export const MATCHER_POLICY_VERSION = "([^"]+)"/.exec(matchingSource)?.[1];

    /* baseline: the whole suite on the unmutated snapshot */
    const allTestFiles = await testFilesIn(snapshotApi);
    process.stderr.write(`baseline: ${allTestFiles.length} test files on the unmutated snapshot...\n`);
    const baselineRun = await runTests(snapshotApi, allTestFiles, reporter, options.timeoutMs);
    if (baselineRun.timedOut) throw new Error(`the baseline test run timed out after ${seconds(options.timeoutMs)}`);
    if (baselineRun.records.length === 0) {
      throw new Error(`the baseline produced no test results; stderr tail:\n${baselineRun.stderrTail}`);
    }
    const baseline = new Map(baselineRun.records.map((record) => [record.key, record]));
    const baselineFailing = baselineRun.records.filter((record) => record.status === "fail");
    const baselineGreen = baselineFailing.length === 0 && baselineRun.exitCode === 0;
    process.stderr.write(`baseline: ${baselineRun.records.length} tests, ${baselineFailing.length} failing, ${seconds(baselineRun.durationMs)}\n`);

    let baselineTypeErrors: Set<string> | undefined;
    if (options.typecheck) {
      baselineTypeErrors = await typeErrors(snapshotApi, options.timeoutMs);
      process.stderr.write(`baseline typecheck: ${baselineTypeErrors.size} error(s) on the unmutated snapshot\n`);
    }

    const flaky = new Set<string>();

    /** A fresh mutant: a copy of the snapshot with the control's edits applied. */
    const prepareMutant = async (control: NegativeControl, index: number) => {
      const directory = path.join(workspace, `m${String(index + 1).padStart(2, "0")}-${control.id}`);
      await rm(directory, { recursive: true, force: true });
      await cp(snapshotRoot, directory, { recursive: true, verbatimSymlinks: true });
      return { directory, apiDir: path.join(directory, "services", "api"), applied: await applyEdits(directory, control.edits) };
    };
    const discard = async (directory: string) => {
      if (!options.keepTemp) await rm(directory, { recursive: true, force: true });
    };
    const note = (state: ControlState, fresh: TestRecord[], failing: TestRecord[]) => {
      state.result.failingTestCount = fresh.length;
      state.result.failingTestCountIncludingBaseline = failing.length;
      state.result.killedBy = killersFor(state.control, fresh);
      if (state.control.mustBeKilledBy) state.result.requiredKillerFired = requiredHits(state.control, fresh).length > 0;
    };
    const log = (state: ControlState) => {
      const { control, result } = state;
      process.stderr.write(state.settled
        ? `  ${result.outcome.padEnd(8)} ${control.id.padEnd(18)} ${result.reason}\n`
        : `  pending  ${control.id.padEnd(18)} not caught by its listed test files; the rest of the suite will run\n`);
    };

    /* phase 1: every control against its listed test files */
    const states = await pool(controls, options.jobs, async (control, index): Promise<ControlState> => {
      const started = Date.now();
      const listed = control.testFiles.map((file) => file.replace(/^services\/api\//, ""));
      const present = listed.filter((file) => allTestFiles.includes(file));
      const result: ControlResult = {
        id: control.id,
        family: control.family,
        catalogue: control.catalogue,
        description: control.description,
        protection: control.protection,
        file: [...new Set(control.edits.map((edit) => edit.file))].join(", "),
        edits: control.edits.map((edit) => ({ file: edit.file, find: edit.find, replace: edit.replace })),
        testFiles: control.testFiles,
        missingTestFiles: control.testFiles.filter((file) => !present.includes(file.replace(/^services\/api\//, ""))),
        outcome: "SURVIVED",
        reason: "",
        failingTestCount: 0,
        failingTestCountIncludingBaseline: 0,
        killedBy: [],
        ...(control.mustBeKilledBy ? { mustBeKilledBy: control.mustBeKilledBy } : {}),
        baselineFailuresInListedFiles: baselineFailing.filter((record) => present.includes(record.file)).map(killer),
        loadCheck: "not-run",
        typecheck: "not-run",
        testFilesRun: 0,
        durationMs: 0,
      };
      const state: ControlState = { control, index, result, present, failing: [], fresh: [], settled: false };
      const settle = (outcome: Outcome, reason: string) => {
        result.outcome = outcome;
        result.reason = reason;
        state.settled = true;
      };
      const { directory, apiDir, applied } = await prepareMutant(control, index);
      try {
        if (!applied.ok) {
          result.diagnostics = [`edit ${applied.editIndex + 1} of ${control.edits.length}: expected exactly one occurrence in ${applied.file}, found ${applied.occurrences}`];
          settle("STALE", `edit ${applied.editIndex + 1} target occurs ${applied.occurrences} times in ${applied.file}; rewrite the control`);
          return state;
        }
        const edited = [...new Set(control.edits.map((edit) => edit.file.replace(/^services\/api\//, "")))];
        const loaded = await loadCheck(apiDir, edited.filter((file) => /\.[cm]?tsx?$|\.[cm]?js$/.test(file)));
        result.loadCheck = loaded.ok ? "passed" : "failed";
        if (!loaded.ok) {
          result.diagnostics = [loaded.error ?? "the mutant does not load"];
          settle("INVALID", "an edited module no longer loads; the edit must stay a loadable change");
          return state;
        }
        if (baselineTypeErrors) {
          const mutantErrors = await typeErrors(apiDir, options.timeoutMs);
          const added = [...mutantErrors].filter((error) => !baselineTypeErrors!.has(error));
          result.typecheck = added.length === 0 ? "passed" : "failed";
          if (added.length > 0) {
            result.diagnostics = added.slice(0, 10);
            settle("INVALID", `the mutant adds ${added.length} TypeScript error(s); the CI typecheck, not a test, would catch it`);
            return state;
          }
        }
        if (present.length > 0) {
          const run = await runTests(apiDir, present, reporter, options.timeoutMs);
          result.testFilesRun = present.length;
          if (run.timedOut) {
            settle("TIMEOUT", `the listed test files did not finish within ${seconds(options.timeoutMs)}`);
            return state;
          }
          state.failing = run.records.filter((record) => record.status === "fail");
          state.fresh = newlyFailing(run.records, baseline, flaky);
          note(state, state.fresh, state.failing);
          if (requiredHits(control, state.fresh).length > 0) {
            result.killedIn = "listed-test-files";
            settle("KILLED", `${state.fresh.length} test(s) newly fail in the listed test files`);
          }
        }
        return state;
      } finally {
        result.durationMs += Date.now() - started;
        log(state);
        await discard(directory);
      }
    });

    /* every kill is confirmed: its killing tests pass again on the unmutated snapshot, in a run of their own */
    const killedEarly = states.filter((state) => state.settled && state.result.outcome === "KILLED");
    const killingFiles = [...new Set(killedEarly.flatMap((state) => state.fresh.map((record) => record.file)))].sort();
    if (killingFiles.length > 0) {
      process.stderr.write(`confirming kills: ${killingFiles.length} killing test file(s) re-run on the unmutated snapshot...\n`);
      const recheck = await runTests(snapshotApi, killingFiles, reporter, options.timeoutMs);
      if (recheck.timedOut) throw new Error("the kill-confirmation run on the unmutated snapshot timed out");
      for (const record of recheck.records) if (record.status === "fail") flaky.add(record.key);
      for (const state of killedEarly) {
        const confirmed = state.fresh.filter((record) => !flaky.has(record.key));
        if (confirmed.length === state.fresh.length) continue;
        state.fresh = confirmed;
        note(state, confirmed, state.failing);
        if (requiredHits(state.control, confirmed).length === 0) {
          state.settled = false;
          delete state.result.killedIn;
          process.stderr.write(`  demoted  ${state.control.id.padEnd(18)} its killing tests also failed on the unmutated snapshot (flaky)\n`);
        }
      }
    }

    /* phase 2: what the listed files missed, against the rest of the suite, one control at a time */
    for (const state of states.filter((item) => !item.settled)) {
      const { control, index, result } = state;
      const started = Date.now();
      const rest = allTestFiles.filter((file) => !state.present.includes(file));
      if (!options.confirm || rest.length === 0) {
        result.outcome = "SURVIVED";
        result.reason = survivorReason(control, result, options.confirm);
        state.settled = true;
        log(state);
        continue;
      }
      const { directory, apiDir, applied } = await prepareMutant(control, index);
      try {
        if (!applied.ok) throw new Error(`${control.id}: its edits applied to the snapshot once and then did not`);
        const run = await runTests(apiDir, rest, reporter, options.timeoutMs);
        result.testFilesRun += rest.length;
        if (run.timedOut) {
          result.outcome = "TIMEOUT";
          result.reason = `the rest of the suite did not finish within ${seconds(options.timeoutMs)}`;
        } else {
          let fresh = newlyFailing(run.records, baseline, flaky);
          if (fresh.length > 0) {
            // The same confirmation as above: a killing test must pass again on the snapshot.
            const recheck = await runTests(snapshotApi, [...new Set(fresh.map((record) => record.file))], reporter, options.timeoutMs);
            for (const record of recheck.records) if (record.status === "fail") flaky.add(record.key);
            if (recheck.timedOut) for (const record of fresh) flaky.add(record.key);
            fresh = newlyFailing(run.records, baseline, flaky);
          }
          const allFresh = [...state.fresh.filter((record) => !flaky.has(record.key)), ...fresh];
          note(state, allFresh, [...state.failing, ...run.records.filter((record) => record.status === "fail")]);
          if (requiredHits(control, allFresh).length > 0) {
            result.outcome = "KILLED";
            result.killedIn = "rest-of-suite";
            result.reason = `${fresh.length} test(s) outside the listed test files newly fail; list them in the control`;
          } else {
            result.outcome = "SURVIVED";
            result.reason = survivorReason(control, result, true);
          }
        }
        state.settled = true;
      } finally {
        result.durationMs += Date.now() - started;
        log(state);
        await discard(directory);
      }
    }
    const results = states.map((state) => state.result);

    /* the working tree must be exactly as it was, and must hold no control's edit */
    const after = await digestApi(REAL_API);
    const repositoryAfter = await repositoryStatus();
    const repositoryUnchanged = repositoryBefore !== undefined && repositoryBefore === repositoryAfter;
    const realTreeUnchanged = sameDigest(before, after) && repositoryUnchanged;
    const changedDuringRun = realTreeUnchanged ? [] : changedFiles(before, after);
    const mutationTextInWorkingTree = await leakedEdits(controls, snapshotRoot);

    const count = (outcome: Outcome, rows: ControlResult[] = results) => rows.filter((row) => row.outcome === outcome).length;
    const ids = (outcome: Outcome) => results.filter((row) => row.outcome === outcome).map((row) => row.id);
    const required = results.filter((row) => row.catalogue === "required");
    const extra = results.filter((row) => row.catalogue === "extra");
    const allKilled = results.length > 0 && results.every((row) => row.outcome === "KILLED");
    const exitCode = !realTreeUnchanged || mutationTextInWorkingTree.length > 0 ? 3 : allKilled && baselineGreen ? 0 : 1;

    const report = {
      schemaVersion: 1,
      kind: "tapso-negative-controls",
      evidenceClass: "VERIFIED_BY_TEST",
      createdAt: new Date().toISOString(),
      command: ["node --experimental-strip-types scripts/negative-controls/run.ts", ...process.argv.slice(2)].join(" "),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      ...(matcherPolicy ? { matcherPolicy } : {}),
      source: {
        ...(provenance.head ? { gitHead: provenance.head } : {}),
        ...(provenance.servicesApiDirty === undefined ? {} : { servicesApiUncommittedChanges: provenance.servicesApiDirty }),
        servicesApiSrcSha256: before.src.sha256,
        servicesApiTestSha256: before.test.sha256,
        realTreeUnchanged,
        repositoryStatusUnchanged: repositoryUnchanged,
        changedDuringRun,
        mutationTextInWorkingTree,
      },
      options: {
        jobs: options.jobs,
        typecheck: options.typecheck,
        confirmSurvivorsAgainstWholeSuite: options.confirm,
        timeoutMs: options.timeoutMs,
        ...(options.only ? { only: options.only } : {}),
      },
      baseline: {
        testFiles: allTestFiles.length,
        tests: baselineRun.records.length,
        passed: baselineRun.records.filter((record) => record.status === "pass").length,
        failed: baselineFailing.length,
        skipped: baselineRun.records.filter((record) => record.status === "skip" || record.status === "todo").length,
        green: baselineGreen,
        failingTests: baselineFailing.map(killer),
        ...(baselineTypeErrors ? { typeErrors: baselineTypeErrors.size } : {}),
        durationMs: baselineRun.durationMs,
      },
      killConfirmation: {
        killingTestFilesRerunOnSnapshot: killingFiles.length,
        flakyTestsExcluded: [...flaky].map(scrub).sort(),
      },
      mutations: results,
      summary: {
        total: results.length,
        killed: count("KILLED"),
        survived: count("SURVIVED"),
        stale: count("STALE"),
        invalid: count("INVALID"),
        timeout: count("TIMEOUT"),
        required: { total: required.length, killed: count("KILLED", required) },
        extra: { total: extra.length, killed: count("KILLED", extra) },
        allKilled,
        baselineGreen,
        complete: options.only === undefined,
        survivorIds: ids("SURVIVED"),
        staleIds: ids("STALE"),
        invalidIds: ids("INVALID"),
        timeoutIds: ids("TIMEOUT"),
        exitCode,
        durationMs: Date.now() - started,
      },
      notes: [
        "Every control ran against a temporary copy of services/api taken once at the start (the snapshot); the working tree was never edited.",
        "failingTestCount counts tests that fail under the mutation and did not fail on the unmutated snapshot; only those can kill a control.",
        "Every kill was confirmed: the killing tests were re-run on the unmutated snapshot and passed again; a test that failed there is treated as flaky and never counts.",
        "A control reported SURVIVED left the whole suite as green as the snapshot (unless confirmSurvivorsAgainstWholeSuite is false): its protection has no test.",
        "Test names only; no provider data or vehicle number is read or written by this tool.",
      ],
    };

    const encoded = `${JSON.stringify(report, null, 2)}\n`;
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, encoded);

    console.log("");
    console.log(`negative controls against ${matcherPolicy ?? "an unknown matcher policy"} (${results.length} controls, jobs ${options.jobs})`);
    console.log(`baseline: ${baselineRun.records.length} tests in ${allTestFiles.length} files, ${baselineFailing.length} failing${baselineGreen ? "" : "  <- red baseline: kills are counted only against tests green on it"}`);
    for (const row of results) {
      const where = row.killedIn === "rest-of-suite" ? " (outside listed files)" : "";
      console.log(`  ${row.outcome.padEnd(8)} ${row.id.padEnd(18)} ${String(row.failingTestCount).padStart(4)} new failure(s)${where}  ${seconds(row.durationMs)}`);
    }
    console.log(`summary: ${count("KILLED")} killed, ${count("SURVIVED")} survived, ${count("STALE")} stale, ${count("INVALID")} invalid, ${count("TIMEOUT")} timeout`);
    if (mutationTextInWorkingTree.length > 0) {
      console.log(`a control's edit is present in the working tree: ${mutationTextInWorkingTree.join("; ")}`);
    } else if (!realTreeUnchanged) {
      console.log(`services/api changed during the run (${changedDuringRun.join(", ")}), and no control's edit is present in it:`
        + " another process edited the tree; the results describe the snapshot recorded by hash, so rerun on a quiet tree");
    }
    console.log(`report: ${path.relative(process.cwd(), outPath) || outPath}`);
    console.log(`exit ${exitCode}`);
    return exitCode;
  } finally {
    if (options.keepTemp) process.stderr.write(`temporary copies kept at ${workspace}\n`);
    else await rm(workspace, { recursive: true, force: true });
  }
}

function survivorReason(control: NegativeControl, result: ControlResult, wholeSuite: boolean): string {
  const scope = wholeSuite ? "the whole suite" : "the listed test files";
  if (control.mustBeKilledBy && result.failingTestCount > 0) {
    return `${result.failingTestCount} other test(s) fail, but none of the required ${JSON.stringify(control.mustBeKilledBy)} did across ${scope}`;
  }
  return `no test newly fails across ${scope}: "${control.protection}" has no test`;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  return 2;
});

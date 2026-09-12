import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { TagoTransitProvider } from "../../services/api/src/tagoProvider.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "../../services/api/src/serviceKey.ts";
import { analyzeRideCapture, type RideCapture } from "../../services/api/src/rideCapture.ts";
import { RIDE_CAPTURE_COMMANDS, describeStops, startRideCapture } from "../../services/api/src/rideCaptureRunner.ts";

const [routeId, cityCode, boardingRaw, destinationRaw] = process.argv.slice(2);
const boardingStopSequence = Number(boardingRaw);
const destinationStopSequence = Number(destinationRaw);

if (!routeId || !cityCode || !Number.isInteger(boardingStopSequence) || !Number.isInteger(destinationStopSequence)) {
  console.error([
    "Usage: node --experimental-strip-types scripts/ride-capture/capture.ts <official-route-id> <official-city-code> <boarding-seq> <destination-seq>",
    "Environment: RIDE_CAPTURE_INTERVAL_MS=5000 RIDE_CAPTURE_MAX_SNAPSHOTS=720 RIDE_CAPTURE_MAX_MINUTES=90",
    "Run with: env -u TAGO_SERVICE_KEY node --env-file=.env.local --experimental-strip-types scripts/ride-capture/capture.ts …",
    "  (env -u clears an exported copy of the name so the value in .env.local is the one used)",
    `Commands while running: ${RIDE_CAPTURE_COMMANDS}`,
    "Output: work/rides/<timestamp>.json (ignored; contains raw vehicle numbers) and a sanitized .report.json",
  ].join("\n"));
  process.exit(2);
}

const workDirectory = path.resolve(process.cwd(), "work", "rides");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const capturePath = path.join(workDirectory, `${routeId}-${stamp}.json`);
const reportPath = path.join(workDirectory, `${routeId}-${stamp}.report.json`);
// The same resolver the service uses, so the "never write the credential"
// guard below still recognises a key supplied under the deprecated local name.
const resolvedKey = resolveTagoServiceKey(process.env);
const serviceKey = resolvedKey.key;
const keyWarning = serviceKeyWarning(resolvedKey);
if (keyWarning) console.error(`[${new Date().toISOString()}] ${keyWarning}`);
await warnOnLooseEnvPermissions();

async function persist(capture: RideCapture): Promise<void> {
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  const encoded = JSON.stringify(capture, null, 2);
  if (serviceKey && encoded.includes(serviceKey)) throw new Error("Capture contains credential; refusing to write");
  const temporary = `${capturePath}.tmp`;
  await writeFile(temporary, encoded, { mode: 0o600 });
  await rename(temporary, capturePath);
}

try {
  const provider = new TagoTransitProvider();
  const controller = startRideCapture({
    provider,
    routeId,
    cityCode,
    boardingStopSequence,
    destinationStopSequence,
    intervalMs: positiveInteger(process.env.RIDE_CAPTURE_INTERVAL_MS, 5_000),
    maxSnapshots: positiveInteger(process.env.RIDE_CAPTURE_MAX_SNAPSHOTS, 720),
    maxDurationMs: positiveInteger(process.env.RIDE_CAPTURE_MAX_MINUTES, 90) * 60_000,
    persist,
    log: (line) => console.error(`[${new Date().toISOString()}] ${line}`),
  });

  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    try {
      controller.command(line);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  });
  process.once("SIGINT", () => {
    console.error("finishing the capture; everything so far is already on disk. Press Ctrl+C again to abort now.");
    controller.command("q");
  });

  const capture = await controller.done;
  input.close();
  console.error(`stops:\n${describeStops(capture.stops)}`);
  const report = analyzeRideCapture(capture);
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.error(`capture saved: ${path.relative(process.cwd(), capturePath)}`);
  console.error(`sanitized report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  console.error(JSON.stringify({
    ok: false,
    code: code ?? "RIDE_CAPTURE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    hint: code === "BLOCKED_BY_CREDENTIALS"
      ? "Load TAGO_SERVICE_KEY from ignored .env.local. Never commit the key."
      : undefined,
  }));
  process.exit(1);
}

/**
 * The Python probe refuses to read a world-readable `.env.local`. Node's
 * `--env-file` does not check, so say so rather than letting a loose key pass
 * unnoticed; this is a warning because refusing here would strand a ride.
 */
async function warnOnLooseEnvPermissions(): Promise<void> {
  try {
    const info = await stat(path.resolve(process.cwd(), ".env.local"));
    if (info.mode & 0o077) {
      console.error(`[${new Date().toISOString()}] .env.local is readable by other users; run: chmod 600 .env.local`);
    }
  } catch {
    // No local env file: the credential came from the shell, or there is none.
  }
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

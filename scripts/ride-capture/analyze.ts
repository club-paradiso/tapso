import { readFile } from "node:fs/promises";
import { analyzeRideCapture, type RideCapture } from "../../services/api/src/rideCapture.ts";

const capturePath = process.argv[2];
if (!capturePath) {
  console.error("Usage: node --experimental-strip-types scripts/ride-capture/analyze.ts work/rides/<capture>.json");
  process.exit(2);
}

try {
  const capture = JSON.parse(await readFile(capturePath, "utf8")) as RideCapture;
  console.log(JSON.stringify(analyzeRideCapture(capture), null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}

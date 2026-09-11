import { TagoTransitProvider } from "../../services/api/src/tagoProvider.ts";
import { analyzeTransitValidation, type TransitValidationSample } from "../../services/api/src/liveValidation.ts";

const routeId = process.argv[2];
const cityCode = process.argv[3];
const sampleCount = positiveInteger(process.env.TRANSIT_SPIKE_SAMPLES, 12);
const intervalMs = positiveInteger(process.env.TRANSIT_SPIKE_INTERVAL_MS, 5_000);

if (!routeId || !cityCode) {
  console.error([
    "Usage: node --experimental-strip-types scripts/transit-spike/run.ts <official-route-id> <official-city-code>",
    "Environment: TRANSIT_SPIKE_SAMPLES=12 TRANSIT_SPIKE_INTERVAL_MS=5000",
    "Example: TRANSIT_SPIKE_SAMPLES=60 TRANSIT_SPIKE_INTERVAL_MS=5000 env -u PUBLIC_DATA_SERVICE_KEY node --env-file=.env.local --experimental-strip-types scripts/transit-spike/run.ts '<official-route-id>' '<official-city-code>'",
  ].join("\n"));
  process.exit(2);
}

try {
  const provider = new TagoTransitProvider();
  const stops = await provider.stops({ routeId, cityCode });
  const samples: TransitValidationSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const capturedAt = new Date().toISOString();
    const vehicles = await provider.vehicles({ routeId, cityCode });
    samples.push({ capturedAt, vehicles });
    console.error(`sample ${index + 1}/${sampleCount}: ${vehicles.length} vehicles at ${capturedAt}`);
    if (index + 1 < sampleCount) await sleep(intervalMs);
  }

  const report = analyzeTransitValidation(samples, stops);
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    routeId,
    cityCode,
    configuration: { sampleCount, intervalMs },
    stops,
    samples,
    report,
  }, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  console.error(JSON.stringify({
    ok: false,
    code: code ?? "SPIKE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    hint: code === "BLOCKED_BY_CREDENTIALS"
      ? "Set PUBLIC_DATA_SERVICE_KEY in the shell environment. Never commit the key."
      : undefined,
  }));
  process.exit(1);
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

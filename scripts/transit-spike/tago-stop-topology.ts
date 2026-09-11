import { TagoTransitProvider } from "../../services/api/src/tagoProvider.ts";

const cityCode = process.argv[2]?.trim() || "39";
const routeIds = process.argv.slice(3).map((value) => value.trim()).filter(Boolean);
const targets = routeIds.length > 0
  ? routeIds
  : ["JEB405136521", "JEB405136522"];

try {
  const provider = new TagoTransitProvider();
  const results = [];

  for (const routeId of targets) {
    const stops = (await provider.stops({
      routeId,
      standardRegionCode: cityCode,
    })).slice().sort((left, right) => left.sequence - right.sequence);

    const sequences = stops.map((stop) => stop.sequence);
    const uniqueSequences = new Set(sequences);
    const duplicateSequences = sequences.filter((sequence, index) => sequences.indexOf(sequence) !== index);
    const contiguous = sequences.every(
      (sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1,
    );
    const coordinateCount = stops.filter(
      (stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
    ).length;

    results.push({
      routeId,
      cityCode,
      stopCount: stops.length,
      minSequence: sequences.at(0),
      maxSequence: sequences.at(-1),
      contiguous,
      uniqueSequenceCount: uniqueSequences.size,
      duplicateSequences: [...new Set(duplicateSequences)],
      coordinateCoverage: stops.length === 0 ? 0 : coordinateCount / stops.length,
      firstStop: stops.at(0) ? {
        sequence: stops[0]!.sequence,
        stopId: stops[0]!.stopId,
        name: stops[0]!.name,
      } : undefined,
      lastStop: stops.at(-1) ? {
        sequence: stops.at(-1)!.sequence,
        stopId: stops.at(-1)!.stopId,
        name: stops.at(-1)!.name,
      } : undefined,
      sampleStops: stops.slice(0, 3).map((stop) => ({
        sequence: stop.sequence,
        stopId: stop.stopId,
        name: stop.name,
      })),
    });
  }

  console.log(JSON.stringify({
    ok: true,
    provider: "tago",
    cityCode,
    results,
  }, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  console.error(JSON.stringify({
    ok: false,
    code: code ?? "TAGO_TOPOLOGY_FAILED",
    message: error instanceof Error ? error.message : String(error),
    hint: code === "BLOCKED_BY_CREDENTIALS"
      ? "Load PUBLIC_DATA_SERVICE_KEY from Keychain into the shell environment. Never print the key."
      : undefined,
  }));
  process.exit(1);
}

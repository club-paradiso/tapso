import type { StopOnRoute, VehicleObservation } from "./domain.ts";

export interface TransitValidationSample {
  capturedAt: string;
  vehicles: VehicleObservation[];
}

export interface TransitValidationReport {
  sampleCount: number;
  observationCount: number;
  uniqueVehicleCount: number;
  emptySampleCount: number;
  collectionIntervalSeconds: NumberSummary;
  providerUpdateIntervalSeconds: NumberSummary;
  stopSequenceCoverage: number;
  coordinateCoverage: number;
  directionCoverage: number;
  eventCodeCoverage: number;
  duplicateObservationCount: number;
  outOfOrderObservationCount: number;
  vehicleContinuity: Array<{
    vehicleId: string;
    samplesSeen: number;
    observations: number;
    providerUpdateIntervalSeconds: NumberSummary;
    directionCodes: string[];
    eventCodes: string[];
  }>;
  stopCount?: number;
  stopSequenceContiguous?: boolean;
}

export interface NumberSummary {
  count: number;
  min?: number;
  median?: number;
  p95?: number;
  max?: number;
}

export function analyzeTransitValidation(
  samples: TransitValidationSample[],
  stops?: StopOnRoute[],
): TransitValidationReport {
  const sortedSamples = [...samples].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const collectionIntervals = positiveDiffSeconds(sortedSamples.map((sample) => sample.capturedAt));
  const allObservations = sortedSamples.flatMap((sample) => sample.vehicles);
  const byVehicle = new Map<string, Array<{ sampleIndex: number; observation: VehicleObservation }>>();

  sortedSamples.forEach((sample, sampleIndex) => {
    for (const observation of sample.vehicles) {
      const bucket = byVehicle.get(observation.vehicleId) ?? [];
      bucket.push({ sampleIndex, observation });
      byVehicle.set(observation.vehicleId, bucket);
    }
  });

  let duplicateObservationCount = 0;
  let outOfOrderObservationCount = 0;
  const providerIntervals: number[] = [];
  const vehicleContinuity = [...byVehicle.entries()].map(([vehicleId, entries]) => {
    const sorted = [...entries].sort((a, b) => a.sampleIndex - b.sampleIndex);
    const uniqueProviderTimes: string[] = [];
    let previousProviderTime = Number.NEGATIVE_INFINITY;
    let previousSignature: string | undefined;
    const sampleIndexes = new Set<number>();
    const directionCodes = new Set<string>();
    const eventCodes = new Set<string>();

    for (const entry of sorted) {
      sampleIndexes.add(entry.sampleIndex);
      const observation = entry.observation;
      if (observation.directionCode) directionCodes.add(observation.directionCode);
      if (observation.eventCode) eventCodes.add(observation.eventCode);
      const providerTime = Date.parse(observation.observedAt);
      const signature = observationSignature(observation);
      if (signature === previousSignature) duplicateObservationCount += 1;
      previousSignature = signature;
      if (Number.isFinite(providerTime)) {
        if (providerTime < previousProviderTime) outOfOrderObservationCount += 1;
        previousProviderTime = Math.max(previousProviderTime, providerTime);
        if (uniqueProviderTimes.at(-1) !== observation.observedAt) uniqueProviderTimes.push(observation.observedAt);
      }
    }

    const intervals = positiveDiffSeconds(uniqueProviderTimes);
    providerIntervals.push(...intervals);
    return {
      vehicleId,
      samplesSeen: sampleIndexes.size,
      observations: entries.length,
      providerUpdateIntervalSeconds: summarize(intervals),
      directionCodes: [...directionCodes].sort(),
      eventCodes: [...eventCodes].sort(),
    };
  }).sort((a, b) => b.samplesSeen - a.samplesSeen || a.vehicleId.localeCompare(b.vehicleId));

  const report: TransitValidationReport = {
    sampleCount: sortedSamples.length,
    observationCount: allObservations.length,
    uniqueVehicleCount: byVehicle.size,
    emptySampleCount: sortedSamples.filter((sample) => sample.vehicles.length === 0).length,
    collectionIntervalSeconds: summarize(collectionIntervals),
    providerUpdateIntervalSeconds: summarize(providerIntervals),
    stopSequenceCoverage: coverage(allObservations, (value) => value.stopSequence !== undefined),
    coordinateCoverage: coverage(allObservations, (value) => value.latitude !== undefined && value.longitude !== undefined),
    directionCoverage: coverage(allObservations, (value) => Boolean(value.directionCode)),
    eventCodeCoverage: coverage(allObservations, (value) => Boolean(value.eventCode)),
    duplicateObservationCount,
    outOfOrderObservationCount,
    vehicleContinuity,
  };

  if (stops) {
    const sequences = stops.map((stop) => stop.sequence).filter(Number.isFinite).sort((a, b) => a - b);
    report.stopCount = stops.length;
    report.stopSequenceContiguous = sequences.every((sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1);
  }
  return report;
}

function coverage<T>(values: T[], predicate: (value: T) => boolean): number {
  if (values.length === 0) return 0;
  return Math.round((values.filter(predicate).length / values.length) * 10_000) / 10_000;
}

function positiveDiffSeconds(timestamps: string[]): number[] {
  const values = timestamps.map(Date.parse).filter(Number.isFinite);
  const result: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const delta = (values[index]! - values[index - 1]!) / 1_000;
    if (delta > 0) result.push(delta);
  }
  return result;
}

function summarize(values: number[]): NumberSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0 };
  return {
    count: sorted.length,
    min: round(sorted[0]!),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function observationSignature(observation: VehicleObservation): string {
  return JSON.stringify([
    observation.vehicleId,
    observation.observedAt,
    observation.stopSequence,
    observation.directionCode,
    observation.latitude,
    observation.longitude,
    observation.eventCode,
  ]);
}

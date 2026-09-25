/**
 * Passive Shadow Validation v3 — one call from streams to summary.
 *
 * streams → validate → generate cases (answer into the vault) → blind replay of
 * every case → reveal and classify → perturb a deterministic subset → summary.
 * One observation stream feeds every case on its route; nothing here reads a
 * provider.
 */

import { validatePassiveStream, generatePassiveCases, type GeneratedCases, type PassiveCase, type PassiveCaseGeneratorPolicy, type PassiveObservationStream } from "./passiveShadow.ts";
import { evaluatePassiveCase, type PassiveCaseResult, type ReplayFunction } from "./passiveShadowEvaluate.ts";
import { evaluatePerturbations, type Perturbation, type PerturbedResult } from "./passiveShadowPerturb.ts";
import { buildPassiveShadowSummary, type PassiveShadowSummary } from "./passiveShadowSummary.ts";

export interface PipelineOptions {
  policy?: PassiveCaseGeneratorPolicy;
  replay?: ReplayFunction;
  perturbations?: readonly Perturbation[];
  /** Upper bound on unperturbed cases the adversarial families are run over. */
  maxPerturbationCases?: number;
  createdAt?: string;
}

export interface PipelineOutput {
  generated: GeneratedCases;
  results: PassiveCaseResult[];
  perturbed: Array<{ baseline: PassiveCaseResult; variants: PerturbedResult[] }>;
  summary: PassiveShadowSummary;
}

export function runPassiveShadowPipeline(streams: PassiveObservationStream[], options: PipelineOptions = {}): PipelineOutput {
  for (const stream of streams) validatePassiveStream(stream);
  const generated = generatePassiveCases(streams, { ...(options.policy ? { policy: options.policy } : {}) });
  const results = generated.cases.map((passiveCase) => evaluatePassiveCase(passiveCase, generated.vault, {
    ...(options.replay ? { replay: options.replay } : {}),
  }));
  const byId = new Map(results.map((result) => [result.caseId, result]));
  const basis = perturbationBasis(generated.cases, options.maxPerturbationCases ?? 300);
  const perturbed = basis.map((passiveCase) => ({
    baseline: byId.get(passiveCase.meta.caseId)!,
    variants: evaluatePerturbations(passiveCase, generated.vault, {
      ...(options.replay ? { replay: options.replay } : {}),
      ...(options.perturbations ? { perturbations: options.perturbations } : {}),
    }),
  }));
  const summary = buildPassiveShadowSummary({
    streams,
    generated,
    results,
    perturbed,
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  return { generated, results, perturbed, summary };
}

/**
 * One `WAIT_AT_STOP` case per boarding event (the middle start), then an even
 * stride down to the cap. Deterministic, and independent of any result.
 */
export function perturbationBasis(cases: PassiveCase[], cap: number): PassiveCase[] {
  const byEvent = new Map<string, PassiveCase[]>();
  for (const passiveCase of cases) {
    if (passiveCase.meta.scenario !== "WAIT_AT_STOP") continue;
    const list = byEvent.get(passiveCase.meta.boardingEventId) ?? [];
    list.push(passiveCase);
    byEvent.set(passiveCase.meta.boardingEventId, list);
  }
  const representatives = [...byEvent.keys()].sort().map((key) => {
    const list = byEvent.get(key)!.sort((left, right) => left.meta.sessionStartAt.localeCompare(right.meta.sessionStartAt));
    return list[Math.floor(list.length / 2)]!;
  });
  if (representatives.length <= cap) return representatives;
  const stride = representatives.length / cap;
  return Array.from({ length: cap }, (_, index) => representatives[Math.floor(index * stride)]!);
}

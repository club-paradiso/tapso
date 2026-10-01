/**
 * The negative-control catalogue for the directed matcher and the Passive
 * Shadow evaluation around it.
 *
 * Each control deliberately reintroduces one leakage path or removes one
 * fail-closed rule, as a precise source edit, so that `run.ts` can prove the
 * test suite notices. A control whose edit no longer applies is reported
 * STALE, never skipped: every `find` must occur exactly once in the file it
 * names, so a refactor that moves or deletes the protection makes the control
 * fail loudly instead of passing by doing nothing.
 *
 * Edits are applied only to a temporary copy of `services/api` (see
 * `run.ts`). Nothing here is ever written to the working tree.
 *
 * `catalogue: "required"` marks the controls the matcher-directed-v1 review
 * asked for by id; `"extra"` marks controls added for protections the same
 * code enforces (on-board mirrors, memory carry-over, evidence labelling,
 * pseudonymisation).
 */

export interface SourceEdit {
  /** Repository-relative path of the file to edit. Must be under `services/api/`. */
  file: string;
  /** Exact text that must occur exactly once in the file at the moment the edit is applied. */
  find: string;
  replace: string;
}

export type ControlFamily = "F1" | "F3" | "F4" | "fail-closed" | "legacy-isolation" | "honesty";

export interface NegativeControl {
  id: string;
  family: ControlFamily;
  catalogue: "required" | "extra";
  /** What the edit does, in one sentence. */
  description: string;
  /** The protection the edit removes: what a killing test is evidence of. */
  protection: string;
  /** Applied in order; each `find` is counted on the file as the previous edits left it. */
  edits: SourceEdit[];
  /**
   * Repository-relative test files expected to catch the edit. They are run
   * first; if none of their tests newly fails, `run.ts` runs the rest of the
   * suite before it reports SURVIVED, so a survivor always means the whole
   * suite stayed green.
   */
  testFiles: string[];
  /**
   * Test names of which at least one must newly fail for the control to count
   * as KILLED. For controls that pin one specific guard (the static
   * legacy-import scan), failures elsewhere are recorded but do not count.
   */
  mustBeKilledBy?: string[];
}

const MATCHING = "services/api/src/matching.ts";
const REPLAY = "services/api/src/matchReplay.ts";
const PASSIVE = "services/api/src/passiveShadow.ts";
const EVALUATE = "services/api/src/passiveShadowEvaluate.ts";
const PERTURB = "services/api/src/passiveShadowPerturb.ts";
const SUMMARY = "services/api/src/passiveShadowSummary.ts";
const FRESHNESS = "services/api/src/sourceFreshness.ts";
const SESSION = "services/api/src/journeySession.ts";
const GATE = "services/api/src/matcherSafetyGate.ts";
const LIVE = "services/api/src/liveReplayEvidence.ts";

const T = {
  matching: "services/api/test/matching.test.ts",
  properties: "services/api/test/matcherProperties.test.ts",
  session: "services/api/test/journeySession.test.ts",
  replay: "services/api/test/matchReplay.test.ts",
  passive: "services/api/test/passiveShadow.test.ts",
  freshness: "services/api/test/sourceFreshness.test.ts",
  crossLanguage: "services/api/test/crossLanguageAuthority.test.ts",
  counterfactual: "services/api/test/passiveCounterfactual.test.ts",
  rideCapture: "services/api/test/rideCapture.test.ts",
  gate: "services/api/test/matcherSafetyGate.test.ts",
  liveEvidence: "services/api/test/liveReplayEvidence.test.ts",
} as const;

/** Joins source lines with `\n`, so multi-line anchors keep their exact indentation. */
function lines(...parts: string[]): string {
  return parts.join("\n");
}

/** F1c's edit, shared with F1-unguarded. */
const REMOVE_INVARIANT_ASSERTION: SourceEdit = {
  file: MATCHING,
  find: "  assertDirectedInvariant(request, result, policy);\n",
  replace: "",
};

/** F1's edit, shared with F1-unguarded. */
const SYMMETRIC_WAITING_WINDOW: SourceEdit = {
  file: MATCHING,
  find: "const selectable = offset <= -1 && offset >= -window;",
  replace: "const selectable = Math.abs(offset) >= 1 && Math.abs(offset) <= window;",
};

export const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  /* ------------------------------------------------ F1: departed buses */
  {
    id: "F1",
    family: "F1",
    catalogue: "required",
    description: "classifyRouteProgress makes a waiting rider's bus selectable 1-4 stops on either side of the boarding stop (the legacy symmetric position term).",
    protection: "Directed route progress: a waiting rider's bus is selectable only 1-4 stops before the boarding stop, never past it.",
    edits: [SYMMETRIC_WAITING_WINDOW],
    testFiles: [T.matching, T.properties, T.session, T.replay, T.passive, T.crossLanguage],
  },
  {
    id: "F1-unguarded",
    family: "F1",
    catalogue: "extra",
    description: "F1 with the runtime invariant assertion also removed, so only the tests themselves can notice a departed bus being selected.",
    protection: "The tests assert directed selection behaviour directly, not only through the runtime invariant's throw.",
    edits: [SYMMETRIC_WAITING_WINDOW, REMOVE_INVARIANT_ASSERTION],
    testFiles: [T.matching, T.properties, T.session, T.replay, T.passive, T.crossLanguage],
  },
  {
    id: "F1b",
    family: "F1",
    catalogue: "required",
    description: "The waiting rider's blocking zone is removed: a bus at the boarding stop (offset 0) or one past it (+1) no longer blocks a selection.",
    protection: "Offsets 0 and +1 block every waiting-rider selection (dwelling and departed cannot be told apart).",
    edits: [{
      file: MATCHING,
      find: "const blocks = forward === 0 || backward === 1;",
      replace: "const blocks = false;",
    }],
    testFiles: [T.matching, T.properties, T.session, T.crossLanguage],
  },
  {
    id: "F1b-onboard",
    family: "F1",
    catalogue: "extra",
    description: "The on-board rider's blocking zone is removed: a bus one stop before the boarding stop (-1) or at it (0) no longer blocks.",
    protection: "Offsets -1 and 0 block every on-board selection (the mirror of the waiting rule).",
    edits: [{
      file: MATCHING,
      find: "const blocks = backward === 0 || forward === 1;",
      replace: "const blocks = false;",
    }],
    testFiles: [T.matching, T.properties, T.session, T.crossLanguage],
  },
  {
    id: "F1c",
    family: "F1",
    catalogue: "required",
    description: "decide() no longer calls assertDirectedInvariant before returning a result.",
    protection: "The formal directed invariant is enforced at runtime on every matcher result. Behaviourally invisible while the rules hold, so only a static test can catch it.",
    edits: [REMOVE_INVARIANT_ASSERTION],
    testFiles: [T.matching, T.properties, T.crossLanguage],
  },

  /* ----------------------------------------- F3: ground-truth leakage */
  {
    id: "F3a",
    family: "F3",
    catalogue: "required",
    description: "replayMatching derives the request direction from the boarded vehicle's first observed directionCode (the original rideDirectionCode leak) whenever no direction was declared.",
    protection: "Only a direction the rider's session declared may constrain the replay; the boarded vehicle's identity never shapes a replayed decision.",
    edits: [{
      file: REPLAY,
      find: "declaredDirectionCode: options.declaredDirectionCode,",
      replace: lines(
        "declaredDirectionCode: options.declaredDirectionCode ?? [...(capture.snapshots ?? [])]",
        "      .filter((snapshot) => !snapshot.error)",
        "      .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))",
        "      .flatMap((snapshot) => snapshot.vehicles)",
        "      .find((vehicle) => vehicle.vehicleId === options.boardedVehicleId?.trim() && Boolean(vehicle.directionCode))",
        "      ?.directionCode,",
      ),
    }],
    testFiles: [T.replay, T.properties, T.passive, T.rideCapture],
  },
  {
    id: "F3b",
    family: "F3",
    catalogue: "required",
    description: "generatePassiveCases writes boardedVehicleId (the ground-truth vehicle) into every PassiveMatcherInput.",
    protection: "The matcher input carries only the blind fields; the answer lives only in the GroundTruthVault.",
    edits: [{
      file: PASSIVE,
      find: lines(
        "          snapshots: window.map(copySnapshot),",
        "          markers: [],",
      ),
      replace: lines(
        "          snapshots: window.map(copySnapshot),",
        "          markers: [],",
        "          // Negative control F3b: the answer written into the matcher input.",
        "          ...({ boardedVehicleId: crossing.vehicleId } as object),",
      ),
    }],
    testFiles: [T.passive],
  },
  {
    id: "F3b-order",
    family: "F3",
    catalogue: "extra",
    description: "generatePassiveCases moves the ground-truth vehicle to the front of every window snapshot, so the first-appearance pseudonym C1 always names the answer.",
    protection: "Window snapshots are verbatim provider snapshots in provider order; pseudonyms derived from the input cannot encode the answer.",
    edits: [{
      file: PASSIVE,
      find: "snapshots: window.map(copySnapshot),",
      replace: lines(
        "snapshots: window.map(copySnapshot).map((snapshot) => ({",
        "            ...snapshot,",
        "            // Negative control F3b-order: the answer moved to the front of every snapshot.",
        "            vehicles: [...snapshot.vehicles].sort((left, right) =>",
        "              Number(right.vehicleId === crossing.vehicleId) - Number(left.vehicleId === crossing.vehicleId)),",
        "          })),",
      ),
    }],
    testFiles: [T.passive],
  },
  {
    id: "F3-guard-input",
    family: "F3",
    catalogue: "extra",
    description: "assertBlindMatcherInput no longer refuses a matcher input that carries a field outside BLIND_INPUT_KEYS.",
    protection: "The structural anti-leak guard: a matcher input with any non-blind field is refused before replay.",
    edits: [{
      file: PASSIVE,
      find: 'if (!BLIND_INPUT_KEYS.has(key)) throw new GroundTruthLeakError(`matcher input carries non-blind field "${key}"`);',
      replace: "{ /* Negative control F3-guard-input: a non-blind input field is no longer refused. */ }",
    }],
    testFiles: [T.passive],
  },
  {
    id: "F3-guard-snapshot",
    family: "F3",
    catalogue: "extra",
    description: "assertBlindMatcherInput no longer refuses a snapshot annotated with a field outside capturedAt / vehicles / error.",
    protection: "The structural anti-leak guard: a snapshot carrying any annotation (such as the answer) is refused before replay.",
    edits: [{
      file: PASSIVE,
      find: 'if (!BLIND_SNAPSHOT_KEYS.has(key)) throw new GroundTruthLeakError(`snapshot carries non-blind field "${key}"`);',
      replace: "{ /* Negative control F3-guard-snapshot: an annotated snapshot is no longer refused. */ }",
    }],
    testFiles: [T.passive],
  },
  {
    id: "F3c",
    family: "F3",
    catalogue: "required",
    description: "evaluatePassiveCase opens the vault before the replay and passes the revealed vehicle to it as boardedVehicleId.",
    protection: "The replay never receives the answer, and the vault opens only after every decision has been made.",
    edits: [
      {
        file: EVALUATE,
        find: "  const truth = vault.reveal(meta.caseId);\n",
        replace: "",
      },
      {
        file: EVALUATE,
        find: "  const evidence = replay(toBlindCapture(input), {\n",
        replace: lines(
          "  // Negative control F3c: the vault is opened first and the answer handed to the replay.",
          "  const truth = vault.reveal(meta.caseId);",
          "  const evidence = replay(toBlindCapture(input), {",
          "    boardedVehicleId: truth.vehicleId,",
          "",
        ),
      },
    ],
    testFiles: [T.passive],
  },
  {
    id: "F3c-pass",
    family: "F3",
    catalogue: "extra",
    description: "evaluatePassiveCase hands the answer to the replay as boardedVehicleId, read through vault.export() so the vault's reveal bookkeeping still looks clean.",
    protection: "The replay options never carry boardedVehicleId, however the evaluator obtained it.",
    edits: [{
      file: EVALUATE,
      find: "  const evidence = replay(toBlindCapture(input), {\n",
      replace: lines(
        "  const evidence = replay(toBlindCapture(input), {",
        "    // Negative control F3c-pass: the answer read around the vault's bookkeeping.",
        "    boardedVehicleId: vault.export().find((row) => row.caseId === meta.caseId)?.vehicleId,",
        "",
      ),
    }],
    testFiles: [T.passive],
  },
  {
    id: "F3d",
    family: "F3",
    catalogue: "required",
    description: "replayBlind gains a boardedVehicleId option and resolves every ambiguous decision in which the boarded vehicle is individually eligible in its favour.",
    protection: "replayBlind has no channel for the answer; the boarded vehicle's identity never changes a replayed decision.",
    edits: [
      {
        file: REPLAY,
        find: 'options: Pick<ReplayOptions, "riderState" | "declaredDirectionCode" | "matcher" | "matcherPolicy"> = {},',
        replace: 'options: Pick<ReplayOptions, "riderState" | "declaredDirectionCode" | "matcher" | "matcherPolicy" | "boardedVehicleId"> = {},',
      },
      {
        file: REPLAY,
        find: lines(
          "      at: snapshot.capturedAt,",
          "      result,",
        ),
        replace: lines(
          "      at: snapshot.capturedAt,",
          "      // Negative control F3d: an ambiguous decision in which the boarded vehicle",
          "      // is individually eligible is resolved in its favour.",
          '      result: result.status === "ambiguous" && options.boardedVehicleId !== undefined',
          "        && result.ranked.some((row) => row.vehicleId === options.boardedVehicleId && row.rejectedReasons.length === 0)",
          '        ? { ...result, status: "matched" as const, selectedVehicleId: options.boardedVehicleId }',
          "        : result,",
        ),
      },
      {
        file: REPLAY,
        find: "const blind = replayBlind(capture, {",
        replace: lines(
          "const blind = replayBlind(capture, {",
          "    boardedVehicleId: options.boardedVehicleId?.trim() || undefined,",
        ),
      },
    ],
    testFiles: [T.replay, T.properties, T.passive, T.rideCapture],
  },

  /* --------------------------------------- F4: session passage memory */
  {
    id: "F4",
    family: "F4",
    catalogue: "required",
    description: "rememberPassage never sets the waiting session's withheld memory when a bus is seen at or crossing the boarding stop.",
    protection: "Once any bus has been seen at or crossing the boarding stop during a waiting session, no bus is ever selected automatically in that session.",
    edits: [{
      file: MATCHING,
      find: '        withhold("boarding_stop_reached_during_session");\n      }\n      // Round a loop, seen again',
      replace: "        { /* Negative control F4: a bus at or crossing the boarding stop no longer withholds the session. */ }\n      }\n      // Round a loop, seen again",
    }],
    testFiles: [T.matching, T.properties, T.session, T.replay],
  },
  {
    id: "F4-unobserved",
    family: "F4",
    catalogue: "extra",
    description: "A vehicle that left the feed and the memory window while it could have reached the boarding stop no longer withholds the waiting session.",
    protection: "A bus that may have reached the stop unobserved withholds the waiting session, as a seen arrival would.",
    edits: [{
      file: MATCHING,
      find: 'if (toStop !== undefined && toStop <= reachAfter(unseenSeconds)) withhold("vehicle_may_have_reached_boarding_stop_unobserved");',
      replace: "if (toStop !== undefined && toStop <= reachAfter(unseenSeconds)) { /* Negative control F4-unobserved: a possible unobserved arrival no longer withholds. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session, T.replay],
  },
  {
    id: "F4-carry",
    family: "F4",
    catalogue: "extra",
    description: "rememberPassage forgets a withheld memory handed in from the previous decision.",
    protection: "A withheld passage memory is set once and never cleared by any later snapshot.",
    edits: [{
      file: MATCHING,
      find: "let withheld = prior?.withheld;",
      replace: 'let withheld: PassageMemory["withheld"] = undefined;',
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "F4-onboard-late",
    family: "F4",
    catalogue: "extra",
    description: "On board, a bus seen two or more stops before the boarding stop during the session is no longer excluded when it later passes the stop.",
    protection: "A bus that reached the stop after the rider said they had boarded is never theirs: neither selectable nor a competitor.",
    edits: [{
      file: MATCHING,
      find: 'excluded.set(vehicleId, excluded.get(vehicleId) ?? "reached_boarding_stop_after_rider_boarded");',
      replace: "{ /* Negative control F4-onboard-late: a bus seen before the stop is no longer excluded. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "F4-onboard-left",
    family: "F4",
    catalogue: "extra",
    description: "On board, a bus seen inside the on-board window and later beyond it no longer withholds the session.",
    protection: "A bus leaving the on-board window (possibly with the rider) withholds every later on-board selection.",
    edits: [{
      file: MATCHING,
      find: "      if (left || neverPlaced) {",
      replace: "      if ((left && Number.isNaN(0)) || neverPlaced) {",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "F4-onboard-roster",
    family: "F4",
    catalogue: "extra",
    description: "On board, a vehicle absent from the session's first snapshot can be selected again.",
    protection: "A bus missing from the feed when the rider said they had boarded cannot be shown to be theirs, so it is never selected.",
    edits: [{
      file: MATCHING,
      find: 'if (riderState === "on_board" && !initial.includes(vehicleId)) unproven.set(vehicleId, "not_present_when_rider_boarded");',
      replace: "{ /* Negative control F4-onboard-roster: vehicles absent when the rider boarded are no longer excluded. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },

  /* ------------------------------------------------ fail-closed rules */
  {
    id: "M-memory",
    family: "fail-closed",
    catalogue: "required",
    description: "decide() ignores recentlySeen: a vehicle absent from this snapshot no longer competes from memory.",
    protection: "A vehicle seen inside the evidence window but missing from this poll still blocks and competes; dropping a row never raises certainty.",
    edits: [{
      file: MATCHING,
      find: "const remembered: Remembered[] = (request.recentlySeen ?? [])",
      replace: "const remembered: Remembered[] = ([] as VehicleObservation[])",
    }],
    testFiles: [T.matching, T.properties, T.session, T.replay],
  },
  {
    id: "M-memory-reach",
    family: "fail-closed",
    catalogue: "extra",
    description: "A remembered vehicle is judged only where it was last seen, not at every stop it could have reached since.",
    protection: "A vehicle missing from the feed is assumed to keep moving: it blocks or competes from any position it may have reached inside the memory window.",
    edits: [{
      file: MATCHING,
      find: "const reach = Math.min(walkLimit, 1 + Math.floor(Math.min(ageSeconds, ageLimitSeconds) / policy.rememberedSecondsPerStop));",
      replace: "const reach = 0;",
    }],
    testFiles: [T.matching, T.properties, T.session, T.replay],
  },
  {
    id: "M-stale-compete",
    family: "fail-closed",
    catalogue: "extra",
    description: "For a waiting rider, only individually selectable (fresh, right-direction) vehicles count against the leader; a stale or aging bus ahead, or close behind, no longer withholds.",
    protection: "Non-fresh vehicles still compete: a leading bus stuck at a light does not stop being the first to arrive.",
    edits: [{
      file: MATCHING,
      find: "          .filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && !passage.excluded.has(row.ranked.vehicleId))",
      replace: "          .filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && !passage.excluded.has(row.ranked.vehicleId) && row.selectable)",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "M-stale-compete-onboard",
    family: "fail-closed",
    catalogue: "extra",
    description: "For an on-board rider, only individually selectable vehicles count as a second bus in the on-board window.",
    protection: "The on-board mirror: a non-fresh second bus in the window still makes the decision ambiguous.",
    edits: [{
      file: MATCHING,
      find: ".filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && row.facts.competes)",
      replace: ".filter((row) => row.ranked.vehicleId !== leader.ranked.vehicleId && row.facts.competes && row.selectable)",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "M-fresh",
    family: "fail-closed",
    catalogue: "required",
    description: "assess() admits a receipt-timed (TAGO) candidate on any cadence state, not only fresh.",
    protection: "A TAGO candidate is selectable only on a fresh server-observed cadence.",
    edits: [{
      file: MATCHING,
      find: '} else if (trustedFreshness.state === "fresh") {',
      replace: '} else if (["fresh", "aging", "stale", "unknown"].includes(trustedFreshness.state)) {',
    }],
    testFiles: [T.matching, T.properties, T.session, T.replay, T.passive],
  },
  {
    id: "M-content",
    family: "fail-closed",
    catalogue: "required",
    description: "classifyTagoCadenceFreshness never returns aging, so repeated unchanged provider content is classified fresh.",
    protection: "Receipt time alone never manufactures freshness: unchanged content is at most aging.",
    edits: [{
      file: FRESHNESS,
      find: "if (contentChangeCount === 0) {",
      replace: "if (contentChangeCount < 0) {",
    }],
    testFiles: [T.freshness, T.properties, T.session, T.replay, T.passive],
  },
  {
    id: "M-regress",
    family: "fail-closed",
    catalogue: "required",
    description: "classifyTagoCadenceFreshness ignores stop-sequence decreases.",
    protection: "A backward move in provider stop sequence inside the window fails closed (stale).",
    edits: [{
      file: FRESHNESS,
      find: "if (sequenceDecreaseCount > 0) {",
      replace: "if (sequenceDecreaseCount < 0) {",
    }],
    testFiles: [T.freshness, T.properties, T.session, T.replay],
  },
  {
    id: "M-error",
    family: "fail-closed",
    catalogue: "required",
    description: "replayBlind keeps failed snapshots, so every provider error becomes a decision point.",
    protection: "A failed provider poll is never counted as a decision or as healthy evidence.",
    edits: [{
      file: REPLAY,
      find: lines(
        "    .filter((snapshot) => !snapshot.error)",
        "    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));",
        "  const boardingStop = (capture.stops ?? []).find((stop) => stop.sequence === capture.boardingStopSequence);",
      ),
      replace: lines(
        "    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));",
        "  const boardingStop = (capture.stops ?? []).find((stop) => stop.sequence === capture.boardingStopSequence);",
      ),
    }],
    testFiles: [T.replay, T.properties, T.passive, T.rideCapture],
  },
  {
    id: "M-margin",
    family: "fail-closed",
    catalogue: "required",
    description: "DIRECTED_MATCHER_POLICY_V1.marginStops is set to 1, so any follower behind the leader is clear of it.",
    protection: "The leader needs a three-stop lead over every other vehicle heading for the stop; two stops of separation is withheld.",
    edits: [{
      file: MATCHING,
      find: "marginStops: 3,",
      replace: "marginStops: 1,",
    }],
    testFiles: [T.matching, T.properties, T.session, T.crossLanguage],
  },
  {
    id: "M-topology",
    family: "fail-closed",
    catalogue: "required",
    description: "A request without the route's stops is treated as verified topology (no route_topology_unverified abstention).",
    protection: "Without the route's stops, automatic selection is withheld.",
    edits: [{
      file: MATCHING,
      find: 'abstentions.add("route_topology_unverified");',
      replace: "{ /* Negative control M-topology: missing stops are treated as verified. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "M-repeat",
    family: "fail-closed",
    catalogue: "required",
    description: "A boarding stop whose id or name repeats on the route no longer withholds selection.",
    protection: "A repeated boarding stop (a route that passes the same place twice) withholds automatic selection.",
    edits: [{
      file: MATCHING,
      find: 'if (topology.boardingStopRepeats) abstentions.add("boarding_stop_repeats_on_route");',
      replace: "{ /* Negative control M-repeat: a repeated boarding stop no longer withholds. */ }",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "M-unknown",
    family: "fail-closed",
    catalogue: "extra",
    description: "A right-route vehicle with no usable or an off-route stop sequence no longer withholds selection.",
    protection: "Unknown route progress blocks: coordinates alone cannot say which side of the stop a bus is on.",
    edits: [{
      file: MATCHING,
      find: 'abstentions.add("candidate_route_progress_unknown");',
      replace: "{ /* Negative control M-unknown: unknown route progress no longer withholds. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "M-onboard",
    family: "fail-closed",
    catalogue: "required",
    description: "An on-board rider's selection no longer requires the vehicle to be the only one of the route in the on-board window.",
    protection: "On board, the selected vehicle must be the unique vehicle 1-4 stops past the boarding stop.",
    edits: [{
      file: MATCHING,
      find: 'if (competitors.length > 0) abstentions.add("multiple_vehicles_in_on_board_window");',
      replace: "{ /* Negative control M-onboard: on-board uniqueness is no longer required. */ }",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },

  /* ------------------------------------------------- legacy isolation */
  {
    id: "M-legacy-import",
    family: "legacy-isolation",
    catalogue: "required",
    description: "journeySession.ts imports matchVehicleLegacySymmetricV0 and serves it to journey sessions in place of the directed matcher.",
    protection: "No production module reaches matchingLegacy.ts (the static import-graph scan).",
    edits: [
      {
        file: SESSION,
        find: '  type PositionFacts,\n} from "./matching.ts";\n',
        replace: lines(
          "  type PositionFacts,",
          '} from "./matching.ts";',
          'import { matchVehicleLegacySymmetricV0 } from "./matchingLegacy.ts";',
          "",
        ),
      },
      {
        file: SESSION,
        find: "const result = matchVehicleWithSourceFreshness({",
        replace: "const result = matchVehicleLegacySymmetricV0({",
      },
    ],
    testFiles: [T.matching, T.session, T.properties],
    mustBeKilledBy: ["no serving module reaches the legacy matcher; its one offline comparison module is imported by nothing in src/ or api/"],
  },

  /* -------------------------------------------- evidence honesty */
  {
    id: "H-perturb-live",
    family: "honesty",
    catalogue: "extra",
    description: "evaluatePerturbations labels each variant with its base case's source class instead of SYNTHETIC_OR_PERTURBED, so a perturbed live case reads as LIVE_PASSIVE.",
    protection: "Anything derived from a real stream by transformation is SYNTHETIC_OR_PERTURBED, never LIVE_PASSIVE.",
    edits: [{
      file: PERTURB,
      find: 'sourceClass: "SYNTHETIC_OR_PERTURBED",',
      replace: "sourceClass: passiveCase.meta.sourceClass,",
    }],
    testFiles: [T.passive],
  },
  {
    id: "H-truth-flag",
    family: "honesty",
    catalogue: "extra",
    description: "disappear_ground_truth_60s_before_boarding declares usesTruthIdentity: false although it removes the ground-truth bus by identity.",
    protection: "A perturbation that used the answer's identity to build its input says so (usesTruthIdentity).",
    edits: [{
      file: PERTURB,
      find: lines(
        '    id: "disappear_ground_truth_60s_before_boarding",',
        '    family: "vehicle_disappearance",',
        "    usesTruthIdentity: true,",
      ),
      replace: lines(
        '    id: "disappear_ground_truth_60s_before_boarding",',
        '    family: "vehicle_disappearance",',
        "    usesTruthIdentity: false,",
      ),
    }],
    testFiles: [T.passive],
  },
  {
    id: "H-live-guard",
    family: "honesty",
    catalogue: "extra",
    description: "summarizeLive no longer refuses synthetic or perturbed results.",
    protection: "Only unperturbed LIVE_PASSIVE results may enter the live section.",
    edits: [{
      file: SUMMARY,
      find: 'if (result.sourceClass !== "LIVE_PASSIVE" || result.perturbation !== undefined) {',
      replace: "if (false) {",
    }],
    testFiles: [T.passive],
  },
  {
    id: "H-raw-ids",
    family: "honesty",
    catalogue: "extra",
    description: "Summary pseudonyms become the raw vehicle ids, and the summary's runtime refusal (assertNoRawVehicleIds) is removed.",
    protection: "Raw vehicle ids never appear in a summary; the tests check the output themselves, not only through the runtime refusal.",
    edits: [
      {
        file: SUMMARY,
        find: 'pseudonym: (vehicleId: string) => pseudonyms.get(vehicleId) ?? (vehicleId.startsWith("SYNTHETIC-") ? vehicleId : "veh-unknown"),',
        replace: "pseudonym: (vehicleId: string) => vehicleId,",
      },
      {
        file: SUMMARY,
        find: "  assertNoRawVehicleIds(summary, allVehicleIds);\n",
        replace: "",
      },
    ],
    testFiles: [T.passive],
  },

  /* ------------------------------ found after the first catalogue (F9-F14) */
  {
    id: "F9-margin-window",
    family: "fail-closed",
    catalogue: "extra",
    description: "The margin counts only followers inside the approach window again (the legacy scale's blind spot at the window edge).",
    protection: "Finding F9: every other vehicle heading for the stop, inside the window or behind it, must be three stops behind the leader.",
    edits: [{
      file: MATCHING,
      find: "          .map((row) => row.facts.forward),",
      replace: "          .map((row) => (row.facts.competes ? row.facts.forward : undefined)),",
    }],
    testFiles: [T.matching, T.properties, T.counterfactual],
  },
  {
    id: "F10-remembered-crossing",
    family: "F4",
    catalogue: "extra",
    description: "A remembered sighting past the stop is no longer judged against passage memory, so dropping the row that shows a crossing forgets it.",
    protection: "Finding F10 (property P3, seed 16661): removing a row from the poll never turns a withheld session into a selection.",
    edits: [{
      file: MATCHING,
      find: '      if (loop ? onLoop === "crossed" : seen.min <= -1 && offset >= 0) withhold("boarding_stop_reached_during_session");',
      replace: "      { /* Negative control F10: a remembered crossing is forgotten. */ }",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F10-remembered-window",
    family: "F4",
    catalogue: "extra",
    description: "On board, a remembered sighting beyond the window no longer withholds, so dropping the row that shows the rider's bus leaving forgets it.",
    protection: "The on-board mirror of F10.",
    edits: [{
      file: MATCHING,
      find: '      : seen.max >= -1 && seen.max <= window && offset > window) {\n      withhold("vehicle_left_on_board_window_during_session");',
      replace: "      : Number.isNaN(0)) {\n      /* Negative control F10-remembered-window */",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F11-pre-passage-row",
    family: "F4",
    catalogue: "extra",
    description: "A polled session row with no passage memory (written before the memory existed) is read as an empty memory again.",
    protection: "Finding F11: a session whose memory is unknown is withheld for good, never restarted with an empty memory.",
    edits: [{
      file: SESSION,
      find: "      : session.cadenceHistory.length > 0\n",
      replace: "      : false\n",
    }],
    testFiles: [T.session],
  },
  {
    id: "F12-first-look",
    family: "F4",
    catalogue: "extra",
    description: "A session's late first decision no longer asks whether a bus past the stop could have been at it when the rider began waiting.",
    protection: "Finding F12: whatever crossed the stop before the first observation may be the rider's bus.",
    edits: [{
      file: MATCHING,
      find: "      if (seen === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > 0",
      replace: "      if (seen === undefined && prior !== undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > 0",
    }],
    testFiles: [T.matching, T.session],
  },
  {
    id: "F13-receipt-order",
    family: "fail-closed",
    catalogue: "extra",
    description: "The cadence history accepts a receipt no newer than the latest one it holds (a late older receipt, or a second row in one snapshot).",
    protection: "Finding F13: receipts only move forward, so no duplicate or late row can manufacture a sample or a content change.",
    edits: [{
      file: FRESHNESS,
      find: "at !== undefined && at > latest ?",
      replace: "at !== undefined ?",
    }],
    testFiles: [T.freshness, T.properties],
  },
  {
    id: "F14-vehicle-guard",
    family: "F3",
    catalogue: "extra",
    description: "The blind-input guard no longer inspects vehicle rows, so a per-vehicle truth flag reaches the matcher.",
    protection: "Finding F14: a field that is not an observation is refused at every level of the blind input.",
    edits: [{
      file: PASSIVE,
      find: "        if (!BLIND_VEHICLE_KEYS.has(key)) throw new GroundTruthLeakError(`vehicle row carries non-blind field \"${key}\"`);",
      replace: "        /* Negative control F14-vehicle-guard */",
    }],
    testFiles: [T.passive],
  },
  {
    id: "F14-stop-guard",
    family: "F3",
    catalogue: "extra",
    description: "The blind-input guard no longer inspects route stops.",
    protection: "Finding F14, for route stops.",
    edits: [{
      file: PASSIVE,
      find: "      if (!BLIND_STOP_KEYS.has(key)) throw new GroundTruthLeakError(`route stop carries non-blind field \"${key}\"`);",
      replace: "      /* Negative control F14-stop-guard */",
    }],
    testFiles: [T.passive],
  },
  {
    id: "H-policy-label",
    family: "honesty",
    catalogue: "extra",
    description: "replayBlind no longer checks its policy label against the policy that decided each result.",
    protection: "A replay counted under one policy was decided by it: a legacy run cannot be passed off as production-policy evidence.",
    edits: [{
      file: REPLAY,
      find: "    if (result.policyVersion !== undefined && result.policyVersion !== matcherPolicy) {",
      replace: "    if (false) {",
    }],
    testFiles: [T.replay],
  },
  {
    id: "H-truth-timing",
    family: "honesty",
    catalogue: "extra",
    description: "dropout_outage_60s_before_boarding declares usesTruthTiming: false although it places its outage by the boarding instant.",
    protection: "A perturbation that used the answer's timing says so (usesTruthTiming).",
    edits: [{
      file: PERTURB,
      find: lines(
        '    id: "dropout_outage_60s_before_boarding",',
        '    family: "poll_dropout",',
        "    usesTruthIdentity: false,",
        "    usesTruthTiming: true,",
      ),
      replace: lines(
        '    id: "dropout_outage_60s_before_boarding",',
        '    family: "poll_dropout",',
        "    usesTruthIdentity: false,",
        "    usesTruthTiming: false,",
      ),
    }],
    testFiles: [T.passive],
  },
  {
    id: "H-readiness-clamp",
    family: "honesty",
    catalogue: "extra",
    description: "The configuration honours TRANSIT_AUTOMATIC_MATCHING_ENABLED=true whatever the demonstrated readiness.",
    protection: "The flag cannot exceed the evidence: below READY_FOR_BOUNDED_AUTOMATION an operator's opt-in is refused.",
    edits: [{
      file: "services/api/src/apiConfig.ts",
      find: "const automaticMatchingEnabled = automaticMatchingRequested && readinessPermitsAutomatic;",
      replace: "const automaticMatchingEnabled = automaticMatchingRequested;",
    }],
    testFiles: ["services/api/test/apiConfig.test.ts", "services/api/test/apiRouter.test.ts"],
  },
  {
    id: "H-live-stale",
    family: "honesty",
    catalogue: "extra",
    description: "The gate accepts live and counterfactual evidence produced by any matcher sources, not only the current ones.",
    protection: "Evidence speaks only for the code that produced it: after a matcher change, a readiness claim needs a fresh live replay.",
    edits: [{
      file: GATE,
      find: "const fresh = (digest: string | undefined) => current !== undefined && digest === current;",
      replace: "const fresh = (digest: string | undefined) => digest === current || current !== digest;",
    }],
    testFiles: [T.gate, T.liveEvidence],
  },
  {
    id: "H-pinned-controls",
    family: "honesty",
    catalogue: "extra",
    description: "SH-4 stops checking that every pinned negative control was killed, so a control deleted from the catalogue goes unnoticed.",
    protection: "A report that lost a control cannot pass for a complete one.",
    edits: [{
      file: GATE,
      find: "const unpinned = controls ? PINNED_NEGATIVE_CONTROLS.filter((id) => !controls.killedIds.includes(id)) : [];",
      replace: "const unpinned: string[] = [];",
    }],
    testFiles: [T.gate],
  },
  {
    id: "H-live-omitted",
    family: "honesty",
    catalogue: "extra",
    description: "CA-1 passes although some retained artifacts could not be fetched or verified.",
    protection: "A replay that left out retained evidence is not a replay of the evidence; its wrong commits could be among the omitted.",
    edits: [{
      file: GATE,
      find: "status: liveStatus((value) => value.collections >= 1 && value.reproductionOk && value.omittedArtifacts.length === 0),",
      replace: "status: liveStatus((value) => value.collections >= 1 && value.reproductionOk),",
    }],
    testFiles: [T.gate, T.liveEvidence],
  },
  {
    id: "H-live-units",
    family: "honesty",
    catalogue: "extra",
    description: "A window with no evaluated case still counts as a window, a time band and a provider path.",
    protection: "Sample dimensions come only from windows that contributed an independent unit; an empty or failed window proves nothing.",
    edits: [{
      file: LIVE,
      find: "    if (units.length === 0) continue;",
      replace: "    if (units.length < 0) continue;",
    }],
    testFiles: [T.liveEvidence],
  },
  {
    id: "H-live-carried",
    family: "honesty",
    catalogue: "extra",
    description: "The failures of a window evaluated before are dropped once its raw is no longer retained.",
    protection: "Expiry never erases a wrong commit: failures outlive the raw that showed them.",
    edits: [{
      file: LIVE,
      find: "  for (const row of options.previous ?? []) {",
      replace: "  for (const row of [] as DetailRow[]) {",
    }],
    testFiles: [T.liveEvidence],
  },
  {
    id: "H-mitigation-criterion",
    family: "honesty",
    catalogue: "extra",
    description: "Any passing test satisfies a human-only mitigation, whether or not it is named for its criterion.",
    protection: "A mitigation counts only with evidence that can exist for it alone.",
    edits: [{
      file: GATE,
      find: "const foreign = tests.filter((name) => !name.startsWith(`${criterion}: `));",
      replace: "const foreign = tests.filter((name) => name.length < 0);",
    }],
    testFiles: [T.gate],
  },
  {
    id: "H-coordinator-wiring",
    family: "honesty",
    catalogue: "extra",
    description: "The runtime hands the journey-session coordinator the requested automatic-matching flag instead of the granted one.",
    protection: "Sessions select automatically only when the configuration granted it; an opt-in refused by readiness never reaches them.",
    edits: [{
      file: "services/api/src/apiRuntime.ts",
      find: "automaticMatchingEnabled: config.matching.automaticMatchingEnabled,",
      replace: "automaticMatchingEnabled: config.matching.automaticMatchingRequested,",
    }],
    testFiles: ["services/api/test/apiRouter.test.ts"],
  },
  {
    id: "H-matches-shadow",
    family: "honesty",
    catalogue: "extra",
    description: "In shadow, POST /v1/matches offers the matcher's pick as a top-level selectedVehicleId again.",
    protection: "Below bounded automation no answer carries a selection a client could act on; the pick is only a shadowSelection.",
    edits: [{
      file: "services/api/src/apiRouter.ts",
      find: "...(automatic ? result : ranking),",
      replace: "...(automatic ? result : { ...ranking, selectedVehicleId }),",
    }],
    testFiles: ["services/api/test/apiRouter.test.ts"],
  },
  /* ------------------------------ out of sight, first sightings, loops */
  {
    id: "F12-late",
    family: "F4",
    catalogue: "extra",
    description: "A session's first decision more than the memory window after the rider began waiting no longer withholds.",
    protection: "Finding F12: past the memory window, what crossed the stop before the first look cannot even be bounded.",
    edits: [{
      file: MATCHING,
      find: "if (riderState === \"waiting_at_stop\" && prior === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > policy.memoryWindowSeconds) {",
      replace: "if (riderState === \"waiting_at_stop\" && prior === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > policy.memoryWindowSeconds && Number.isNaN(0)) {",
    }],
    testFiles: [T.matching, T.session],
  },
  {
    id: "F15-forgotten",
    family: "F4",
    catalogue: "extra",
    description: "A vehicle in session memory that is neither in the snapshot nor remembered from the evidence window no longer blocks or competes.",
    protection: "Finding F15: a bus out of sight for longer than the memory window is anywhere its last sighting and the time since allow; losing sight of it never raises certainty.",
    edits: [{
      file: MATCHING,
      find: "remembered.push(...forgottenVehicles(request, onRoute, remembered, topology)",
      replace: "remembered.push(...forgottenVehicles(request, onRoute, remembered, topology).filter(() => Number.isNaN(0))",
    }],
    testFiles: [T.matching, T.properties, T.counterfactual],
  },
  {
    id: "F15-unseen-time",
    family: "F4",
    catalogue: "extra",
    description: "The unobserved-arrival rule caps the time a lost vehicle has been moving at the memory window again.",
    protection: "Finding F15: a bus eight or more stops out that leaves the feed can still reach the stop unobserved, given time.",
    edits: [{
      file: MATCHING,
      find: "toStop <= reachAfter(unseenSeconds)",
      replace: "toStop <= reachAfter(Math.min(unseenSeconds, policy.memoryWindowSeconds))",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F15-unknown-out-of-sight",
    family: "F4",
    catalogue: "extra",
    description: "A vehicle whose route progress was unknown when it left the feed no longer withholds the session.",
    protection: "Finding F15: a bus of unknown progress may have been at the stop or been the rider's bus; out of sight, nothing will say otherwise.",
    edits: [{
      file: MATCHING,
      find: "if (!current.has(vehicleId) && !remembered.has(vehicleId)) withhold(\"vehicle_of_unknown_progress_out_of_sight\");",
      replace: "if (!current.has(vehicleId) && !remembered.has(vehicleId) && Number.isNaN(0)) withhold(\"vehicle_of_unknown_progress_out_of_sight\");",
    }],
    testFiles: [T.matching, T.passive],
  },
  {
    id: "F16-first-sighting",
    family: "F4",
    catalogue: "extra",
    description: "A bus first seen past the stop is judged only at the session's first decision, as before finding F16.",
    protection: "Finding F16: an earlier look that did not see a bus says nothing about it; its first sighting past the stop may still be the rider's bus.",
    edits: [{
      file: MATCHING,
      find: "      if (seen === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > 0",
      replace: "      if (seen === undefined && prior === undefined && !Number.isNaN(sinceDeclared) && sinceDeclared > 0",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F16-onboard-competes",
    family: "F4",
    catalogue: "extra",
    description: "On board, a vehicle missing from the first snapshot stops competing as well as being unselectable.",
    protection: "Finding F16: a bus the feed missed when the rider boarded may be theirs, so the bus beside it cannot be shown to be the only one.",
    edits: [{
      file: MATCHING,
      find: "row.facts = { ...row.facts, selectable: false, ...(excluded ? { competes: false } : {}) };",
      replace: "row.facts = { ...row.facts, selectable: false, competes: false };",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F17-loop-crossing",
    family: "F4",
    catalogue: "extra",
    description: "Round a loop, a bus whose distance to the stop grew by three stops or more since its last sighting is no longer read as having crossed it.",
    protection: "Finding F17: a crossing next to a loop's seam, or longer than half the lap, is still a crossing.",
    edits: [{
      file: MATCHING,
      find: "const crossed = loop ? onLoop === \"crossed\" : seen !== undefined && seen.min <= -1 && offset >= 0;",
      replace: "const crossed = loop ? Number.isNaN(0) : seen !== undefined && seen.min <= -1 && offset >= 0;",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F17-loop-window",
    family: "F4",
    catalogue: "extra",
    description: "Round a loop, a bus leaving the on-board window across half the lap no longer withholds.",
    protection: "Finding F17: however short the lap, the rider's bus leaving the window is seen to leave it.",
    edits: [{
      file: MATCHING,
      find: "? lastSeen !== undefined && nearWindow(around(lastSeen)) && !nearWindow(row.facts)",
      replace: "? Number.isNaN(0)",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F17-loop-exclusion",
    family: "F4",
    catalogue: "extra",
    description: "Round a short loop, a bus inside the on-board window that is also a few stops before the stop the other way is excluded as not the rider's.",
    protection: "Finding F17: a bus that may be in the on-board window is never read as one that reached the stop after the rider boarded.",
    edits: [{
      file: MATCHING,
      find: "const beforeStop = (at: Distances) => at.forward !== undefined && at.forward >= 2 && !nearWindow(at);",
      replace: "const beforeStop = (at: Distances) => at.forward !== undefined && at.forward >= 2;",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F17-reached-after",
    family: "F4",
    catalogue: "extra",
    description: "On board, a bus seen before the stop is no longer recorded as having reached it after the rider boarded; round a loop, the offsets' extremes alone then forget it.",
    protection: "Finding F17: a bus that reached the stop after the rider boarded is never theirs, for the rest of the session, on any route shape.",
    edits: [{
      file: MATCHING,
      find: "      if (beforeNow) reachedAfterBoarding.add(vehicleId);",
      replace: "      if (beforeNow && Number.isNaN(0)) reachedAfterBoarding.add(vehicleId);",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F15-onboard-not-theirs",
    family: "F4",
    catalogue: "extra",
    description: "On board, a bus shown to have reached the stop after the rider boarded competes again once it is out of sight.",
    protection: "A bus that cannot be the rider's never competes for the on-board window, seen or not.",
    edits: [{
      file: MATCHING,
      find: "      if (!current.has(vehicleId) && reachedEarlier(vehicleId, range)) excluded.set(vehicleId, \"reached_boarding_stop_after_rider_boarded\");",
      replace: "      if (!current.has(vehicleId) && reachedEarlier(vehicleId, range) && Number.isNaN(0)) excluded.set(vehicleId, \"reached_boarding_stop_after_rider_boarded\");",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F15-placed-twice",
    family: "F4",
    catalogue: "extra",
    description: "A bus one snapshot places at two positions is remembered at whichever row came last, as a placed bus.",
    protection: "A bus with two positions at once has none that can be trusted; what the session remembers of it never depends on row order.",
    edits: [{
      file: MATCHING,
      find: "      lastSeenAt: request.now,\n    });\n    if (new Set(placed).size > 1) sawUnknown.add(vehicleId);",
      replace: "      lastSeenAt: request.now,\n    });\n    if (new Set(placed).size > 1 && Number.isNaN(0)) sawUnknown.add(vehicleId);",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F15-unplaced-row",
    family: "F4",
    catalogue: "extra",
    description: "A remembered row places a bus even when that bus's latest sighting had no usable position.",
    protection: "The evidence window may keep another row of an unplaced sighting; that row is not where the bus is.",
    edits: [{
      file: MATCHING,
      find: "  if (since === undefined || Date.parse(row.receivedAt ?? \"\") > Date.parse(since)) return row;",
      replace: "  if (since === undefined || Date.parse(row.receivedAt ?? \"\") > Date.parse(since) || !Number.isNaN(0)) return row;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F15-future-sighting",
    family: "F4",
    catalogue: "extra",
    description: "A lost bus whose last sighting, or a rider whose declaration, is dated well after now is taken as seen, or declared, just now.",
    protection: "When the clock steps back, the time since a sighting is unknown, never zero.",
    edits: [{
      file: MATCHING,
      find: "  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs) || thenMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) return Number.POSITIVE_INFINITY;",
      replace: "  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return Number.POSITIVE_INFINITY;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F17-lost-loop",
    family: "F4",
    catalogue: "extra",
    description: "A lost bus last seen past the stop on a loop can no longer come round to it unobserved.",
    protection: "Finding F17: on a loop, a bus past the stop keeps travelling towards it; given time it may reach it unseen.",
    edits: [{
      file: MATCHING,
      find: "  if (topology?.loop) return mod(-last, topology.cycleLength);",
      replace: "  if (topology?.loop && Number.isNaN(0)) return mod(-last, topology.cycleLength);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F18-lap",
    family: "fail-closed",
    catalogue: "extra",
    description: "A loop's lap is the number of stop rows again, so a missing row moves the seam.",
    protection: "Finding F18: the lap is measured in sequences; a missing or repeated row in the stop list cannot move a bus across the stop.",
    edits: [{
      file: MATCHING,
      find: "cycleLength: loop ? Math.max(1, last!.sequence - first!.sequence) : Math.max(1, ordered.length),",
      replace: "cycleLength: Math.max(1, lap.length),",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F18-conflict",
    family: "fail-closed",
    catalogue: "extra",
    description: "Two different stops listed under one sequence no longer withhold selection.",
    protection: "Finding F18: a stop list that puts two stops at one sequence cannot place any bus.",
    edits: [{
      file: MATCHING,
      find: "else if (listed.stopId !== stop.stopId) sequenceConflict = true;",
      replace: "else if (listed.stopId !== stop.stopId && Number.isNaN(0)) sequenceConflict = true;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F19-two-routes",
    family: "fail-closed",
    catalogue: "extra",
    description: "A row of the same vehicle under another route no longer counts as a second position.",
    protection: "Finding F19: a bus the provider also places on another route has no position that can be trusted.",
    edits: [{
      file: MATCHING,
      find: "  for (const row of assessed) {\n    const entry = positionsByVehicle.get(row.ranked.vehicleId)",
      replace: "  for (const row of onRoute) {\n    const entry = positionsByVehicle.get(row.ranked.vehicleId)",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "F19-invariant-route",
    family: "fail-closed",
    catalogue: "extra",
    description: "The invariant check reads rows of the selected vehicle under any route again.",
    protection: "Finding F19: the invariant judges the rows that were selected, on the request's route, whatever else shares the id.",
    edits: [{
      file: MATCHING,
      find: "    && (request.routeId === undefined || candidate.routeId === request.routeId));",
      replace: "    && (request.routeId === undefined || candidate.routeId !== undefined));",
    }],
    testFiles: [T.matching],
  },
  {
    id: "F20-never-watched",
    family: "fail-closed",
    catalogue: "extra",
    description: "An automatic selection for a waiting rider is no longer watched, however it was stored.",
    protection: "Finding F20: until the selected bus is seen at the stop, another bus seen reaching it first may be the rider's.",
    edits: [{
      file: SESSION,
      find: "      && (record.riderState ?? \"waiting_at_stop\") === \"waiting_at_stop\") {\n      const watch = record.boardingWatch ??=",
      replace: "      && (record.riderState ?? \"waiting_at_stop\") === \"waiting_at_stop\" && Number.isNaN(0)) {\n      const watch = record.boardingWatch ??=",
    }],
    testFiles: [T.session, T.properties],
  },
  {
    id: "F20-others-ignored",
    family: "fail-closed",
    catalogue: "extra",
    description: "Another bus seen reaching the stop no longer withdraws the selection.",
    protection: "Finding F20: the rider boards the first bus of their route to arrive, whichever was selected.",
    edits: [{
      file: SESSION,
      find: "    if (ANOTHER_BUS_REACHED_THE_STOP.has(others.passage?.withheld?.reason ?? \"\")) return true;",
      replace: "    if (ANOTHER_BUS_REACHED_THE_STOP.has(others.passage?.withheld?.reason ?? \"\") && Number.isNaN(0)) return true;",
    }],
    testFiles: [T.session, T.properties],
  },
  {
    id: "F20-selected-first",
    family: "fail-closed",
    catalogue: "extra",
    description: "When the selected bus and another reach the stop in the same poll, the selection stands.",
    protection: "Finding F20: two buses at the stop between two polls leave the rider on either.",
    edits: [{
      file: SESSION,
      find: "    if (ANOTHER_BUS_REACHED_THE_STOP.has(others.passage?.withheld?.reason ?? \"\")) return true;",
      replace: "    if (ANOTHER_BUS_REACHED_THE_STOP.has(others.passage?.withheld?.reason ?? \"\")\n      && placeOfSelected(record, vehicles, selectedId)?.zone !== \"boarding_stop_unresolved\") return true;",
    }],
    testFiles: [T.session],
  },
  {
    id: "F20-first-sighting",
    family: "fail-closed",
    catalogue: "extra",
    description: "A bus seen for the first time past the stop no longer withdraws the selection.",
    protection: "Finding F20 with F16: a bus first seen past the stop may have been at it while the rider waited.",
    edits: [{
      file: SESSION,
      find: "  \"boarding_stop_reached_during_session\",\n  \"vehicle_first_seen_past_boarding_stop\",\n]);",
      replace: "  \"boarding_stop_reached_during_session\",\n]);",
    }],
    testFiles: [T.session],
  },
  {
    id: "F20-watch-never-ends",
    family: "fail-closed",
    catalogue: "extra",
    description: "The selected bus seen at the stop no longer ends the boarding watch.",
    protection: "Finding F20: once the selected bus reached the stop first, a bus behind it arriving later says nothing about the rider.",
    edits: [{
      file: SESSION,
      find: "      ...(reached ? { endedAt: now.toISOString() } : {}),",
      replace: "      ...(reached && Number.isNaN(0) ? { endedAt: now.toISOString() } : {}),",
    }],
    testFiles: [T.session, T.properties],
  },
  {
    id: "F20-reselect",
    family: "fail-closed",
    catalogue: "extra",
    description: "A withdrawal no longer leaves its own standing reason in the session's memory.",
    // The matcher re-derives a sighting's reason from the same snapshot, so
    // no automatic selection follows either way (finding R35): what the
    // standing reason gives is the question the rider keeps being asked.
    protection: "Finding F20: after a withdrawal the rider keeps being asked which bus they are on, with the bus that just left the stop offered, for the rest of the session.",
    edits: [{
      file: SESSION,
      find: "      withheld: { reason: SELECTION_WITHDRAWN, at: now.toISOString() },",
      replace: "      ...(Number.isNaN(0) ? { withheld: { reason: SELECTION_WITHDRAWN, at: now.toISOString() } } : {}),",
    }],
    testFiles: [T.session, T.properties],
    mustBeKilledBy: [
      "an automatic selection is withdrawn when another bus is seen reaching the stop first, and nothing is selected again",
      "after a withdrawal the rider may be on the bus that just left the stop, so it is offered",
    ],
  },
  {
    id: "F20-watch-ends-early",
    family: "fail-closed",
    catalogue: "extra",
    description: "Any reason the selected bus's own look raises ends the boarding watch, as when it is merely out of sight.",
    protection: "Findings F20 and R31: only a sighting of the selected bus reaching the stop ends the watch; a bus out of sight only may have.",
    edits: [{
      file: SESSION,
      find: "    const reached = place !== undefined",
      replace: "    const reached = selected.passage?.withheld !== undefined || place !== undefined",
    }],
    testFiles: [T.session, T.properties],
  },
  {
    id: "R31-reason",
    family: "fail-closed",
    catalogue: "extra",
    description: "The matcher's own crossing reason for the selected bus ends the watch again.",
    protection: "Finding R31: a reading one stop back round a loop, a bus listed twice, and a remembered row look like an arrival to the matcher's caution, and are none.",
    edits: [{
      file: SESSION,
      find: "    const reached = place !== undefined",
      replace: "    const reached = selected.passage?.withheld?.reason === \"boarding_stop_reached_during_session\" || place !== undefined",
    }],
    testFiles: [T.session],
  },
  {
    id: "R31-one-place",
    family: "fail-closed",
    catalogue: "extra",
    description: "The selected bus listed at two places is placed by its first row.",
    protection: "Finding R31: a bus listed at two places is at no place that can be trusted, so it shows no arrival.",
    edits: [{
      file: SESSION,
      find: "  if (new Set(rows.map((row) => row.stopSequence)).size !== 1) return undefined;",
      replace: "  if (new Set(rows.map((row) => row.stopSequence)).size !== 1 && Number.isNaN(0)) return undefined;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R31-other-route",
    family: "fail-closed",
    catalogue: "extra",
    description: "A row of the selected bus under another route places it.",
    protection: "Finding R31 with F19: a bus also listed under another route is at no place that can be trusted.",
    edits: [{
      file: SESSION,
      find: "  if (rows.length === 0 || rows.some((row) => row.routeId !== record.routeId)) return undefined;",
      replace: "  if (rows.length === 0) return undefined;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R31-speed",
    family: "fail-closed",
    catalogue: "extra",
    description: "Seen before the stop and later past it, the selected bus ends the watch however fast it would have had to go.",
    protection: "Finding R31: a crossing faster than the matcher's motion model is a garbled reading, not an arrival.",
    edits: [{
      file: SESSION,
      find: "  return toStopThen >= 1 && through <= reach && (!topology.loop || lap - through > 2);",
      replace: "  return toStopThen >= 1 && (through <= reach || Number.isFinite(reach)) && (!topology.loop || lap - through > 2);",
    }],
    testFiles: [T.session],
  },
  {
    id: "R31-loop-back",
    family: "fail-closed",
    catalogue: "extra",
    description: "Round a loop, a reading a stop or two back after a long gap counts as the selected bus having gone round through the stop.",
    protection: "Finding R31: what a reading up to two stops back would also show is not an arrival.",
    edits: [{
      file: SESSION,
      find: "  return toStopThen >= 1 && through <= reach && (!topology.loop || lap - through > 2);",
      replace: "  return toStopThen >= 1 && through <= reach;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R33-merge",
    family: "fail-closed",
    catalogue: "extra",
    description: "A withdrawal that loses the compare-and-set to a concurrent refresh is dropped.",
    protection: "Finding R33: a concurrent request's row does not unsee the bus this request saw reaching the stop first.",
    edits: [{
      file: SESSION,
      find: "    const merged = await this.mergeOntoWinner(outcome.stored, finding);",
      replace: "    const merged = finding.kind === \"end\" ? await this.mergeOntoWinner(outcome.stored, finding) : { row: outcome.stored, written: undefined };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R33-order",
    family: "fail-closed",
    catalogue: "extra",
    description: "A withdrawal is written onto a concurrent row even when that row saw the selected bus at the stop earlier.",
    protection: "Finding R33: the selected bus seen at the stop before the other bus was is the rider's arrival, whichever request saved first.",
    edits: [{
      file: SESSION,
      find: "        if (endedAt !== undefined && Date.parse(endedAt) < finding.at.getTime()) return { row: current };",
      replace: "        if (endedAt !== undefined && Date.parse(endedAt) < finding.at.getTime() && Number.isNaN(0)) return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R34-seam",
    family: "fail-closed",
    catalogue: "extra",
    description: "After a withdrawal, how far a bus is past the stop is read from its plain offset again.",
    protection: "Finding R34: round a loop, the bus that just left the stop is offered also when it reports the first stop's sequence.",
    edits: [{
      file: SESSION,
      find: "  const past = (offset: number) => (topology.loop ? around(offset) : offset);",
      replace: "  const past = (offset: number) => offset;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R23-returned",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board round a loop, a bus that came back to the stop, or had time to, is no longer recorded.",
    protection: "Finding R23: on board, a bus seen clear of the stop and later back at it may have reached it after the rider boarded.",
    edits: [{
      file: MATCHING,
      find: "        if (back || hadTimeToPass(seen, clearThen ? then.forward! : topology!.cycleLength - 1, row.facts)) returnedToStop.add(vehicleId);",
      replace: "        if ((back || hadTimeToPass(seen, clearThen ? then.forward! : topology!.cycleLength - 1, row.facts)) && Number.isNaN(0)) returnedToStop.add(vehicleId);",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R23-back",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board round a loop, a bus seen clear of the stop and then closer past it, or at the stop before it, is no longer recorded.",
    protection: "Finding R23: a distance past the stop that shrinks is a pass through the stop after the rider boarded, or a stop read back.",
    edits: [{
      file: MATCHING,
      find: "        const back = clearThen && (row.facts.forward === 1 || row.facts.backward! < then.backward!);",
      replace: "        const back = clearThen && Number.isNaN(0) && (row.facts.forward === 1 || row.facts.backward! < then.backward!);",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R23-lap",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board round a loop, a bus seen again after long enough to have gone round through the stop is no longer recorded.",
    protection: "Finding R23: between two sightings far enough apart, a bus may have gone round through the stop.",
    edits: [{
      file: MATCHING,
      find: "        if (back || hadTimeToPass(seen, clearThen ? then.forward! : topology!.cycleLength - 1, row.facts)) returnedToStop.add(vehicleId);",
      replace: "        if (back || (Number.isNaN(0) && hadTimeToPass(seen, clearThen ? then.forward! : topology!.cycleLength - 1, row.facts))) returnedToStop.add(vehicleId);",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R23-unproven",
    family: "fail-closed",
    catalogue: "extra",
    description: "A bus recorded as having come back to the stop may be selected again.",
    protection: "Finding R23: such a bus is never selected as the rider's; it still competes.",
    edits: [{
      file: MATCHING,
      find: "      if (returnedToStop.has(vehicleId)) unproven.set(",
      replace: "      if (returnedToStop.has(vehicleId) && Number.isNaN(0)) unproven.set(",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R23-short-loop",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a loop too short to tell the stops past the boarding stop from those before it no longer withholds.",
    protection: "Finding R23: on a loop shorter than two windows and the stop either side, no position says which bus the rider boarded.",
    edits: [{
      file: MATCHING,
      find: "topology.cycleLength < 2 * policy.onBoardWindowStops + 2) {",
      replace: "topology.cycleLength < 2 * policy.onBoardWindowStops + 2 && Number.isNaN(0)) {",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R24-lap",
    family: "fail-closed",
    catalogue: "extra",
    description: "Waiting round a loop, a bus seen again after long enough to have gone round through the stop no longer withholds.",
    protection: "Finding R24: a bus that could have gone round through the stop since it was last seen may have taken the rider.",
    edits: [{
      file: MATCHING,
      find: "      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts))) wentRound = true;",
      replace: "      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts) && Number.isNaN(0))) wentRound = true;",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R24-order",
    family: "fail-closed",
    catalogue: "extra",
    description: "What the time since allows is withheld in row order, so it can be kept before a crossing a later row shows.",
    protection: "Finding R24 with F20: a reason a sighting raises is kept first, so the boarding watch can tell it from a possibility.",
    edits: [
      {
        file: MATCHING,
        find: "      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts))) wentRound = true;",
        replace: "      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts))) withhold(\"vehicle_may_have_reached_boarding_stop_unobserved\");",
      },
      {
        file: MATCHING,
        find: "      const crossed = loop ? onLoop === \"crossed\" : seen !== undefined && seen.min <= -1 && offset >= 0;\n      if (row.facts.zone === \"boarding_stop_unresolved\" || crossed) {\n        withhold(\"boarding_stop_reached_during_session\");\n      }",
        replace: "      const crossed = loop ? onLoop === \"crossed\" : seen !== undefined && seen.min <= -1 && offset >= 0;",
      },
      {
        file: MATCHING,
        find: "      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts))) withhold(",
        replace: "      if (row.facts.zone === \"boarding_stop_unresolved\" || crossed) withhold(\"boarding_stop_reached_during_session\");\n      if (onLoop === \"read_back\" || (loop && last !== undefined && hadTimeToPass(seen, around(last).forward!, row.facts))) withhold(",
      },
    ],
    testFiles: [T.matching],
  },
  {
    id: "R25-spread",
    family: "fail-closed",
    catalogue: "extra",
    description: "The walk of a vehicle's possible positions is spread into an argument list again.",
    protection: "Finding R25: a long lap walked in full never throws; the matcher answers, and withholds.",
    edits: [
      {
        file: MATCHING,
        find: "  let closestForward: number | undefined;\n  for (let step = 0; step <= reach; step += 1) {",
        replace: "  let closestForward: number | undefined;\n  const walked: number[] = [];\n  for (let step = 0; step <= reach; step += 1) {\n    walked.push(step);",
      },
      {
        file: MATCHING,
        find: "    ...(closestForward === undefined ? {} : { closestForward }),",
        replace: "    ...(closestForward === undefined ? {} : { closestForward: Math.min(closestForward, ...walked.map(() => Number.POSITIVE_INFINITY)) }),",
      },
    ],
    testFiles: [T.matching],
  },
  {
    id: "R27-exclusion",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a bus the snapshot places twice is excluded again by the place before the stop.",
    protection: "Finding R27: an exclusion stops a bus competing, so it takes a sighting that can be trusted.",
    edits: [{
      file: MATCHING,
      find: "      const beforeNow = !reportedTwice.has(vehicleId) && (loop ? beforeStop(row.facts) : offset <= -2);",
      replace: "      const beforeNow = (loop ? beforeStop(row.facts) : offset <= -2);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R27-memory",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a sighting at two places is folded into memory like any other, where a later decision reads an exclusion from it.",
    protection: "Finding R27: on board, a sighting at two places never lowers what a bus is remembered by, so no exclusion is read from it.",
    edits: [{
      file: MATCHING,
      find: "    if (riderState === \"on_board\" && reportedTwice.has(vehicleId)) {",
      replace: "    if (riderState === \"on_board\" && reportedTwice.has(vehicleId) && Number.isNaN(0)) {",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-unknown",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a bus the snapshot places at two places, or also under another route, is no longer marked as of unknown progress.",
    protection: "Finding R30: on board, a bus with no trustworthy place withholds once out of sight; it may be the rider's bus.",
    edits: [{
      file: MATCHING,
      find: "      sawUnknown.add(vehicleId);\n      continue;\n    }\n    offsets.set(vehicleId, {",
      replace: "      if (Number.isNaN(0)) sawUnknown.add(vehicleId);\n      continue;\n    }\n    offsets.set(vehicleId, {",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-never-placed",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a bus seen only at no place, or at two, and then beyond the window no longer withholds.",
    protection: "Finding R30: a bus never placed in the session may have been in the window all along, so beyond it, it may be the rider's bus leaving it.",
    edits: [{
      file: MATCHING,
      find: "      const neverPlaced = seen === undefined && unknownProgress.has(vehicleId) && beyond !== undefined\n",
      replace: "      const neverPlaced = seen === undefined && unknownProgress.has(vehicleId) && beyond !== undefined && Number.isNaN(0)\n",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R28-mark",
    family: "fail-closed",
    catalogue: "extra",
    description: "The unknown-progress mark is dated by the decision's now again, before its own rows were received.",
    protection: "Finding R28: a row the evidence window keeps from the sighting that left a bus unplaced never places it.",
    edits: [{
      file: MATCHING,
      find: "      if (Number.isFinite(receivedAt) && receivedAt > latest) latest = receivedAt;",
      replace: "      if (Number.isFinite(receivedAt) && receivedAt > latest && Number.isNaN(0)) latest = receivedAt;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R29-own",
    family: "fail-closed",
    catalogue: "extra",
    description: "A bus's last sighting dated up to 10 s after now reads as seen just now in the out-of-sight rule.",
    protection: "Finding R29: the session's own sighting can only be later than now if the clock stepped back; nothing then bounds the time since.",
    edits: [{
      file: MATCHING,
      find: "    const unseenSeconds = secondsSinceOwnSighting(seenAtMs, nowMs);",
      replace: "    const unseenSeconds = secondsSince(seenAtMs, nowMs);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R29-own-lap",
    family: "fail-closed",
    catalogue: "extra",
    description: "Round a loop, the time since a bus was last seen reads as none when its sighting is dated a little after now.",
    protection: "Finding R29 with R24: after a backward clock step, a bus seen again may have gone round through the stop.",
    edits: [{
      file: MATCHING,
      find: "    const seconds = secondsSinceOwnSighting(seen.lastSeenAt === undefined ? Number.NaN : Date.parse(seen.lastSeenAt), nowMs);",
      replace: "    const seconds = secondsSince(seen.lastSeenAt === undefined ? Number.NaN : Date.parse(seen.lastSeenAt), nowMs);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-never-placed-loop",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board round a loop, a bus never placed and then beyond the window no longer withholds.",
    protection: "Findings R30 and R37: round a loop too, a bus never placed may be the rider's bus leaving the window.",
    edits: [{
      file: MATCHING,
      find: "      const beyond = loop ? (nearWindow(row.facts) ? undefined : row.facts.backward! - window) :",
      replace: "      const beyond = loop ? undefined :",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-never-placed-plain",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board round a loop, how far a never-placed bus is beyond the window is read from its plain offset.",
    protection: "Findings R30 and R37: across a loop's seam, the rider's bus leaving the window has a plain offset before the stop.",
    edits: [{
      file: MATCHING,
      find: "      const beyond = loop ? (nearWindow(row.facts) ? undefined : row.facts.backward! - window) :",
      replace: "      const beyond = loop ? (offset > window ? offset - window : undefined) :",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-never-placed-twice",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a bus listed at two places again is exempt from the never-placed rule.",
    protection: "Findings R30 and R37: the rider's bus listed at two places again, beyond the window, may be leaving it.",
    edits: [{
      file: MATCHING,
      find: "      const neverPlaced = seen === undefined && unknownProgress.has(vehicleId) && beyond !== undefined\n",
      replace: "      const neverPlaced = seen === undefined && unknownProgress.has(vehicleId) && beyond !== undefined && !reportedTwice.has(vehicleId)\n",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R30-never-placed-edge",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a never-placed bus at the window's last stop counts as beyond it.",
    protection: "Finding R37: at the window's last stop a bus has left nothing; it may be the rider's bus, and is selected.",
    edits: [{
      file: MATCHING,
      find: ": offset > window ? offset - window : undefined;",
      replace: ": offset >= window ? offset - window : undefined;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R31-place-time",
    family: "fail-closed",
    catalogue: "extra",
    description: "The boarding watch's anchor moves to the latest place before the stop but keeps the time it was first set.",
    protection: "Finding R38: a crossing is timed from the selected bus's latest sighting before the stop.",
    edits: [{
      file: SESSION,
      find: "      ? { offset: place.offset!, at: now.toISOString() }\n      : watch.selectedPlace;",
      replace: "      ? { offset: place.offset!, at: watch.selectedPlace?.at ?? now.toISOString() }\n      : watch.selectedPlace;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R31-watch-start",
    family: "fail-closed",
    catalogue: "extra",
    description: "The boarding watch starts from the furthest place memory holds for the selected bus, not where the selection read it.",
    protection: "Finding R38: the watch measures a crossing from the place the selection read.",
    edits: [{
      file: SESSION,
      find: "  const offset = seen?.last ?? seen?.max;",
      replace: "  const offset = seen?.max;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R33-tie",
    family: "fail-closed",
    catalogue: "extra",
    description: "A winner whose watch ended at the very instant of the withdrawing snapshot keeps its selection.",
    protection: "Finding R39: the selected bus and another at the stop at once leave the rider on either, whichever request saved first.",
    edits: [{
      file: SESSION,
      find: "        if (endedAt !== undefined && Date.parse(endedAt) < finding.at.getTime()) return { row: current };",
      replace: "        if (endedAt !== undefined && Date.parse(endedAt) <= finding.at.getTime()) return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R33-retry",
    family: "fail-closed",
    catalogue: "extra",
    description: "A withdrawal is written onto the winner's row once, never retried.",
    protection: "Finding R39: a third write between the lost save and the merge does not drop the withdrawal.",
    edits: [{
      file: SESSION,
      find: "    for (let attempt = 0; attempt < 3; attempt += 1) {\n      const winner = toRecord(current.session);\n      if (winner.selectedVehicleId !== finding.vehicleId",
      replace: "    for (let attempt = 0; attempt < (finding.kind === \"withdrawal\" ? 1 : 3); attempt += 1) {\n      const winner = toRecord(current.session);\n      if (winner.selectedVehicleId !== finding.vehicleId",
    }],
    testFiles: [T.session],
  },
  {
    id: "R33-mode",
    family: "fail-closed",
    catalogue: "extra",
    description: "A withdrawal is written onto a winner whose same selection the rider confirmed.",
    protection: "Finding R39: the rider's confirmation is never undone by a concurrent withdrawal.",
    edits: [{
      file: SESSION,
      find: "      if (winner.selectedVehicleId !== finding.vehicleId || winner.selectionMode !== \"automatic\") return { row: current };",
      replace: "      if (winner.selectedVehicleId !== finding.vehicleId) return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R34-window",
    family: "fail-closed",
    catalogue: "extra",
    description: "After a withdrawal, a bus four stops past the stop is no longer offered.",
    protection: "Finding R41: a bus the rider may be on is offered as far past the stop as the on-board window reaches.",
    edits: [{
      file: SESSION,
      find: "past(candidate.stopOffset) <= DIRECTED_MATCHER_POLICY_V1.onBoardWindowStops)))",
      replace: "past(candidate.stopOffset) < DIRECTED_MATCHER_POLICY_V1.onBoardWindowStops)))",
    }],
    testFiles: [T.session],
  },
  {
    id: "R34-sort",
    family: "fail-closed",
    catalogue: "extra",
    description: "After a withdrawal, buses are offered in order of their plain offset round a loop.",
    protection: "Finding R41: round a loop, the bus nearest the stop, across the seam too, is offered first.",
    edits: [{
      file: SESSION,
      find: ": topology.loop ? Math.min(around(candidate.stopOffset), around(-candidate.stopOffset)) : Math.abs(candidate.stopOffset));",
      replace: ": Math.abs(candidate.stopOffset));",
    }],
    testFiles: [T.session],
  },
  {
    id: "R40-bound",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, a bus never placed and next seen anywhere beyond the window withholds, however far it would have had to go.",
    protection: "Finding R40: a bus beyond where the rider's bus could have got since they said they were aboard is not theirs.",
    edits: [{
      file: MATCHING,
      find: "        && (Number.isNaN(sinceDeclared) || beyond <= reachAfter(sinceDeclared) + 2);",
      replace: "        && (Number.isNaN(sinceDeclared) || beyond <= reachAfter(sinceDeclared) + 2 || Number.isFinite(beyond));",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R40-margin",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, the never-placed rule's bound leaves no stop for a misread at either end.",
    protection: "Findings R40 and R46: the rider's bus, read a stop off at each end, may still be theirs leaving the window.",
    edits: [{
      file: MATCHING,
      find: "beyond <= reachAfter(sinceDeclared) + 2);",
      replace: "beyond <= reachAfter(sinceDeclared));",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R40-unknown-time",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, with no declaration time the never-placed rule no longer withholds.",
    protection: "Findings R30 and R40: with nothing to bound the time since, a never-placed bus beyond the window may be the rider's.",
    edits: [{
      file: MATCHING,
      find: "        && (Number.isNaN(sinceDeclared) || beyond <= reachAfter(sinceDeclared) + 2);",
      replace: "        && (!Number.isNaN(sinceDeclared) && beyond <= reachAfter(sinceDeclared) + 2);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R42-anchor",
    family: "fail-closed",
    catalogue: "extra",
    description: "The boarding watch's anchor moves to every sighting at one place, past the stop too.",
    protection: "Finding R42: a sighting past the stop too soon to be a crossing leaves the last one before the stop to measure from.",
    edits: [{
      file: SESSION,
      find: "    const selectedPlace = place !== undefined && beforeTheStop(place)",
      replace: "    const selectedPlace = place !== undefined",
    }],
    testFiles: [T.session],
  },
  {
    id: "R43-read-back",
    family: "fail-closed",
    catalogue: "extra",
    description: "Round a loop, a bus whose distance to the stop grew by one or two stops is read as having crossed it.",
    protection: "Finding R43: a reading a stop or two back is a possibility, never a sighting that withdraws a selection.",
    edits: [{
      file: MATCHING,
      find: "    return grew > 2 ? \"crossed\" : grew > 0 ? \"read_back\" : undefined;",
      replace: "    return grew > 0 ? \"crossed\" : grew > 2 ? \"read_back\" /* unreachable: keeps the type */ : undefined;",
    }],
    testFiles: [T.matching, T.session],
  },
  {
    id: "R43-possibility",
    family: "fail-closed",
    catalogue: "extra",
    description: "Waiting round a loop, a bus read a stop or two back no longer withholds.",
    protection: "Finding R43: such a bus may have gone round through the stop, so it still withholds a selection not yet made.",
    edits: [{
      file: MATCHING,
      find: "      if (onLoop === \"read_back\" || (loop && last !== undefined",
      replace: "      if ((onLoop === \"read_back\" && Number.isNaN(0)) || (loop && last !== undefined",
    }],
    testFiles: [T.matching, T.properties],
  },
  {
    id: "R43-remembered",
    family: "fail-closed",
    catalogue: "extra",
    description: "Waiting round a loop, a remembered row a stop or two behind memory no longer withholds.",
    protection: "Findings R43 and F10: a remembered row read back may still show a bus gone round through the stop.",
    edits: [{
      file: MATCHING,
      find: "      if (onLoop === \"read_back\") wentRound = true;",
      replace: "      if (onLoop === \"read_back\" && Number.isNaN(0)) wentRound = true;",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R44-end-merge",
    family: "fail-closed",
    catalogue: "extra",
    description: "An end of the boarding watch that loses the compare-and-set to a concurrent refresh is dropped.",
    protection: "Finding R44: a concurrent request's row does not unsee the selected bus this request saw reaching the stop first.",
    edits: [{
      file: SESSION,
      find: "      let write: \"withdrawal\" | \"end\" = \"withdrawal\";",
      replace: "      let write: \"withdrawal\" | \"end\" = \"withdrawal\";\n      if (finding.kind === \"end\") return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R44-earliest",
    family: "fail-closed",
    catalogue: "extra",
    description: "An end is written onto a concurrent row only while its watch is open, not over a later end.",
    protection: "Finding R44: the earliest end is kept, so a withdrawal from a snapshot between the two is not merged.",
    edits: [{
      file: SESSION,
      find: "        if (endedAt !== undefined && Date.parse(endedAt) <= finding.at.getTime()) return { row: current };",
      replace: "        if (endedAt !== undefined) return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R46-misread",
    family: "fail-closed",
    catalogue: "extra",
    description: "On board, the never-placed bound allows a stop for a misread at the later reading only.",
    protection: "Finding R46: the window is a window of readings, so the rider's bus read at its far edge may stand a stop further on, and be read a stop further still; a bus beyond by no more is not the bus behind's to be preferred to.",
    edits: [{
      file: MATCHING,
      find: "beyond <= reachAfter(sinceDeclared) + 2);",
      replace: "beyond <= reachAfter(sinceDeclared) + 1);",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R47-loop-edge",
    family: "fail-closed",
    catalogue: "extra",
    description: "Round a loop, the never-placed bound counts a bus one stop further past the stop than it is.",
    protection: "Finding R47: round a loop the bound is the same arithmetic as on a straight route, across the seam too, and its edge is pinned.",
    edits: [{
      file: MATCHING,
      find: "const beyond = loop ? (nearWindow(row.facts) ? undefined : row.facts.backward! - window) :",
      replace: "const beyond = loop ? (nearWindow(row.facts) ? undefined : row.facts.backward! - window + 1) :",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R48-order-first-seen",
    family: "fail-closed",
    catalogue: "extra",
    description: "What the time allows is withheld before a bus first seen past the stop.",
    protection: "Finding R48: a sighting is kept before a possibility, so the boarding watch withdraws on a bus first seen past the stop whatever another bus reads.",
    edits: [{
      file: MATCHING,
      find: "  if (firstSeenPast) {\n    withhold(prior === undefined",
      replace: "  if (wentRound) withhold(\"vehicle_may_have_reached_boarding_stop_unobserved\");\n  if (firstSeenPast) {\n    withhold(prior === undefined",
    }],
    testFiles: [T.matching, T.session],
  },
  {
    id: "R48-order-remembered",
    family: "fail-closed",
    catalogue: "extra",
    description: "What the time allows is withheld before the remembered rows are read.",
    protection: "Finding R48: a crossing a remembered row shows is a sighting, kept before a possibility.",
    edits: [{
      file: MATCHING,
      find: "  const remembered = new Set<string>();",
      replace: "  const remembered = new Set<string>();\n  if (wentRound) withhold(\"vehicle_may_have_reached_boarding_stop_unobserved\");",
    }],
    testFiles: [T.matching],
  },
  {
    id: "R50-stale-end",
    family: "fail-closed",
    catalogue: "extra",
    description: "An end is merged onto the winner's row without reading this snapshot against the winner's memory.",
    protection: "Finding R50: an end judged on this request's stale memory is not written over a crossing the winner's memory shows in the same snapshot.",
    edits: [{
      file: SESSION,
      find: "        write = this.anotherBusReachedTheStopOnRow(current.session, finding) ? \"withdrawal\" : \"end\";",
      replace: "        write = \"end\";",
    }],
    testFiles: [T.session],
  },
  {
    id: "R51-anchor-zone",
    family: "fail-closed",
    catalogue: "extra",
    description: "The watch's anchor moves only to sightings inside the approach window.",
    protection: "Finding R51: every sighting of the selected bus at one place before the stop is where a crossing is measured from, however far before it.",
    edits: [{
      file: SESSION,
      find: "  return place.forward !== undefined && (place.backward === undefined || place.forward < place.backward);",
      replace: "  return place.zone === \"approaching\";",
    }],
    testFiles: [T.session],
  },
  {
    id: "R52-end-retry",
    family: "fail-closed",
    catalogue: "extra",
    description: "An end is written onto the winner's row once, never retried.",
    protection: "Finding R52: a third write between the lost save and the merge does not drop the end.",
    edits: [{
      file: SESSION,
      find: "    for (let attempt = 0; attempt < 3; attempt += 1) {\n      const winner = toRecord(current.session);\n      if (winner.selectedVehicleId !== finding.vehicleId",
      replace: "    for (let attempt = 0; attempt < (finding.kind === \"end\" ? 1 : 3); attempt += 1) {\n      const winner = toRecord(current.session);\n      if (winner.selectedVehicleId !== finding.vehicleId",
    }],
    testFiles: [T.session],
  },
  {
    id: "R52-end-vanish",
    family: "fail-closed",
    catalogue: "extra",
    description: "A merge that finds its row deleted answers as if the session still existed.",
    protection: "Finding R52: a session deleted between a lost save and the merge is gone, and the request says so.",
    edits: [{
      file: SESSION,
      find: "      if (outcome.outcome === \"saved\") return { row: { session, version: outcome.version }, written: write };\n      if (!outcome.stored) throw new SessionExpiredError();",
      replace: "      if (outcome.outcome === \"saved\") return { row: { session, version: outcome.version }, written: write };\n      if (!outcome.stored) return { row: current };",
    }],
    testFiles: [T.session],
  },
  {
    id: "R53-anchor-loop",
    family: "fail-closed",
    catalogue: "extra",
    description: "Round a loop, every sighting off the stop moves the watch's anchor, past it too.",
    protection: "Finding R53: round a loop the anchor is a sighting on the shorter way before the stop, so a too-soon sighting past it never replaces it.",
    edits: [{
      file: SESSION,
      find: "(place.backward === undefined || place.forward < place.backward)",
      replace: "(place.backward === undefined || place.forward > 0)",
    }],
    testFiles: [T.session],
  },
  {
    id: "R53-out-of-sight",
    family: "fail-closed",
    catalogue: "extra",
    description: "The selected bus out of sight clears the watch's anchor.",
    protection: "Finding R53: the last sighting before the stop stays the anchor while the selected bus is out of sight.",
    edits: [{
      file: SESSION,
      find: "      : watch.selectedPlace;",
      replace: "      : place === undefined ? undefined : watch.selectedPlace;",
    }],
    testFiles: [T.session],
  },
  {
    id: "R54-latest-row",
    family: "fail-closed",
    catalogue: "extra",
    description: "The answer after a merge is drawn from the row of the first winner, not the latest one the merge read.",
    protection: "Finding R54: the answer is drawn from the newest row a merge has seen, a withdrawn one included.",
    edits: [{
      file: SESSION,
      find: "    const latest = toRecord(merged.row.session);",
      replace: "    const latest = toRecord(outcome.stored.session);",
    }],
    testFiles: [T.session],
  },
  {
    id: "R54-give-up",
    family: "fail-closed",
    catalogue: "extra",
    description: "A merge that gives up after three conflicts returns the first winner's row, not the latest one it read.",
    protection: "Finding R54: a merge that gives up has read newer state, a withdrawal included, and answers from it.",
    edits: [{
      file: SESSION,
      find: "    return { row: current };\n  }\n\n  /** The watch's look at this request's snapshot with the winner's memory instead of this request's own (finding R50). */",
      replace: "    return { row: stored };\n  }\n\n  /** The watch's look at this request's snapshot with the winner's memory instead of this request's own (finding R50). */",
    }],
    testFiles: [T.session],
  },
  /* --------------------------------------------------- F21, F22 (issue #61) */
  {
    id: "F21-sticky-contest",
    family: "fail-closed",
    catalogue: "required",
    description: "A contest the session has already seen no longer withholds: the approach is judged on the instantaneous gap alone again.",
    protection: "Finding F21 (issue #61): once a waiting session has seen a follower inside the margin, a later wider gap does not make the leader selectable.",
    edits: [{
      file: MATCHING,
      find: '    abstentions.add("approach_contested_during_session");',
      replace: "    { /* Negative control F21: a remembered contest is ignored. */ }",
    }],
    testFiles: [T.matching],
    mustBeKilledBy: [
      "F21 regression: an approach once contested inside the margin must not become automatically selectable just because the gap later opens",
    ],
  },
  {
    id: "F22-contest-before-selectable",
    family: "fail-closed",
    catalogue: "required",
    description: "A pair seen inside the margin while nothing is selectable yet (cadence not fresh, or beyond the approach window) is no longer remembered as a contest.",
    protection: "Finding F22 (issue #61): the two vehicles nearest the stop seen inside the margin contest the approach whether or not a leader was selectable at that look.",
    edits: [{
      file: MATCHING,
      find: "    passage.memory.contestedApproach = { at: request.now };\n  }",
      replace: "    { /* Negative control F22: a contest seen before any leader was selectable is forgotten. */ }\n  }",
    }],
    testFiles: [T.matching],
    mustBeKilledBy: [
      "F22 regression: a follower seen inside the margin while nothing was selectable yet still contests the approach",
      "F22 regression: a pair inside the margin beyond the approach window contests the approach",
    ],
  },
];

/**
 * Structural checks on the catalogue itself, run before anything is copied.
 * Returns every problem found; an empty list means the catalogue is usable.
 */
export function validateCatalogue(controls: readonly NegativeControl[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const control of controls) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(control.id)) problems.push(`${control.id}: id must be alphanumeric with dashes`);
    if (ids.has(control.id)) problems.push(`${control.id}: duplicate id`);
    ids.add(control.id);
    if (control.edits.length === 0) problems.push(`${control.id}: no edits`);
    if (control.testFiles.length === 0) problems.push(`${control.id}: no test files`);
    for (const edit of control.edits) {
      if (!isServiceSource(edit.file)) problems.push(`${control.id}: ${edit.file} is not a services/api source file`);
      if (edit.find.length === 0) problems.push(`${control.id}: empty find in ${edit.file}`);
      if (edit.find === edit.replace) problems.push(`${control.id}: an edit of ${edit.file} changes nothing`);
    }
    for (const file of control.testFiles) {
      if (!/^services\/api\/test\/[A-Za-z0-9_.-]+\.test\.ts$/.test(file)) problems.push(`${control.id}: ${file} is not a services/api test file`);
    }
    for (const name of control.mustBeKilledBy ?? []) {
      if (name.trim().length === 0) problems.push(`${control.id}: empty mustBeKilledBy entry`);
    }
  }
  return problems;
}

function isServiceSource(file: string): boolean {
  if (file.includes("\\") || file.split("/").some((part) => part === ".." || part === "." || part === "")) return false;
  return file.startsWith("services/api/") && !file.startsWith("services/api/node_modules/") && !file.startsWith("services/api/test/");
}

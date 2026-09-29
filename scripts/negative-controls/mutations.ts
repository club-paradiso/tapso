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
      find: '        withhold("boarding_stop_reached_during_session");\n      }\n    } else {',
      replace: "        { /* Negative control F4: a bus at or crossing the boarding stop no longer withholds the session. */ }\n      }\n    } else {",
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
      find: 'withhold("vehicle_may_have_reached_boarding_stop_unobserved");',
      replace: "{ /* Negative control F4-unobserved: a possible unobserved arrival no longer withholds. */ }",
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
      find: '        withhold("vehicle_left_on_board_window_during_session");\n      }\n    }\n    const range',
      replace: "        { /* Negative control F4-onboard-left: a bus leaving the on-board window no longer withholds. */ }\n      }\n    }\n    const range",
    }],
    testFiles: [T.matching, T.properties, T.session],
  },
  {
    id: "F4-onboard-roster",
    family: "F4",
    catalogue: "extra",
    description: "On board, a vehicle absent from the session's first snapshot is no longer excluded.",
    protection: "An on-board rider's bus must have been in the feed when they said they had boarded; a bus that turns up later is not theirs.",
    edits: [{
      file: MATCHING,
      find: 'if (riderState === "on_board" && !initial.includes(vehicleId)) excluded.set(vehicleId, "not_present_when_rider_boarded");',
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
      find: "const reach = 1 + Math.floor(Math.min(ageSeconds, policy.memoryWindowSeconds) / policy.rememberedSecondsPerStop);",
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
        find: 'import { matchVehicleWithSourceFreshness } from "./matching.ts";\n',
        replace: lines(
          'import { matchVehicleWithSourceFreshness } from "./matching.ts";',
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
      find: '      if (seen.min <= -1 && offset >= 0) withhold("boarding_stop_reached_during_session");',
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
      find: '    } else if (seen.max >= -1 && seen.max <= policy.onBoardWindowStops && offset > policy.onBoardWindowStops) {\n      withhold("vehicle_left_on_board_window_during_session");',
      replace: "    } else if (false) {\n      /* Negative control F10-remembered-window */",
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
      find: "  if (riderState === \"waiting_at_stop\" && prior === undefined && request.declaredAt !== undefined) {",
      replace: "  if (false) {",
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

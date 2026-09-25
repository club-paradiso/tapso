# Passive Shadow Validation v3 — ExecPlan

Living document for `passive-shadow-validation-v3`. It follows `.agent/PLANS.md`.
Every phase re-reads the relevant section before it starts. Reality labels:
`VERIFIED_FROM_SOURCE` (read in this repository), `VERIFIED_LIVE` (observed
against a live provider during this task), `SIMULATED` (synthetic or perturbed
data), `INFERRED` (reasoned, not measured), `UNVERIFIED`.

## Outcome and non-goals

**Outcome.** A reproducible pipeline that turns real, passively observed TAGO
vehicle trajectories into blind pseudo-boarding cases, replays the production
matcher on them without the answer, and scores the result afterwards, so that
part of the matcher evidence the broad-real-mode gate needs can be gathered
without a human repeatedly riding buses.

**Non-goals.**

- Enabling automatic matching. `TRANSIT_AUTOMATIC_MATCHING_ENABLED` stays
  `false`. No production flag is touched.
- Changing, reinterpreting or re-counting v1 (`broad-real-mode-30-boardings-v1`)
  or beta v2 (`beta-matcher-30-boardings-v2`) evidence.
- A second matcher, a second TAGO client, or a second ride analyser.
- Relaxing any threshold in `sourceFreshness.ts`, `matching.ts`,
  `rideCampaign.ts` or `betaCampaign.ts`.

---

## Phase 1 — Architecture audit (`VERIFIED_FROM_SOURCE`, main @ `fa7ec0e`)

### 1. What the matcher consumes

`services/api/src/matching.ts` → `matchVehicleWithSourceFreshness(request, trustedFreshness)`.

- `MatchRequest` (`domain.ts`): `routeId`, `boardingStopSequence`,
  optional `boardingLatitude/Longitude`, optional `directionCode`, `now`,
  `candidates: VehicleObservation[]`.
- `trustedFreshness`: `Map<vehicleId, SourceFreshnessEvidence>` built by
  `classifyTagoCadenceFreshness` (`sourceFreshness.ts`) from the session's own
  consecutive server receipts (`receivedAt`), policy `TAGO_CADENCE_POLICY_V1`
  (window 90 s, ≥3 samples, span ≥10 s, newest receipt ≤30 s old, max gap 30 s,
  content must change, any stop-sequence decrease ⇒ `stale`).
- Score per candidate: route match +30 (else reject `wrong_route`); direction
  +25 only when the request carries `directionCode` (a mismatch rejects
  `wrong_direction`); TAGO freshness +25 only when cadence is `fresh` (else
  reject `source_cadence_not_fresh` / `stale_or_invalid_timestamp`);
  stop position `+max(0, 20 − 5·|seq − boardingSeq|)`, reject when
  `|delta| > 4` (`implausible_boarding_position`).
- Decision: no eligible ⇒ `unavailable`; top two eligible within
  `AMBIGUITY_MARGIN = 12` ⇒ `ambiguous`; else `matched`.

**Finding F1 (`VERIFIED_FROM_SOURCE`).** The stop-position term uses
`|delta|`. The matcher cannot distinguish a bus two stops *before* the
boarding stop (approaching) from one two stops *after* it (already departed).
Whether that produces wrong commits in real traffic is exactly the kind of
question passive data can answer.

**Finding F2 (`VERIFIED_FROM_SOURCE`).** `TagoTransitProvider.vehicles()`
never sets `directionCode`; direction identity lives in the TAGO `routeId`
(six Route 365 variants). With TAGO data the direction term is inert unless a
client sends `directionCode`, in which case every TAGO candidate is rejected
(`candidate.directionCode` is `undefined`).

### 2. What a committed vehicle selection is

- Live: `JourneySessionCoordinator.evaluateSnapshot` (`journeySession.ts`)
  assigns `record.selectedVehicleId` on the first `matched` result **only when
  automatic matching is enabled**; it is never silently replaced. In shadow
  mode (the production posture) it publishes `shadowSelection.wouldSelectVehicleId`.
- Replay: `replayMatching` (`matchReplay.ts`) records `firstCommit` = first
  snapshot whose result is `matched`; `selectionVerdict` compares it to the
  boarded vehicle.

### 3. Where ground truth comes from today

- v1 operator rides: the vehicle number the operator typed (`boardedVehicleId`).
- v2 beta rides: tester-entered bus + plate suffix, re-verified by the collector
  on an uncached provider read at start
  (`groundTruth: "tester_confirmed_vehicle_server_verified_at_start"`).
- In both, a human identifies the bus.

**Finding F3 (`VERIFIED_FROM_SOURCE`) — latent label leak in the existing
replay.** `replayMatching` derives the request `directionCode` from the
*boarded* vehicle (`rideDirectionCode(snapshots, boarded)`), and
`analyzeRideCapture` labels the boarded vehicle `tracked`. Both read the
answer. For TAGO data the direction leak is inert (F2: TAGO observations carry
no `directionCode`), and the label only renames. v3 therefore always calls
`replayMatching` with `boardedVehicleId` **absent** and with blind labels, and
a test pins that.

### 4. Reusable unchanged

| Component | File | v3 use |
|---|---|---|
| Matcher | `matching.ts` | called only through `replayMatching` |
| Replay | `matchReplay.ts` `replayMatching` | the blind replay engine; one additive, opt-in decision-timeline output |
| Cadence surrogate | `sourceFreshness.ts` | unchanged; its policy constants are imported, not copied |
| TAGO client | `tagoProvider.ts` `TagoTransitProvider` | the only TAGO client; used through the `TransitProvider` interface |
| Capture types | `rideCapture.ts` `RideSnapshot`, `StopOnRoute`, `classifyTopology` | stream format and topology |
| Stats | `stats.ts` `summarize` | distributions |

### 5. Must not be duplicated

Matcher scoring, cadence classification, the TAGO HTTP client,
`analyzeRideCapture`, the v1/v2 campaign classifiers, the Upstash stores.

### 6. Can passive observation evaluate matcher correctness?

Partly (`INFERRED`, stated as a model assumption, not a fact):

- A rider waiting at stop *S* who starts a session at *T0* boards, in the
  passive model, **the first vehicle of that route to reach *S* after *T0***.
  That vehicle is determinable from the trajectory *after the fact*, without
  the matcher, when its stop-sequence crossing of *S* is bracketed tightly and
  no other vehicle could have reached *S* first.
- This is an **assumption about rider behaviour** (riders sometimes let a full
  bus go, or run for one that is already leaving). It is labelled
  `ground_truth.source = "passive_first_arrival_model"` on every case, never
  presented as an observed boarding.
- It tests matcher sub-property A (vehicle identity among real candidates)
  under that model, with real candidate sets, real cadence and real competitor
  geometry. It cannot observe which bus a person actually boarded.

### 7. Properties that fundamentally need a human rider

Which physical bus a person boarded (the assumption above replaces it);
where they actually stood; physical stop timing (marker lag); phone/Safari
lifecycle; the real-iPhone restart path.

### Property table

| Property | Passive validation possible? | Evidence source | Remaining limitation |
|---|---|---|---|
| A. Matcher correctness (identity among candidates) | **Partially** | Real TAGO trajectories → blind pseudo-boarding cases → `replayMatching` | Ground truth rests on the first-arrival rider model; not an observed boarding |
| A′. Candidate ambiguity / margin distribution | **Yes** | Real multi-vehicle snapshots | Only for routes/times actually observed |
| B. Freshness / provider behaviour (cadence, dropouts) | **Yes** for receipt cadence and content-change cadence | Collector receipts | Provider observation lag stays unmeasurable (TAGO has no timestamp) |
| B′. Provider lag vs physical stop | **No** | Needs physical markers | Operator v1 campaign only |
| C. User interaction correctness (right bus, right stop entered) | **No** | Needs a person | Beta v2 / v1 only |
| D. Restart UX on a real phone | **No** | Needs a device | Partially verified per `KNOWN_ISSUES.md`; unchanged |

### Runtime constraints found in Phase 1

- **Network (`VERIFIED_LIVE`, 2026-09-25).** This task's container egress
  policy rejects `apis.data.go.kr`, `tapso-api.vercel.app` and Railway hosts
  (`CONNECT 403`, organisation policy). Live collection cannot run from this
  container. See Phase 7 for the executor chosen instead.
- **Credentials.** This task does not read or print credentials. No TAGO key
  is available to this container.
- **TAGO quota.** No numeric daily quota is documented anywhere in the
  repository (`DATA MISSING`). The only documented budget is
  `RIDE_CAPTURE.md`: a 90-minute 5 s ride "≤ 1 080 location calls" is "far
  below the development quota". v3 bounds a direct-TAGO run to that same
  1 080-call budget in total, across all routes.
- **Historical raw captures.** None exist in the repository or workspace
  (`work/` absent; git history has no raw capture). The 13 audited historical
  rides are `REPORT_ONLY_NO_RAW` (`DATA_VALIDATION.md`). Upstash submissions
  are unreachable from this container.
- **Swift matcher.** `packages/transit-core` has its own
  `VehicleMatchingEngine`; v3 evaluates the backend matcher that serves
  journey sessions, not the Swift engine (`KNOWN_ISSUES.md` already records
  that the two are not generated from one specification).

---

## Phase 2 — v3 validation model (design)

Campaign / policy: `passive-shadow-validation-v3` (`PASSIVE_SHADOW_POLICY_VERSION`).
It coexists with v1 and v2: separate module, separate artifacts, no shared
counters, no Upstash writes to the v1/v2 key prefixes.

### Evidence classes (`sourceClass`)

| Class | Produced by | May count as live passive evidence? |
|---|---|---|
| `LIVE_PASSIVE` | a stream whose every successful snapshot came from a live provider read made by the v3 collector | **yes**, and only this |
| `HISTORICAL_REAL` | a replayable raw capture of real observations from before v3 | supporting only, reported separately |
| `HISTORICAL_REPORT_ONLY` | a report without raw | analytical support only; never replayed, never counted |
| `SYNTHETIC_OR_PERTURBED` | fixtures, synthetic trajectories, any perturbation of a real case | **never**; robustness only |

The class travels on the stream, is copied onto every case and result, and
the summariser refuses to put anything but `LIVE_PASSIVE` into the live
section (tested).

### Unit of evaluation

One *pseudo-boarding case*: route, boarding stop sequence *S*, session start
*T0*, a scenario, and an evaluation window of real snapshots. It is split at
creation into two objects that are stored and passed separately:

- `PassiveMatcherInput` — a `RideCapture`-shaped object (route, city, stops,
  boarding/destination sequence, window snapshots) with **no**
  `boardedVehicleId` and no ground-truth field. This is all the matcher sees.
- `PassiveGroundTruth` — `{ caseId, vehicleId, source, confidence, provenance }`,
  held in a `GroundTruthVault` that only the evaluator reads, after replay.

### Scenarios

- `WAIT_AT_STOP` (primary): *T0* on a fixed grid independent of any vehicle
  (a rider arriving at a random moment). Ground truth = first vehicle to reach
  *S* after *T0*.
- `ON_BOARD_START`: *T0* = first snapshot showing the ground-truth vehicle at
  or past *S* (a rider who opens the app once on board). Reported separately.

### Ground-truth qualification (generator rejects rather than guesses)

A case exists only when all hold; otherwise the candidate case is counted in
`generatorRejections` by reason and never becomes a case:

- The ground-truth vehicle's crossing of *S* is bracketed by two consecutive
  successful sightings `prev.seq < S ≤ next.seq`, bracket width ≤ 90 s, and a
  stop jump ≤ 3 across the bracket.
- The crossing starts after *T0* (no bracket straddles *T0*).
- No other vehicle could have reached *S* in `(T0, crossing]`: no overlapping
  crossing bracket, no vehicle first sighted already at/after *S* inside the
  interval, no vehicle that vanished before *S* inside it.
- Wait ≤ 20 min; the stream covers the whole window
  (`[T0, boarding + 5 min]`); at least one successful snapshot in the window.
- Trajectories are split on an absence > 120 s or a stop-sequence decrease > 2
  (a new trip), so one vehicle's two trips are two trajectories.

### Result buckets (precedence top to bottom)

| Bucket | When |
|---|---|
| `PASSIVE_WRONG` | the first commit is not the ground-truth vehicle |
| `PASSIVE_STALE_FAILURE` | any selection of a TAGO vehicle whose cadence was not `fresh` (`selectionsWhileNotFresh > 0`) |
| `PASSIVE_DIRECTION_FAILURE` | the committed vehicle reported a stop-sequence decrease or a `directionCode` change inside the window up to the commit |
| `PASSIVE_CORRECT` | the first commit is the ground-truth vehicle and none of the above |
| `PASSIVE_PROVIDER_FAILURE` | no commit, and failed polls are ≥ 20 % of the window's polls or a failure run exceeds the 30 s cadence gap |
| `PASSIVE_INSUFFICIENT_EVIDENCE` | no commit, and the window has fewer successful receipts or less span than the cadence policy's own minimums |
| `PASSIVE_AMBIGUOUS` | no commit, and the matcher returned `ambiguous` at least once |
| `PASSIVE_ABSTAINED` | no commit otherwise |

Failures are classified first so that a provider problem can never hide a
wrong commit. `never_committed` is never counted as correct.

### Metrics (all with explicit denominators)

Raw cases, distinct boarding events, trajectories, vehicles, routes; counts by
route, vehicle pseudonym, KST hour, scenario and difficulty; every bucket;
committed-selection precision = correct / all commits; coverage = commits /
evaluable; wrong-commit rate = wrong / evaluable; abstention rate =
(abstained + ambiguous) / evaluable; where *evaluable* excludes provider
failure and insufficient evidence. The same numbers are also given grouped by
trajectory (a trajectory is wrong if any of its cases is wrong) so correlated
cases cannot pose as independent rides.

Difficulty: `SINGLE_CANDIDATE` (no other vehicle within ±4 stops of *S* at any
decision point), `CONTESTED` (≥ 2 vehicles within ±4 stops at some decision
point), `DEPARTED_DECOY` (a vehicle already past *S* within 4 stops at some
decision point before boarding — the F1 hazard).

### Release evidence

No threshold is proposed in this phase. Initial hypothesis (recorded before
any live data): *if F1 is real, `WAIT_AT_STOP` cases with a departed decoy
will show wrong commits on frequent routes*. The final recommendation is
written in Phase 8 from what was observed.

---

## Phases 3–5 — implementation (`VERIFIED_FROM_SOURCE`, tested)

| File | Role | Reuses |
|---|---|---|
| `services/api/src/passiveShadow.ts` | stream type, source classes, trajectories, first-arrival ground truth, case generator, `GroundTruthVault`, `assertBlindMatcherInput` | `RideSnapshot`, `RideCapture` shape |
| `services/api/src/passiveShadowEvaluate.ts` | blind replay → reveal → v3 bucket; difficulty; wrong-commit kind | `replayMatching` (no `boardedVehicleId`), `TAGO_CADENCE_POLICY_V1` minimums |
| `services/api/src/passiveShadowPerturb.ts` | 17 deterministic adversarial variants in 6 families, all `SYNTHETIC_OR_PERTURBED` | same replay |
| `services/api/src/passiveShadowSummary.ts` | live vs adversarial sections, metrics, grouped counts, sanitized diagnostics | `summarize` |
| `services/api/src/passiveShadowPipeline.ts` | streams → summary in one call | — |
| `services/api/src/passiveShadowCollector.ts` | bounded multi-route rider-free collector, preflight route selection | `TransitProvider` interface |
| `services/api/src/tapsoPublicApiProvider.ts` | read-only adapter for TAPSO's own public `/v1/*` (for a runner with no TAGO key) | — (not a TAGO client) |
| `services/api/src/matchReplay.ts` | **one additive change**: opt-in `recordDecisions` returns a per-decision timeline; default output byte-identical (tested) | — |
| `scripts/passive-shadow/collect.ts`, `evaluate.ts` | CLI; raw output only under ignored `work/` | — |

Collector bounds: interval floor 3 s, duration cap 90 min, a hard provider-call
budget (direct TAGO capped at 1 080 calls in total, the one documented
budget), stop on 10 consecutive failures or ≥ 50 % failures over the last 20
reads. A failed read is stored as a failed snapshot, never as an empty route.
When reads come through a shared cache, a re-served receipt is dropped and
counted (`duplicateReceiptsDropped`) instead of posing as new cadence.

Adversarial families: poll dropout (every 3rd, every 5th, seeded 20 %, 60 s
outage before boarding); delay (provider content lag 10/20/40 s with receipt
times untouched; receipt jitter 10/20/40 s with content untouched);
stale repetition (60/120 s frozen rows before boarding); vehicle
disappearance (ground truth / nearest real competitor, 60 s); competitor
pressure (synthetic shadow one stop behind); direction ambiguity (synthetic
opposite-route twin, synthetic reversing decoy). Variants that used the
answer's identity are flagged `usesTruthIdentity`.

Rejected approaches:

- Scoring through `analyzeRideCapture` — it labels the boarded vehicle
  `tracked` and would require `boardedVehicleId` in the input (F3).
- Deriving ground truth from which vehicle the matcher preferred — circular.
- Picking only the one visible vehicle as ground truth — produces easy cases;
  instead every stop × start is generated and difficulty is reported.
- A new direct TAGO client for the runner — the one `TagoTransitProvider` is
  used when a key exists; otherwise the public TAPSO API is read.

## Phase 6 — tests and negative controls

New tests: `services/api/test/passiveShadow.test.ts` (21) and
`passiveShadowCollector.test.ts` (8). Synthetic helper
`test/syntheticPassive.ts` is labelled synthetic and forces
`sourceClass = SYNTHETIC_OR_PERTURBED`.

Commands and results (2026-09-25, this container):

| Command | Result |
|---|---|
| `npm --prefix services/api test` | 383 / 383 pass (after `npm install --prefix services/api --omit=optional` as CI does; without it 1 pre-existing test fails on the missing `web-push` package) |
| `(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)` | clean |

Negative controls — each protection deliberately broken, suite run, code restored:

| # | Protection removed | Tests that failed |
|---|---|---|
| NC1 | generator writes `boardedVehicleId` into the matcher input | 13 of 21, incl. the input-whitelist test and the vault-order test |
| NC1b | evaluator opens the vault first and passes `boardedVehicleId` to `replayMatching` | 1: "the replay never receives the answer, and the vault opens only after it" |
| NC2 | evaluator treats a wrong first commit as correct | 3, incl. the real-matcher departed-decoy test |
| NC3 | `classifyTagoCadenceFreshness` treats unchanged content as fresh | **first attempt: 0 failures** — the frozen-content assertion (`staleRejections > 0`) was satisfied by unrelated early rejections. The test was rewritten to assert no commit and no `fresh` cadence in the frozen tail; rerun: 1 failure ("frozen provider content never unlocks a selection …") |
| NC4 | matcher accepts non-fresh cadence | 5 |

NC3's first result is recorded on purpose: it is exactly the "test that passes
with its protection removed" failure this phase exists to find.

Synthetic finding (`SIMULATED`, not field evidence): with a bus two stops past
the boarding stop and the next bus five stops away, the production matcher
commits to the departed bus (test "the real matcher commits to a departed
decoy"). This demonstrates F1 is reachable by the real matcher; whether it
happens in real traffic is for Phase 7 to observe.

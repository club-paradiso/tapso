# Matcher safety evidence v4 — the evidence package

Release gate **`matcher-passive-safety-v4`**. Method and progress:
`../exec-plans/HUMAN_LABOR_ELIMINATION.md`. Machine-readable gate result:
`../../artifacts/matcher-passive-safety-v4/gate-result.json`.

**Readiness awarded: `READY_FOR_SHADOW`.** Automatic matching stays off, and
the configuration now refuses it below `READY_FOR_BOUNDED_AUTOMATION`. The path
to `READY_FOR_CONFIRMATION_ASSISTED` needs no human ride: it needs the
automated evidence workflow to run (see "Blocker" below).

Every number below carries its evidence label. Simulated and counterfactual
results are never counted as live, and report-only history contributes no
matcher result.

## 1. Matcher before and after

| | `symmetric-stop-distance-v0` (legacy) | `directed-route-progress-v1` (now) |
|---|---|---|
| Position term | `20 − 5·|seq − S|`, symmetric | directed: only 1–4 stops *before* S selectable for a waiting rider |
| Bus at S or one past it | selectable (score 20 / 15) | blocks every selection |
| Departed bus (≥ +2) | selectable up to +4 | never selectable, never a competitor |
| Non-fresh competitor | ignored | competes |
| Margin | 12 position points among eligible buses in the ±4 window | three stops over every vehicle heading for the stop, wherever it is (F9) |
| Vehicle missing from one poll | forgotten | remembered 90 s, competing from wherever it could have reached; a crossing it showed is not forgotten (F10); past 90 s still competing from session memory, its reach growing with the time since (F15) |
| A bus reached the stop during the session | irrelevant | withholds for the rest of the session (F4), also when first seen already past it at any look (F12, F16), when lost while it could by now have reached it (F15), across a loop's seam (F17), and for a session stored without memory (F11) |
| Rider already aboard | same rule as waiting | separate rule: +1…+4, only one vehicle; a bus missing from the first snapshot never selected, still competing (F16); round a loop, a bus that came back to the stop or had time to never selected, and a lap under ten stops selects nothing (R23); a bus placed twice never excluded by it (R27) nor forgotten for it (R30); one never placed, next seen beyond the window where the rider's bus could have got to since the declaration, withholds (R30, R40) |
| After an automatic selection | tracked to the end, whatever happens | until the selected bus is seen reaching the stop (a sighting, never a reason memory raises: R31; a crossing timed from its last sighting before the stop: R42), another bus seen reaching it first withdraws the selection for good and the rider is asked (F20; round a loop a reading a stop or two back is no sighting: R43), across concurrent writes both ways (R33, R44) |
| Missing topology / repeated stop name / two stops under one sequence | not checked | withholds (F18) |
| Invariant | none | `assertDirectedInvariant` on every result |

## 2. All 268 former wrong commits

`FORMER_WRONG_COMMITS_UNDER_DIRECTED_POLICY.md` lists each one
(`VERIFIED_BY_REPLAY`, instant level, from the evidence-of-record ledger,
sha256 `a960d428…8773`): **268 of 268 → no selection** at the former commit
instant. The legacy policy reproduces all 268 recorded selections on the same
reconstruction. The former pick is refused as `departed` (251) or
`boarding_stop_unresolved` (17); the true bus was beyond the window (200) or
absent from the feed (68).

Full-window outcomes (what the directed policy does later in each window) are
**`MISSING`**: they need the raw streams, which only a workflow run can read
(§ Blocker). The tooling is ready: `scripts/passive-shadow/migrate.ts` replays
every case under both policies, refuses unless the legacy side reproduces the
recorded buckets and exactly the recorded 268 case ids, and fails on any new
wrong commit or any correct→wrong regression.

## 3. Regression ledger — defects found by this work

| Id | Found by | Defect | Fix |
|---|---|---|---|
| F1 | Passive v3, live | Departed buses selected | Directed policy |
| F3 | Passive v3, code reading | Replay derived direction from the answer | `replayBlind` has no parameter for the answer |
| F4 | `migrate.ts` on a synthetic collection (`SIMULATED`): 6 correct→wrong | After the rider's bus reached the stop unselected, the bus behind it was selected | Session `PassageMemory` |
| F5 | Property P2, seed 10156 | Off-route stop sequence folded into a loop position | Off-route = unknown, blocks |
| F6 | Code reading | Railway/beta captures replayed as waiting riders | Rider state from the start declaration |
| F7 | Property P3, seed 14526 (deep run) | Irrelevant duplicate row withheld; dropping it released | Duplicate withholds only when relevant |
| F8 | Property P7, seed 12091 (deep run) | Remembered vehicle placed at its last sighting; hidden advance let a follower lead | Forward-widening memory; unobserved possible passage withholds; on-board bus must be present at declaration |
| F9 | Counterfactual family `follower_overtaking` (`SIMULATED`) | The three-stop margin, on the legacy points scale, ignored followers behind the four-stop window; a bunching bus one stop behind a leader four stops out overtook it | Margin counted in stops against every vehicle heading for the stop |
| F10 | Property P3, seed 16661 (deep run) | Dropping the row that showed a crossing released the bus behind | Remembered sightings judged against passage memory |
| F11 | Audit of the session store | A session stored by the previous build carries no passage memory and would restart with an empty one | Such a session is withheld for good |
| F12 | Audit of session creation | A slow or failed first read hid a crossing before the first look | Late first look withholds when a bus past the stop could have been at it |
| F13 | Audit of the cadence surrogate | A late older receipt, or a second row in one snapshot, could manufacture a sample or a content change | Receipts only move forward |
| F14 | Audit of the blind-input guard | A per-vehicle or per-stop truth field would have reached the matcher | Every vehicle row and stop checked against the observation fields |
| F15 | Adversarial review, synthetic probes; property P3-forgotten, seed 10446; counterfactual `lost_leader` (`SIMULATED`) | A bus out of sight past the 90 s memory window was forgotten: a lost leader stopped counting against the bus behind it, a lost bus stopped competing for an on-board window, a bus of unknown progress left no memory | Out-of-sight vehicles block and compete at an uncapped reach; unknown progress out of sight withholds |
| F16 | Review, probes; property P3-empty-look, seed 10099 | A bus first seen past the stop was judged only at the session's first decision; on board, a bus missing from the first snapshot stopped competing | Every first sighting judged; unproven on-board buses compete |
| F17 | Review, probes; properties P3-crossing (seeds 10099, 10012) and P12-loops (seed 10037) | On a loop, memory compared plain offsets: a crossing at the seam, or a bus lost past the stop, went unnoticed; the first fix (directed offsets, the shorter way round) misread a short loop, excluding a bus in the on-board window | Round a loop, each sighting compared with the last by its distance to the stop each way |
| F18 | Review, probes | A loop's lap was counted in stop rows; a missing or repeated row moved the seam | Lap in sequences; conflicting rows withhold |
| F19 | Review, probes; property P13-routes, seed 10018 | The invariant read another route's row with the selected id (HTTP 500, order-dependent) | Two-route id withholds; invariant reads the request's route |
| F20 | Ground-truth fuzzing (`SIMULATED`): every wrong selection of a bus the feed had shown was an overtaking after the selection | A session kept tracking an automatically selected bus after another bus reached the stop first | The boarding watch: another bus seen at, crossing or first past the stop withdraws the selection for good; property P16 |

Findings of the adversarial reviews of this work itself (R1–R45: evidence
workflow, gate integrity, and the F15–F20 fixes, among them R23 a bus coming
back round a loop on board, R24 a lap between two sightings, R27 a bus placed
twice excluded by one place, R28–R29 receipt and clock timing, R30 a bus
placed twice forgotten on board, R31 the boarding watch ended by a reading
that shows no arrival, R32 a self-check that killed every control; from the
sixth review, R37–R39 and R41 tests the fifth pass lacked, R40 the
never-placed rule bounded by the motion model, R42 the watch's anchor, R43 a
loop read-back as a possibility, R44 a lost end merged, R45 the self-check
named by file and path) are listed with their fixes in the ExecPlan §3. Each
behavioural fix has a test that fails on the commit before it.

Every failing seed is replayed first on every run
(`services/api/test/fixtures/matcher-property-regressions.json`).

## 4. Property suite

`VERIFIED_BY_TEST`. `services/api/test/matcherProperties.test.ts`, seeded and
reproducible (`TAPSO_PROPERTY_CASES` raises the seed count). Sixteen
invariants, twelve further forms of them and a no-throw check: 29 property
tests.

| # | Invariant |
|---|---|
| P1 | A waiting rider's automatic selection is always 1–4 stops before the stop |
| P2 | Moving a departed or at-stop bus farther past the stop never makes it selectable or raises its score |
| P3 | Removing evidence (a row, cadence evidence, topology) never turns a withheld decision into a selection; a withheld session memory is never overridden; nor is one withheld by a vehicle out of sight past the memory window, by a crossing (across a loop's seam too), by a bus seen again after time enough to go round a loop, or after an earlier look that saw nothing |
| P4 | Older evidence never improves eligibility or score; a remembered vehicle competes at least as hard as its sighting ages |
| P5 | Server receipt time alone never manufactures freshness |
| P6 | Repeated unchanged provider content never unlocks automatic matching |
| P7 | A failed provider poll counts exactly as a poll never made; a window of failed polls never commits |
| P8 | A stop-sequence regression fails closed |
| P9 | Once a session selects a vehicle it never switches to another, and a withdrawn selection is never replaced automatically |
| P10 | The boarded vehicle's identity never changes a replayed decision |
| P11 | Unknown route progress fails closed |
| P12 | Two plausible vehicles too close together never produce a selection; nor two in the on-board window on a loop of any length; on board, a bus once seen before the stop, or one that came back to the stop round a loop, is never selected later |
| P13 | Identical input gives an identical decision in any candidate order; a vehicle also reported under another route is never selected; the order of a snapshot's rows never changes what the session remembers |
| P14 | A vehicle that is never valid is never committed, however long it is watched |
| P15 | Whatever is missing from the feed, a selection is always individually valid |
| P16 | Ground truth (`SIMULATED`, `groundTruthKit.ts`): an automatic selection is withdrawn by the poll that shows another bus reaching the stop first, and never after the selected bus was seen there |

| Run | Seeds per property | Result |
|---|---|---|
| Every CI run (`run-suite.ts --property-cases=2000`, `artifacts/matcher-directed-v1/test-suite.json`) | 2 000, after the 19 recorded regression seeds | 29 / 29 property tests pass; the whole suite 667 / 667 (the gate-output test is checked by `gate.ts --check` instead) |
| Deep run 1 (this work) | 20 000 | found P3 seed 14526 (F7) and P7 seed 12091 (F8) |
| Deep run 2 | 20 000 | found P3 seed 16661 (F10) |
| Deep run 3, the matcher before F15 | 20 000 | 19 / 19 pass, no new seed (1 987 s) |
| P16, P3-lap and P12-returned on `61d63be` | 20 000 | 3 / 3 pass, no new seed (440 s) |
| Deep run 4, the code of `aac505f` (before the sixth review) | 20 000 | 29 / 29 pass, no new seed (2 879 s) |
| Deep run 5, the final code (`4141f38`) | 20 000 | 29 / 29 pass, no new seed (2 429 s) |

The 19 regression seeds (`services/api/test/fixtures/matcher-property-regressions.json`)
are replayed first on every run, each with a note of what it caught: P2 10156
(F5); P3 10165 (the kit's dropout model forgot a duplicate row, and a
remembered vehicle of unknown progress now blocks); P12 10099 (the property's
statement was corrected); P6/P7/P10 10008 (the generator produced stop
sequence 0); P3 14526 (F7); P7 12091 (F8); P3 16661 (F10); P3-forgotten 10446
(F15); P3-crossing 10099 (F17) and 10012 (R17); P3-empty-look 10099 (F16);
P13-routes 10018 (F19); P12-loops 10037 (R17); P12-reached-after 10002 (R18);
P13-memory-order 10000 (R20); P12-returned 10011 (R23); P3-lap 10001 (R24).

### Negative controls

`VERIFIED_BY_TEST`. `scripts/negative-controls/run.ts --typecheck`
(`artifacts/matcher-directed-v1/negative-controls.json`, generated on commit
`f1fe79e`): **125 of 125 controls killed** (18 required,
107 extra), 0 survived, 0 stale, 0 invalid, 0 timed out, each by tests in
its own listed files. The baseline was green (667 / 667, no type error),
every kill was re-confirmed on the unmutated snapshot, and the working tree
did not change during the run. Each
control puts back one answer leak (F3, F6, F14), removes one fail-closed rule
of the directed matcher or the boarding watch, restores the legacy symmetric
term, or disables one of the gate's own integrity checks, in a private copy. A
mutant that adds a type error is `INVALID`, not killed: the F12 and
R43-read-back controls were rewritten for that reason. The ordinary suite checks that every control's
text still occurs in the source it edits, and the runner never counts that
check, or a subtest of it, as a killer, since every mutant fails it (R32;
named by file and path, R45): a control removed from under its tests is
reported `SURVIVED`. The gate pins every control id; CI
reruns the whole catalogue on every push and pull request.

## 5. Counterfactual suite

`SIMULATED`. Thirty-three counterfactual families (54 transformations) in
`services/api/src/passiveCounterfactual.ts`: departed and approaching decoys,
leaders and followers at 1–10 stops, overtaking, dwelling at the stop, the true
bus or every decoy removed, late appearance, disappearance and reappearance,
stale frames, coordinate and content freezes, receipt jitter, packet loss,
polling gaps, error bursts, loop seams, duplicated stop names, repeated
geometry, route-variant twins, backwards decoys, delayed and early movement,
several eligible or none, identity churn, and waiting or on-board session
starts. Each transformation re-derives the answer with the same first-arrival
model in the world it invented, and each family declares what must hold
(for example: never select the injected decoy; no commit on a frozen window).

Committed result, `artifacts/matcher-directed-v1/counterfactual-synthetic-summary.json`
(regenerated byte-for-byte in CI), over the synthetic bases of
`services/api/test/syntheticCounterfactualBases.ts`:

| Base | Base cases | Evaluations | Families applied / exercised | Correct | Wrong | Abstain | GT indeterminate | Invariant violations | Expectation failures |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| A (30 stops, 10 s polls) | 218 | 8 040 | 33 / 33 | 4 970 | **0** | 2 057 | 901 | **0** | **0** |
| R (36 stops, 20–40 s receipts) | 669 | 26 160 | 33 / 33 | 8 373 | **0** | 13 196 | 4 330 | **0** | **0** |

"Exercised" means the family's own expectations could be decided on at least
one case. One transformation, `long_polling_gap_120s`, never can (a 120 s gap
always splits the trajectory the model needs): it is reported, its family is
exercised by `long_polling_gap_110s_resumed`, and a test fails if any other
transformation goes unexercised (R26). The committed summary had fallen behind
that catalogue change and is regenerated with this package (R36).

The checks bite. The legacy matcher on the same bases (control, `SIMULATED`):
base A 1 026 wrong commits, 2 489 invariant violations, 2 819 expectation
failures, 32 of 33 families failing; base R 2 592 / 9 359 / 10 572, 32 of 33.
A test-only matcher with every protection removed trips each individual
expectation (`passiveCounterfactual.test.ts`, "every family expectation
bites"), and a transformation that does not produce the answer it declares is
flagged by the construction check.

What this suite changed: family `follower_overtaking` exposed F9 (the margin at
the window edge). Before the fix, the run that found it reported 4 wrong
commits in 20 applicable cases on base R, and 165 in 166 012 evaluations on a
scratch synthetic five-route hour (not committed); after it, none on either
committed base. `lost_leader_follower_k3_360s` pinned F15 (the previous
matcher selected the follower in 4 of 4 applicable base-A cases), and the
fourth review found two transformations that could never decide their own
expectations (R26).

**On real bases: `MISSING`.** `scripts/passive-shadow/counterfactual.ts` runs
the same catalogue over the Passive Shadow v3 raw streams in the evidence
workflow. Only a complete run (every case, the whole catalogue, the production
matcher and replay) can feed gate criterion CA-5, and only families actually
exercised count toward its 30.

## 5a. Ground-truth journey sessions

`SIMULATED`. `scripts/matcher-evidence/ground-truth-sessions.ts` writes
`artifacts/matcher-directed-v1/ground-truth-sessions.json` (regenerated
byte-for-byte in CI): 3 000 sessions generated by
`services/api/test/groundTruthKit.ts`. Buses move continuously at 20–90 s per
stop; some appear late, some vanish for a while, and any poll may drop one;
polls come every 10 s and 2 % fail. The rider waits from the first poll and
boards the first bus to reach the stop. The truth never reaches the session
coordinator, which runs in automatic mode, a mode no current readiness level
allows.

| Outcome | Sessions |
|---|---:|
| Automatic selections | 1 089 of 3 000 |
| Right: the bus the rider boards | 917 |
| Wrong: the boarded bus had not been in the feed before the selection | 157 |
| Wrong: the boarded bus had been in the feed | 12 |
| No bus reaches the stop within the session | 3 |
| Wrong selections withdrawn / kept | 77 / 92 |
| Right selections withdrawn (what the watch costs, on these feeds) | 38 |
| Wrong selections where the feed showed the boarded bus reaching the stop no later than the selected one | 67 |
| … of those not withdrawn by the poll that showed it (P16) | **0** |

Read as a model, not a rate: in this model 169 of 1 089 automatic selections
pick the wrong bus, 157 of them because the rider's bus had not appeared in
the feed yet. No matcher can pick a bus the feed does not show, which is why
automatic matching stays off and the rider confirms. What the feed does show,
the boarding watch acts on: every overtaking it showed was withdrawn by the
poll that showed it. The kit's feeds are monotone and list each bus once; the
jitter, duplicate rows and row orders that R31 is about are pinned by
deterministic session tests instead. What stale content and backward readings
cost, measured on the sixth review's scratch generators (not committed), is
in `KNOWN_ISSUES.md`: those feeds cost more right selections than these.

## 6. New passive live validation

**`MISSING`.** No new live window ran in this task. This session cannot reach
the provider or the artifact store, the integration cannot dispatch workflows,
and changing a trigger so that a push from this branch would start a
collection was refused. `.github/workflows/matcher-evidence.yml` runs one
bounded window a day after merge (seven route pools, one per KST weekday, in
three KST time bands: morning peak, daytime and evening peak) and the
evidence-of-record replay on the merge commit itself.

After each of those runs, its `gate-evidence` job recomputes the live gate
inputs from every raw collection still retained (this run's artifacts, earlier
runs' artifacts checked against their upload digests, and the vault checked
against its recorded checksums) with `scripts/matcher-evidence/live-evidence.ts`:
offline, network-guarded, twice with identical results required, each raw tree
hashed before and after, only `LIVE_PASSIVE` collections accepted, and the
legacy side required to reproduce the v3 record. Distinct vehicles are counted
by raw id in memory; only counts leave the job. It then evaluates this gate and
uploads the result as the `matcher-gate-evidence` artifact. That artifact is
informational: the readiness the code claims changes only in a reviewed commit
that also commits the inputs, and CI fails if the claim and the committed gate
result disagree.

## 7. Provider-path caveats

- The only live passive evidence (run `36098610702`) came through TAPSO's
  public API with a 20 s shared cache: genuine receipts ~30 s apart, equal to
  the cadence policy's 30 s maximum gap. Coverage from it does not transfer to
  a 5 s uncached session.
- Direct-TAGO collection needs a `TAGO_SERVICE_KEY` repository secret. With it
  the scheduled job switches to `tago-direct` automatically (30 min, ≤ 1 080
  calls). Gates BA-1 and BA-2 require such evidence: the bounded-automation
  sample is counted at session cadence only.
- The daily window reads production through the public API, which reaches
  TAGO at most once per 20 s per route (~900 upstream calls per window). No
  daily quota is documented (`MISSING`); one window a day matches the load of
  the one window already run without incident.

## 8. Evidence-substitution matrix

`EVIDENCE_SUBSTITUTION_MATRIX.md`. Summary: passed-bus rejection, stale-data
rejection, provider-failure handling, determinism and cross-language drift are
now covered **more strongly** than thirty rides could; identity correctness,
ambiguity (live), route diversity and cadence are **partial** until the
automated windows accumulate; provider lag, rider data entry and hardware UX are
**non-substitutable** and are designed out of the shipped safety contract.

## 9. Physical-only unknowns and the architecture response

| Unknown | Response |
|---|---|
| Provider reporting lag vs the physical stop | Not in the safety path of a confirmation-assisted product (the rider taps the bus they can see). Blocks automation (BA-4) |
| Whether riders board the first arriving bus | Same; required only for `READY_FOR_AUTOMATIC_MATCHING`, which is not a product target (AM-1) |
| Rider data-entry mistakes | Waiting is the default state; repeated stop names withhold; the rider confirms |
| Physical-device Live Activity | Device check (not a ride), required before automation (BA-5) |

## 10. Readiness classification

| Level | Status | Why |
|---|---|---|
| `READY_FOR_SHADOW` | **awarded** | SH-1…SH-6 pass (see gate result) |
| `READY_FOR_CONFIRMATION_ASSISTED` | not awarded | CA-1…CA-5 `MISSING` (full-window raw replay and real-base counterfactuals have not run); CA-6/CA-7 need ≥ 60 trajectories, ≥ 30 vehicles, ≥ 30 contested trajectories, ≥ 8 routes, ≥ 3 windows, ≥ 2 time bands — v3 alone has 29 trajectories with cases by its own split (the gate's unit can only merge them), 27 vehicles, 5 routes, 1 window and 1 time band (its 46 contested cases come from at most 29 trajectories; the exact counts need its raw) |
| `READY_FOR_BOUNDED_AUTOMATION` | not awarded | also needs 300 trajectories, direct-TAGO evidence, and three client/device mitigations that do not exist yet |
| `READY_FOR_AUTOMATIC_MATCHING` | not awarded, not a target | needs rider behaviour measured by humans |

## 11. Feature-flag recommendation

| Flag | Value | Reason |
|---|---|---|
| `TRANSIT_AUTOMATIC_MATCHING_ENABLED` | `false` (unset) everywhere | Readiness is below bounded automation; the configuration refuses `true` anyway and says so in `/health` |
| `TRANSIT_SESSIONS_ENABLED` on production | unchanged (off with the memory store) | Durable sessions are a separate decision |
| `BETA_TESTERS_ENABLED` on Railway | may stay as it is | Beta rides are no longer a release requirement; they harm nothing and count only toward the historical v2 campaign |

## 12. Machine-readable gate result

`../../artifacts/matcher-passive-safety-v4/gate-result.json`, regenerated and
compared in CI by `scripts/matcher-evidence/gate.ts --check`, which also fails
if the readiness the code claims (`services/api/src/matchingReadiness.ts`) is
not the readiness the gate awards. The live criteria read
`artifacts/matcher-directed-v1/live-replay-evidence.json` and
`counterfactual-live-evidence.json`; neither is committed yet, so those criteria
are `MISSING`.

What the gate refuses to count, each pinned by a test and a negative control:

- live or counterfactual evidence produced by other matcher and evaluation
  sources than the current ones (`sourceDigest.ts`): it is stale, so `MISSING`;
- a live replay that left out any retained artifact it could not fetch or
  verify (CA-1);
- a trajectory counted twice: the unit is one bus on one route direction in
  one window with an evaluated case, so a feed gap never splits a trip in two,
  and a window with no case adds no window, time band or provider path;
- contested *cases* in place of contested *trajectories* (CA-6, BA-1);
- for bounded automation, any sample not collected at session cadence (BA-1
  counts direct-TAGO windows only);
- a window's wrong commits after its raw expires: they are carried forward
  from the evidence recorded before, while its sample is not;
- a negative-control report missing any of the pinned control ids (SH-4);
- a human-only mitigation backed by tests not named for its criterion, or by a
  human record without its procedure, subject, performer, date and result.

CI cannot recompute the live inputs, because the raw collections are private.
What ties the committed counts to their inputs is the matcher digest, each
collection's raw tree hash and case-level decision digest, and the workflow's
own two-process byte comparison; anyone with repository access can re-run
`live-evidence.ts` on the same raw and compare.

## 13. Reproduce

```bash
npm install --prefix services/api --omit=optional --no-audit --no-fund
npm --prefix services/api test
node --experimental-strip-types scripts/matcher-evidence/run-suite.ts --property-cases=2000
node --experimental-strip-types scripts/negative-controls/run.ts --typecheck
node --experimental-strip-types scripts/matcher-evidence/redecide-ledger.ts
node --experimental-strip-types scripts/matcher-evidence/render-instants.ts
node --experimental-strip-types scripts/matcher-evidence/counterfactual-synthetic.ts
node --experimental-strip-types scripts/matcher-evidence/ground-truth-sessions.ts
node --experimental-strip-types scripts/matcher-evidence/gate.ts --check
# With a raw collection directory (private; never in Git):
node --experimental-strip-types scripts/passive-shadow/migrate.ts <dir> \
  --expect-raw-tree=bce8b504e5b287d9f86eb79345f7e50bdce4537625247c0dee164c2afb8c82fb \
  --expect-summary=artifacts/passive-shadow-validation-v3-summary.json \
  --expect-ledger=artifacts/passive-shadow-validation-v3-wrong-commits.json
node --experimental-strip-types scripts/passive-shadow/counterfactual.ts <dir> --out=<file>
# The live gate inputs from every retained raw collection (what the gate-evidence job runs):
node --experimental-strip-types scripts/matcher-evidence/live-evidence.ts <dir>... \
  --record=pv3-20260925T052712Z-f096de91,artifacts/passive-shadow-validation-v3-summary.json,artifacts/passive-shadow-validation-v3-wrong-commits.json \
  --counterfactual-on=pv3-20260925T052712Z-f096de91
```

## 14. Evidence hashes

sha256 of every evidence file this package cites, as committed with it:

| File | sha256 |
|---|---|
| `artifacts/passive-shadow-validation-v3-summary.json` | `0422f291e59738d82a73d222a522f6b5b743c322efae78ca4b812da4b54f5069` |
| `artifacts/passive-shadow-validation-v3-wrong-commits.json` | `a960d428caa9d967ddbde0e66f9f1a9963cfd65df519bc6acc58951532fd8773` |
| `artifacts/matcher-directed-v1/former-wrong-commit-instants.json` | `718b75e82f6cd30abdaadbe5280290309df4c07050f1541370efaf569e40841c` |
| `artifacts/matcher-directed-v1/counterfactual-synthetic-summary.json` | `257dce3cb09169c5ccc91710f14bb77d38046b45cae04d1ab42745084e198132` |
| `artifacts/matcher-directed-v1/ground-truth-sessions.json` | `b5405f6dc1051d4063e6652a1e338ac8e422846c6a9737f2567388ca0deccf6b` |
| `artifacts/matcher-directed-v1/test-suite.json` | `a355da6bc26849a08a1fb4cba962a346fedc3a361bd26f7486fea4d7b9627cd2` |
| `artifacts/matcher-directed-v1/negative-controls.json` | `a28a24ccc4457715ed9fa162232a1282922f5be08fa90fc9312dbd1d4530857a` |
| `artifacts/matcher-passive-safety-v4/gate-result.json` | `c4590d49120c93f5873b63814107b3d2f57a6930624236f1af2a702b5b834132` |
| `services/api/test/fixtures/matcher-property-regressions.json` | `1f7341f1955d42ef8b1f6873a04d1ff8240127948aa8093e64523c9034f29618` |
| `fixtures/transit/directed-matcher-invariants.json` | `a74fa7736732c4b9e68c2ede581864a10bec020402d25769a8358c3e1c361b99` |
| `ops/matcher-evidence/human-only-mitigations.json` | `005a4c5c66f73d5103d0aad73ea18c70e0b9e104a919d9903c7975f83fe47ba8` |
| `ops/matcher-evidence/request.json` | `0495a6e0ab715cb09ebbfd34cee5f9e6ede1029839cf2f3d59f9737f27c5d6e2` |

## 15. HUMAN LABOR ELIMINATION

Every human procedure the repository asked for before this work, as the
Phase 0 audit found them (H01–H52, with their file references in
`docs/exec-plans/HUMAN_LABOR_ELIMINATION.md` §10). Status vocabulary:
`ELIMINATED` (no longer needed by anything), `AUTOMATED` (a machine does it),
`REPLACED_BY_STRONGER_EVIDENCE` (the property it stood for is now established
another way), `NON-BLOCKING_UNVERIFIED` (still unmeasured, and designed out of
every readiness level the product targets now), `STILL_REQUIRED` (a person
must act). **No routine bus ride, stop marker, capture export or manual
analysis is `STILL_REQUIRED`.**

### Rides, markers and captures

| Id | Procedure | Status | What replaced it, or why it no longer blocks |
|---|---|---|---|
| H01 | Thirty v1 operator rides on the collector page | `REPLACED_BY_STRONGER_EVIDENCE` | Its safety role (the matcher never commits to the wrong or a departed bus) is carried by release gate v4: 268/268 former live wrong commits re-decided with no selection (`VERIFIED_BY_REPLAY`), the property, counterfactual and negative-control suites (`VERIFIED_BY_TEST`/`SIMULATED`), and the automated passive windows after merge (`VERIFIED_LIVE_PASSIVE`). The v1 campaign stays historical at zero boardings |
| H02 | Tap stops where the bus halts (marker lag) | `NON-BLOCKING_UNVERIFIED` | Provider lag against the physical stop cannot be measured without a person at the stop. Nothing below `READY_FOR_BOUNDED_AUTOMATION` depends on it (the rider confirms the bus they see); criterion BA-4 blocks automation on it |
| H03 | Thirty beta tester rides (v2) | `ELIMINATED` | Not a release requirement; the v2 campaign stays historical at zero boardings. The beta flow may keep running; its rides count only toward v2 |
| H04 | Task B controlled ride (CLI or phone controller) | `ELIMINATED` | Its captures are never counted (`captureEngine` `cli`/`local-device` have counting policy `UNRESOLVED`; only a `railway-background` capture can be a counted `CLEAN_GATE_CANDIDATE`); the freshness question it served is answered by the server-observed cadence rule and its tests (F13), and by live passive windows |
| H05 | Repeat rides on further routes | `AUTOMATED` | The scheduled workflow runs each of seven route pools once a week (by KST weekday); gate CA-7 counts routes, windows and time bands |
| H06 | Rides separating provider from collector lag, to calibrate cadence thresholds | `NON-BLOCKING_UNVERIFIED` | The thresholds are fail-closed (a non-fresh bus is never selected and still competes), so calibration moves coverage, not safety. Session-cadence (direct-TAGO) windows run automatically once the owner adds a `TAGO_SERVICE_KEY` secret (BA-2) |
| H07 | Acceptance rides (submission receipt, suspension, restart) | `ELIMINATED` | The phone capture pipeline is off the release path |
| H10–H12 | Phone controller checks; keep the screen on | `ELIMINATED` | Same |
| H13–H15 | Submit within 2 h; backup exports; send reports by hand | `ELIMINATED` | No ride is needed. Passive raw evidence is kept by the workflow (90-day artifact and private vault) |
| H23 | Measure how often riders board the first arriving bus | `NON-BLOCKING_UNVERIFIED` | Needed only for `READY_FOR_AUTOMATIC_MATCHING` (AM-1), which is not a product target |
| H40 | Pre-boarding production curls | `ELIMINATED` | No boarding |

### Analysis and judgement

| Id | Procedure | Status | Replacement |
|---|---|---|---|
| H16 | Run `analyze.ts` by hand | `ELIMINATED` | No human captures to analyse; passive evidence is analysed in the workflow |
| H17 | Re-classify stored rides under a newer matcher by hand | `AUTOMATED` | `scripts/passive-shadow/migrate.ts` replays every passive case under both policies in the workflow (twice, for determinism). Human campaigns are historical |
| H18 | Review campaign alerts before trusting counts | `ELIMINATED` | The release decision no longer reads ride counts |
| H19 | Judge the gate's prose criteria and edit the `/health` posture | `AUTOMATED` | Gate v4 is machine-checkable (`gate.ts --check` in CI); the configuration refuses automatic matching below the demonstrated readiness |
| H20 | Define and test a TAGO source-freshness rule | `REPLACED_BY_STRONGER_EVIDENCE` | `server_observed_cadence_v1` with property tests P4/P5 and F13 (`VERIFIED_BY_TEST`) |
| H21 | Decide whether local-device or CLI captures count | `ELIMINATED` | Moot: the ride campaigns are historical |
| H22 | Tune thresholds and observe what `nodeord` means at stops | `REPLACED_BY_STRONGER_EVIDENCE` | The blocking zone is safe under every reading of `nodeord` (§4 of the ExecPlan); a measurement could only widen coverage |
| H24 | Validate the Swift engine or build conformance tests | `REPLACED_BY_STRONGER_EVIDENCE` | The Swift engine is documented non-authoritative; `crossLanguageAuthority.test.ts` fails if real data could reach it; 22 language-neutral cases the backend passes |
| H44 | Reassemble evidence from CI logs by hand | `AUTOMATED` | Sanitized outputs are uploaded as artifacts; the instant-level result is regenerated byte-identically in CI |
| H45 | Hand-write the per-case analysis of 268 records | `AUTOMATED` | `redecide-ledger.ts` and `render-instants.ts`, drift-checked in CI |
| H52 | Self-attested mitigation booleans feeding the gate | `REPLACED_BY_STRONGER_EVIDENCE` | A mitigation counts only if its named tests passed in the same suite run, or a committed `VERIFIED_LIVE_HUMAN` record exists (`gate.ts`) |

### Infrastructure and operations

| Id | Procedure | Status | Replacement |
|---|---|---|---|
| H09 | Build and test the iOS app on a Mac | `NON-BLOCKING_UNVERIFIED` | The app runs the demo only and is unchanged here; the Swift package runs in CI (`transit-core`, macOS). An app build job is not added: runner Xcode and simulator availability could not be checked from here |
| H34 | Read `/health`, run the smoke test and review logs after deploys | `AUTOMATED` | Scheduled production smoke (after merge); the smoke contract is exercised in CI against a synthetic deployment (`smoke.test.ts`) and against the real local server. Vercel runtime-log review remains `NON-BLOCKING_UNVERIFIED` (connector access refused) |
| H35–H37 | Collector `/health`, Upstash eviction, live store verifiers | `NON-BLOCKING_UNVERIFIED` | Human-ride and durable-session infrastructure; not on the matcher release path |
| H41 | Re-run credentialed TAGO probes by hand | `AUTOMATED` | Every scheduled window records provider path, calls, failures and cadence in its manifest |
| H42 | Trigger passive collections by editing a request on a branch | `AUTOMATED` | Daily schedule after merge |
| H43 | Copy the v3 raw artifact before it expires | `AUTOMATED` | The merge commit's replay job copies it first (90-day artifact and private vault) and verifies it against the upload digest. Needs the merge before 2026-10-09T06:28:03Z |
| H47 | Corroborate routes on the Jeju BIS website | `NON-BLOCKING_UNVERIFIED` | Route classification is not read by the matcher; route ids come from TAGO |
| H48 | An operator could enable automatic matching with no gate check | `ELIMINATED` | The configuration refuses it below `READY_FOR_BOUNDED_AUTOMATION` and says so in `/health` and the boot log |
| H51 | Local checks when the Actions budget blocks CI | `NON-BLOCKING_UNVERIFIED` | Contingency only |

### Genuinely non-delegable (none of them a ride)

| Id | Action | Status | Why only a person can do it |
|---|---|---|---|
| — | Restore the account's GitHub Actions budget and merge the pull request, or allow the environment to reach the artifact store and the API | `STILL_REQUIRED` | Account, payment and environment authorisation |
| H30 | Optionally add a `TAGO_SERVICE_KEY` repository secret | `STILL_REQUIRED` (optional) | Credential. Needed only for direct-TAGO windows (BA-2) |
| H08, H31 | Physical-device Live Activity check; Apple Developer membership | `STILL_REQUIRED` for `READY_FOR_BOUNDED_AUTOMATION` only | A device check, not a ride; the membership is a paid enrolment |
| H25–H27, H33 | Credential rotation; platform environment variables; branch protection | `STILL_REQUIRED` when they change | Account and administrator actions |
| H29 | Beta invites | `ELIMINATED` | No beta rides needed |
| H28 | Operator token on the phone | `ELIMINATED` | No operator rides needed |
| H38, H39 | Durable production sessions decision; rollback | `STILL_REQUIRED` as operations | Product and incident decisions, not validation |
| H46, H32, H50 | TestFlight pipeline; waitlist/payment accounts; governance and privacy review | `STILL_REQUIRED` as release operations | Accounts, payments and legal review, unrelated to matcher safety |
| H49 | In shadow mode the rider confirms the bus | Product behaviour | The fail-closed path of the product below bounded automation, not validation labor |

## Blocker

The full-window replay, the real-base counterfactuals and every new live window
need a machine that can read GitHub artifacts and the provider. Since
2026-09-29 GitHub-hosted jobs of this repository fail before a runner is
assigned (every job, no steps, no logs; cause `INFERRED`: the account's Actions
budget), so merging alone runs nothing. Either path unblocks them with no human
ride: the owner restores the Actions budget or spending limit and merges this
pull request (the merge commit runs the replay and the schedule starts); or the
owner lets this environment reach `productionresultssa18.blob.core.windows.net`
and `tapso-api.vercel.app`, and a session copies the raw (the integration
already mints signed download URLs) and replays it offline with the same
scripts. The evidence-of-record raw artifact expires **2026-10-09T06:28:03Z**.

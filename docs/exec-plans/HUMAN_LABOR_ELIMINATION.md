# Human labor elimination — ExecPlan

Living document for replacing repeated human bus rides as TAPSO's validation
method. It follows `.agent/PLANS.md`. Reality labels used here and nowhere
blurred:

| Label | Meaning |
|---|---|
| `VERIFIED_LIVE_HUMAN` | A person physically did it, and it is recorded |
| `VERIFIED_LIVE_PASSIVE` | Real provider observations collected with no rider |
| `VERIFIED_LIVE_INFRASTRUCTURE` | A live deployment, store or service was observed |
| `VERIFIED_BY_REPLAY` | Real recorded evidence re-run offline through current code |
| `VERIFIED_BY_TEST` | Deterministic test of code behaviour (says nothing about the world) |
| `HISTORICAL_REPORT_ONLY` | A report exists; its raw snapshots do not |
| `SIMULATED` | Synthetic, perturbed or counterfactual data |
| `INFERRED` | Reasoned, not measured |
| `MISSING` | Nobody has it |

## 1. Outcome and non-goals

**Outcome.** TAPSO no longer needs anyone to ride a bus, stand at a stop, tap
markers, export captures, re-run analyses or inspect deployments by hand to
establish the safety properties its shipping behaviour depends on. Every
matcher-safety property is either established by machine-produced evidence
(passive live collection, immutable replay, counterfactual transformation of
real evidence, property-based and mutation testing) or removed from the
automatic path by a fail-closed product rule.

**Non-goals.**

- Enabling automatic matching. It stays off unless the gate below awards
  `READY_FOR_BOUNDED_AUTOMATION` or higher, which it does not.
- Changing, re-counting or reinterpreting `broad-real-mode-30-boardings-v1`
  or `beta-matcher-30-boardings-v2`. Both stay as historical definitions with
  the counts reality gave them: zero observed boardings.
- Presenting any simulated, counterfactual or report-only result as a live
  observation.

## 2. Verified constraints (this task, 2026-09-29)

| Constraint | Label | Consequence |
|---|---|---|
| This container's egress policy refuses `tapso-api.vercel.app`, `tapso-nu.vercel.app` and `productionresultssa18.blob.core.windows.net` (`CONNECT 403`); `api.github.com` is reachable | `VERIFIED_LIVE_INFRASTRUCTURE` | No live provider read and no artifact download from here |
| The GitHub integration token cannot dispatch workflows (`POST …/dispatches` → `403 Resource not accessible by integration`) | `VERIFIED_LIVE_INFRASTRUCTURE` | No on-demand Actions run from this session |
| Editing the passive workflow's push trigger so that this branch would start a collection was refused by the session's permission policy | `VERIFIED_LIVE_INFRASTRUCTURE` | Not attempted again by any route; see §8 |
| The Passive Shadow v3 raw artifact `10849693394` (run `36098610702`) exists, digest `sha256:3b644dbc…9de995`, **expires 2026-10-09T06:28:03Z** | `VERIFIED_LIVE_INFRASTRUCTURE` | Must be copied by a workflow run before then |
| The evidence-of-record ledger (268 records) carries every candidate at each wrong commit's decision: stop sequence, cadence state, role | `VERIFIED_BY_REPLAY` | Instant-level re-decision is possible without raw |
| Run `36098610702` resolved `provider: auto` to `tapso-public-api`, so no `TAGO_SERVICE_KEY` repository secret existed then | `INFERRED` (from `requestedProviderPath`) | Session-cadence (5 s, uncached) passive evidence needs a credential only the owner can add |
| No numeric TAGO daily quota is documented anywhere | `MISSING` | Scheduled windows are bounded to one a day at the load of the one window already run without incident |
| Since 2026-09-29 09:26 UTC every GitHub-hosted job of this repository fails before a runner is assigned (CI runs `36549160780`, `36576508391`, `36576849919`: no steps, no logs, `runner_id` 0), including on a commit that changes no code those jobs run; the repository recorded the same symptom as an account Actions budget block (`MARKETING_SITE.md`) | `VERIFIED_LIVE_INFRASTRUCTURE` (symptom); cause `INFERRED` | Neither CI nor `matcher-evidence.yml` runs until the account lets Actions start jobs again; a re-run from this session is refused (`403`) |
| The GitHub integration can mint a signed download URL for the v3 raw artifact `10849693394`; this container's egress refuses its host (`productionresultssa18.blob.core.windows.net`, `CONNECT 403`, retried once on 2026-09-29) | `VERIFIED_LIVE_INFRASTRUCTURE` | Allowing that host would let a session like this one copy the raw and replay it offline without Actions |

## 3. Findings

| Id | Finding | Label | Status |
|---|---|---|---|
| F1 | Symmetric stop-position term `20 − 5·|seq − S|` selects buses already past the rider's stop (268 live blind cases) | `VERIFIED_LIVE_PASSIVE` (v3) | **Fixed**: `directed-route-progress-v1` |
| F3 | `replayMatching` derived the request direction from the boarded vehicle | `VERIFIED_BY_TEST` | **Fixed**: `replayBlind` has no parameter for the answer; direction only from a declared request |
| F4 | Commit after passage: a bus reaches the stop before its cadence is fresh, so it is (correctly) never picked; when it leaves, the bus behind it becomes the leading approaching vehicle and is picked while the rider may already be aboard the first | `SIMULATED` (found by `migrate.ts` on a synthetic collection: 6 correct→wrong) | **Fixed**: session `PassageMemory` withholds for the rest of the session |
| F5 | A stop sequence absent from the route's stop list was folded modulo a loop's lap into a plausible position | `VERIFIED_BY_TEST` (property P2, seed 10156) | **Fixed**: off-route sequence = unknown progress, blocks |
| F6 | Railway/beta captures start with a `boarded` marker at the first instant; replaying them as a waiting rider mis-modelled them | `VERIFIED_BY_TEST` (read from source, pinned by tests) | **Fixed**: replay rider state comes from the start declaration (`declaredRiderStateAtStart`), never from vehicle identity |
| F7 | A vehicle reported at two positions withheld the decision even when both positions were irrelevant; dropping that vehicle released it | `VERIFIED_BY_TEST` (property P3, seed 14526, 20 000-seed run) | **Fixed**: the conflict withholds only when one of its positions is selectable, competing or blocking |
| F8 | A remembered vehicle competed only from its last sighting; failed polls hid a competitor's advance to the leader's stop and the leader was committed | `VERIFIED_BY_TEST` (property P7, seed 12091, 20 000-seed run) | **Fixed**: memory widens forward (one stop plus one per 15 s); a vehicle that leaves memory while it could have reached the stop withholds the session; an on-board rider's bus must be present when they declare it. P7 restated to what can be true: a failed poll counts exactly as a poll never made |
| F9 | The three-stop margin, kept on the legacy 5-points-per-stop scale, only counted followers inside the four-stop approach window: a leader four stops out was "clear" of a bus one stop behind it, and a bunching bus overtook | `SIMULATED` (counterfactual family `follower_overtaking`; 165 wrong commits on a synthetic 5-route hour) | **Fixed**: the margin is counted in stops (`marginStops: 3`) against every vehicle heading for the stop, current or remembered, fresh or not, wherever it is |
| F10 | A remembered sighting past the stop was not judged against passage memory, so the row showing a crossing dropping out of one poll released the bus behind | `VERIFIED_BY_TEST` (property P3, seed 16661, 20 000-seed run) | **Fixed**: remembered sightings are judged like current rows (waiting: crossing; on board: leaving the window) |
| F11 | A session row polled by the previous build carries no passage memory and would have been read as an empty one after the deploy | `INFERRED` from code (audit), pinned by test | **Fixed**: such a row is withheld for good (`passage_memory_unavailable`) |
| F12 | A session's first decision could come well after the rider declared waiting (a slow or failed first read); a bus that crossed the stop in between was invisible | `INFERRED` from code, pinned by test | **Fixed**: at the first decision, any bus now past the stop that could have been at it since the declaration withholds; a first look later than the memory window withholds |
| F13 | The cadence history accepted a receipt no newer than the latest it held: a late older receipt or a second row for one vehicle in one snapshot could manufacture a sample or a content change | `INFERRED` from code (audit), pinned by test | **Fixed**: receipts only move forward |
| F14 | The blind-input guard checked only the envelope and snapshots; a per-vehicle or per-stop truth field would have reached the matcher | `INFERRED` from code (audit), pinned by test | **Fixed**: every vehicle row and route stop is checked against the observation fields the domain defines |
| F15 | A bus out of the feed for longer than the 90 s memory window was dropped from every decision, although its possible positions only widen: a lost leader stopped counting against the bus behind it (withheld at 89 s, selected at 91 s), a lost bus in an on-board window stopped competing, and a bus of unknown progress left no memory at all | `INFERRED` from code (adversarial review of the matcher), reproduced by synthetic probes; property P3-forgotten seed 10446; counterfactual `lost_leader_follower_k3_360s` (`SIMULATED`: 4 of 4 applicable base-A cases selected the follower) | **Fixed**: a vehicle in session memory keeps blocking and competing from every position its last sighting and the uncapped time since allow; the unobserved-arrival rule uses the time actually unseen; a bus of unknown progress that leaves the feed withholds for good |
| F16 | The "could it have been at the stop" question was asked only at a session's first decision, so an earlier look (even an empty one) switched it off; on board, a bus missing from the first snapshot also stopped competing, though the feed may have missed the rider's bus | `INFERRED` from code (review), reproduced by probes; property P3-empty-look seed 10099 | **Fixed**: every first known sighting past the stop is judged against the time since the rider began waiting; on board, a bus missing from the first snapshot is never selected but still competes |
| F17 | Loop routes: passage memory compared plain sequence offsets, so a crossing next to the seam read as a bus far away, and a bus lost past the stop could never come round. The first fix stored directed offsets (the shorter way round), which on a short loop (eight stops) read a bus four stops past the stop as four before it, excluded it from the on-board window and selected the other bus, and missed a crossing longer than half the lap | `INFERRED` from code (review), reproduced by probes; properties P3-crossing (seeds 10099, 10012) and P12-loops (seed 10037) | **Fixed**: memory keeps plain offsets; round a loop each sighting is compared with the last by its distance to the stop each way (a distance to the stop that grew is a crossing; a bus that may be in the on-board window is never excluded; leaving the window is read from the distance past the stop) |
| F18 | A loop's lap was the number of stop rows, so a missing or repeated row (a paged stop list) moved the seam and released a bus one stop past the rider | `INFERRED` from code (review), reproduced by probes | **Fixed**: the lap is measured in sequences; two different stops under one sequence withhold |
| F19 | The invariant check read the first row with the selected id, which could be another route's: HTTP 500 on `POST /v1/matches`, depending on candidate order | `INFERRED` from code (review), reproduced by probes; property P13-routes seed 10018 | **Fixed**: a row under another route is a second position (withheld); the invariant checks every row of the request's route |
| F20 | An automatic selection is a prediction: its margin is counted in stops, and a faster bus behind can reach the stop first. Once a session had selected, it never looked again, and kept tracking the selected bus while the rider rode the other one | `SIMULATED` (ground-truth fuzzing: buses moving continuously at 20–90 s per stop, the rider boarding the first to arrive. At the matcher, every wrong first commit to a bus the feed had shown, 15 of 1 827, was an overtaking after the commit: the selected bus really was the nearest then. Through the session coordinator, 3 000 sessions of `scripts/matcher-evidence/ground-truth-sessions.ts`: the feed showed 67 wrong selections being overtaken before the selected bus reached the stop, and none was withdrawn) | **Fixed**: until the selected bus is seen at the stop, the session watches every other bus with the matcher's own session-memory rules; one seen at the stop, crossing it, or first seen past it withdraws the selection for good and the rider is asked which bus they are on. What memory merely allows never withdraws. All 67 are now withdrawn by the poll that shows it, at the cost of 38 of 917 right selections also withdrawn (`SIMULATED`); property P16 |

Found by the adversarial review of the branch (2026-09-29, second pass), each
fixed with a test and, where it guards the gate, a negative control:

| Id | Finding | Status |
|---|---|---|
| R1 | The scheduled collect step prefixed `$(pwd)/` to the absolute path `collect.ts` prints, so every window would fail after collecting and never be evaluated or vaulted | **Fixed** |
| R2 | An artifact upload drops an empty `streams/`, so a no-vehicle window would have made every later `gate-evidence` run refuse | **Fixed**: a missing `streams/` reads as empty; the window is named and left out |
| R3 | The trajectory count included runs without cases and runs split by a feed gap (v3: 31, not 29) | **Fixed**: one bus on one route direction in one window, with a case |
| R4 | A window with no case still counted as a window, a time band and a provider path; one empty direct-TAGO window satisfied BA-2 | **Fixed** |
| R5 | Contested minimums counted correlated cases | **Fixed**: contested trajectories |
| R6 | Bounded automation's sample could come from the cached public path | **Fixed**: BA-1 counts session-cadence windows only |
| R7 | Evidence that expired or could not be fetched simply vanished, wrong commits included | **Fixed**: failures carried forward; omitted artifacts fail CA-1 |
| R8 | Committed live evidence was not bound to the matcher that produced it | **Fixed**: source digest; stale evidence is `MISSING` |
| R9 | Determinism compared aggregate counts in one process | **Fixed**: case-level digests, two processes, byte comparison |
| R10 | SH-4 did not pin the controls; a deleted control kept it green | **Fixed**: 56 pinned ids |
| R11 | Any passing test could stand for BA-3/BA-4, and any two-field JSON for BA-5 | **Fixed**: criterion-named tests; a human-record schema |
| R12 | Skipped or todo property tests counted as covered | **Fixed** |
| R13 | `POST /v1/matches` offered `selectedVehicleId` in shadow, and passed caller-supplied session memory to the matcher (a malformed one gave a 500) | **Fixed**: `shadowSelection`; stateless request only |
| R14 | Nothing checked that the session coordinator got the granted, not the requested, flag | **Fixed**: `/health` reports `sessionMatchingMode`; test, smoke check, control |
| R15 | Missing shadow criteria were labelled as verified evidence classes | **Fixed** |
| R16 | The vault would upload raw vehicle numbers to a release someone had published | **Fixed**: refuses unless it is a draft |

Found by the adversarial review of the F15–F19 fix and by a session-level
differential against the matcher before it (f3d693a: 3 000 synthetic sessions,
355 668 decisions, 40 % loops, 30 % on board, feed holes up to 400 s, looking
for any decision in which the new matcher selects and the old one did not),
each fixed with a test that fails on the commit before the fix and a negative
control:

| Id | Finding | Status |
|---|---|---|
| R17 | The first F17 fix stored directed offsets (the shorter way round a loop); on a short loop a bus four stops past the stop read as four before it, was excluded from the on-board window and the other bus was selected; a crossing longer than half the lap was missed | **Fixed** (`274567d`): plain offsets, compared round the loop by distance to the stop; properties P12-loops, widened P3-crossing |
| R18 | That rework read the on-board exclusion ("reached the stop after the rider boarded") from the last sighting only: one decision later the bus was forgotten and, alone in the window, selected (found by the differential) | **Fixed** (`660069a`): every such sighting is recorded (`reachedAfterBoarding`); property P12-reached-after |
| R19 | An excluded bus competed for the on-board window again once out of sight (over-conservative) | **Fixed** (`99605a0`): it does not compete, and still blocks by where it may be |
| R20 | A bus listed twice in one snapshot was remembered at whichever row came last, so a later release depended on row order | **Fixed** (`8ed1f7b`): remembered as of unknown progress; property P13-memory-order |
| R21 | A bus of unknown progress was treated as placed while the evidence window held a known row of that same sighting | **Fixed** (`8ed1f7b`): such a row is judged unplaced |
| R22 | A sighting or a declaration dated after now read as "just now" (a backward clock step) | **Fixed** (`8ed1f7b`): more than 10 s after now, or unreadable, is an unbounded time since |

With these, that differential finds no decision in which the new matcher
selects and the old one did not, and no first commit that differs. (Its
generator is the scope of that claim: wider differentials run by the fourth
pass below do find such decisions, and each is traced there.)

Found by the adversarial review of the R17–R22 fixes (fourth pass: four
lenses, each finding reproduced by a probe and checked by a skeptic that tried
to refute it on the current tree), and by re-running the reviewers' own
fuzzers on each fix, each fixed with a test that fails on the commit before the
fix and a negative control:

| Id | Finding | Status |
|---|---|---|
| R23 | On board round a loop, a bus seen clear of the stop and later back at it, or closer past it, went through the stop after the rider boarded; on a short loop (six to eight stops) it was selected as the rider's bus, and on a twenty-stop loop after a long gap too | **Fixed** (`2f4b11e`): such a bus, and one seen again after time enough to go round, is never selected and still competes (`returnedToStop`); on board, a loop shorter than two windows and the stop either side (a lap under ten) withholds; property P12-returned |
| R24 | Waiting round a loop, a bus seen at two decisions far enough apart may have reached the stop, taken the rider and gone round to where it now reads as approaching; that, and the terminal relabelled from the first to the closing sequence after a lap's time, released the bus behind | **Fixed** (`2f4b11e`): it withholds for good, with the reason kept after every reason a sighting raises; property P3-lap |
| R25 | A loop whose sequences span ~125 000 walked a bus out of sight round the whole lap into a spread argument list: `RangeError`, on every later refresh | **Fixed** (`2f4b11e`): the walk is folded step by step |
| R26 | `candidate_disappearance_180s` and the lost-leader counterfactuals could never qualify a ground truth, so their `NOT_WRONG` was never decided; the first checked nothing but the invariant | **Fixed** (`fc18085`): replaced by `reappearance_100s`; lost leader judged by the follower never being selected; a 110 s polling gap that resumes before the arrival; every counterfactual but the documented indeterminate one must be exercised |
| R27 | On board, a bus the snapshot placed twice was excluded by its place before the stop and stopped competing (found re-running the loop fuzzer on R23) | **Fixed** (`2f4b11e`): an exclusion takes a sighting at one place; on board such a sighting leaves memory as it was |
| R28 | Under production timing (`now` read before the fetch), the unknown-progress mark predated its own rows, so a kept row of that unplaced sighting placed the bus: selected at 60 s, withheld for good at 95 s on the same fact, by row order | **Fixed** (`2a04f11`): the mark is dated by the latest receipt of its rows |
| R29 | A bus's last sighting in session memory dated 0–10 s after `now` (a backward clock step) read as "seen just now" | **Fixed** (`2a04f11`): the session's own sighting times get no tolerance |

After these, a single-decision differential (20 000 generated decisions) and a
session differential (3 000 sessions, 355 668 decisions) against f3d693a find
no decision in which only the new matcher selects and no different pick. The
reviewers' wider fuzzers do find decisions where only the new matcher selects;
each was traced: intended changes (a repeated stop row deduplicated, a lap
measured in sequences, the unobserved rule using the time actually unseen, a
bus that came round the loop excluded), overtaking beyond the margin (F20), or
an on-board rider whose own bus is missing from the feed, which no matcher can
defend against (the premise of F16), where the old matcher withheld only by
misreading a bus past the stop through the seam as far before it.

Found by the fifth adversarial review (F20's watch, the R23–R29 loop and
clock fixes, and the evidence tooling: three lenses, each finding reproduced by
a probe, every high one confirmed by a skeptic on the current tree), each fixed
with a test that fails on the commit before the fix and a negative control,
unless stated otherwise:

| Id | Finding | Status |
|---|---|---|
| R30 | R27 left memory as it was for an on-board sighting at two places, and two cautious rules read that memory: the rider's bus listed at S+1 and S+2 then once past the window no longer withheld (the bus behind was selected), and a bus in the window also listed under another route was forgotten once out of sight. Older, found by the same lens: a bus seen only at no place and then beyond the window | **Fixed** (`5f9b9ea`): on board, such a bus is always of unknown progress, so out of sight it withholds; memory keeps no place of it (no exclusion, as R27 requires); a bus never placed at one place and then beyond the window withholds, as the rider's bus leaving it may |
| R31 | F20's watch ended on the matcher's crossing reason for the selected bus, which is caution, not evidence: round a loop a reading one stop back, a row listed twice at the stop, and, by the order of two rows in one TAGO response, a remembered row all ended it, and a faster bus then reaching the stop first withdrew nothing | **Fixed** (`19a395e`): only a sighting ends the watch (one place on this route, at the stop or one past it; or past it after one before it, within the motion model and, round a loop, beyond what a reading two stops back would show); P16's notion of "shown" says the same |
| R32 | The catalogue self-check added in `54a780e` fails on every mutant (the mutant replaces the text it looks for), so `run.ts` counted it as a kill: a control whose protection had lost its tests was reported KILLED, and SURVIVED could not be reported | **Fixed** (`7bc5528`): self-checks never count as killers, and the runner refuses a baseline without them by name; shown on a scratch copy where a comment-only control and a control with its only test deleted are SURVIVED again |
| R33 | Of two concurrent refreshes, a withdrawal computed by the one that lost the compare-and-set was dropped, also when the winner had ended the watch on a later snapshot | **Fixed** (`19a395e`): written onto the winner's row, unless the winner saw the selected bus at the stop first or the rider confirmed |
| R34 | After a withdrawal round a loop, the bus that just left the stop was not offered when it reported the first stop's sequence across the seam | **Fixed** (`19a395e`) |
| R35 | Control F20-reselect named a protection its edit does not remove (the matcher re-derives a sighting's reason from the same snapshot, so nothing is reselected either way) | **Fixed** (`7bc5528`): it names what the standing reason gives (the rider keeps being asked) and must be killed by those tests |
| R36 | The committed synthetic counterfactual summary predated R26's catalogue change, so CI's byte comparison would fail before the ground-truth and gate steps | **Fixed**: regenerated with the rest of the evidence |

## 4. The matcher contract (`directed-route-progress-v1`)

Before evidence establishes that the rider is aboard, no automatically selected
vehicle may be at or past the boarding stop in route order. `assertDirectedInvariant`
checks it on every result and throws rather than return a violating selection.

TAGO's `nodeord` convention (last stop passed or next stop; switching on
arrival or on departure) is unverified, so a bus dwelling at stop S may report
S − 1, S or S + 1:

| Offset from S | Waiting rider | On-board rider |
|---|---|---|
| ≤ −5 | ignored (beyond window) | ignored |
| −4 … −2 | **selectable** if fresh and leading | not theirs (reached S after they boarded) |
| −1 | **selectable** if fresh and leading | blocks (may be dwelling at S) |
| 0 | blocks | blocks |
| +1 | blocks (may be dwelling at S) | **selectable** if fresh and unique |
| +2 … +4 | departed, ignored | **selectable** if fresh and unique |
| ≥ +5 | departed, ignored | ignored |

Every other rule fails closed: unknown or off-route stop sequence blocks;
non-fresh and remembered (recently dropped) vehicles still compete; the leader
needs three stops of separation; missing topology or a repeated boarding stop
withholds; one vehicle at two positions withholds; and session memory withholds
for good once a bus has reached the stop during a waiting session (F4). There
is no best-available guess and no score overrides a rule.

Rider state is the rider's declaration (`riderState`, default
`waiting_at_stop`). Its failure mode is chosen: a rider on board who did not
say so gets a confirmation prompt; the reverse would admit departed buses.

## 5. Milestones

| # | Milestone | Completion criterion | Status |
|---|---|---|---|
| 0 | Audit and evidence inventory | Every evidence source classified; human-labor ledger | **done** (§10, §11; ledger statuses in the evidence package §15) |
| 1 | F1, F3 fixed with invariant and negative controls | suite green; every mutation killed | **done** (F1–F14; negative-control catalogue in `scripts/negative-controls/mutations.ts`, all killed) |
| 2 | Immutable replay of the evidence of record, old vs new | `migrate.ts` reproduces the record, 0 new wrong, all 268 accounted | instant level **done** (§6); full window **blocked** (§8), tooling verified on synthetic collections (deterministic across runs) |
| 3 | Counterfactual suite over real trajectories | ≥ 30 families, metamorphic expectations | 32 families **done on synthetic bases** (`SIMULATED`, 0 wrong); real bases **blocked** (§8) |
| 4 | Property suite | 15 invariants, ≥ 2 000 seeds each, failing seeds persisted | **done** (9 regression seeds; three found only by 20 000-seed runs) |
| 5 | Automated passive collection | scheduled, bounded, manifests, hashes | workflow written and linted; **runs after merge**; its `gate-evidence` job turns every retained raw collection into the gate's live inputs (`live-evidence.ts`, verified on a scratch stand-in collection, never committed) |
| 6–9 | Substitution matrix, contract, gate v4, readiness | machine-checkable gate result | **done**: `READY_FOR_SHADOW`, tied to code by CI |
| 10 | Infrastructure checks automated | scripted, fault-injected where possible | **done** where this session reaches: smoke contract tested end to end in CI, local posture smoke, scheduled production smoke after merge; restart/outage fault injection covered by deterministic tests. Railway and Vercel control planes: `MISSING` (no access) |
| 11 | Historical evidence audit | report-only rides kept report-only | **done** (E01, E02 stay `HISTORICAL_REPORT_ONLY`) |
| 12 | Swift/backend consistency | drift fixture or documented non-authority | **done**: Swift engine documented demo-only; authority guard test; 22 language-neutral cases the backend passes |
| 13–16 | Evidence package, docs, CI, deployment posture | PR with complete argument | evidence package and CI **done**; docs sweep adversarially verified; PR open; merge is the owner's |

## 6. Evidence produced so far

- **Former wrong-commit instants** (`artifacts/matcher-directed-v1/former-wrong-commit-instants.json`,
  `VERIFIED_BY_REPLAY`, instant level): the legacy policy, replayed on the
  reconstruction, reproduces all 268 recorded selections. The current policy
  makes **0** selections at those 268 instants: the former pick is `departed`
  (251) or `boarding_stop_unresolved` (17); the true bus is beyond the window
  (200) or absent from the feed (68). Topology is assumed permissively and
  memory is empty; both can only add abstentions. What each case does later in
  its window needs the raw streams.
- **Counterfactual suite over synthetic bases**
  (`artifacts/matcher-directed-v1/counterfactual-synthetic-summary.json`,
  `SIMULATED`): 32 families, 32 455 evaluations, 0 wrong, 0 invariant
  violations, 0 expectation failures; the legacy matcher on the same bases
  fails 31 of 32 families.
- **Test suite, property suite and negative controls**
  (`artifacts/matcher-directed-v1/test-suite.json`, `negative-controls.json`,
  `VERIFIED_BY_TEST`) and the **gate result**
  (`artifacts/matcher-passive-safety-v4/gate-result.json`). Numbers in the
  evidence package §4, §12 and §14.

## 6a. Progress, risks and exact next action (2026-09-29)

- Done in this branch: everything in §5 marked done. Every finding in §3 has
  a regression test and a negative control that turns the suite red if the fix
  is removed.
- Risks: coverage cost of the fail-closed rules on real routes is unmeasured
  until the full-window replay runs (routes whose stop lists repeat stop names
  withhold at those stops; a bus at the stop withholds the session); the first
  scheduled windows read production through the 20 s-cached public path unless
  a `TAGO_SERVICE_KEY` secret is added; no TAGO quota is documented. The
  `gate-evidence` job reads the evidence of record from the replay run's
  90-day artifact: the private vault is a draft release, which its read-only
  token may not see, so within 90 days of the replay run the job needs either
  read access to the vault or a replay request that re-uploads the record.
  Its runtime grows with every retained window (each evaluated twice).
- Exact next action: one of the two unblocking paths in §8 before
  2026-10-09T06:28:03Z; merging alone runs nothing while Actions cannot start
  jobs. The replay run's
  `gate-evidence` job computes `live-replay-evidence.json`,
  `counterfactual-live-evidence.json` and a gate result with no one's help. An
  agent with artifact access then commits those two files (counts only),
  re-runs `gate.ts`, and raises `DEMONSTRATED_MATCHING_READINESS` only if the
  gate awards more; CI rejects the commit otherwise.

## 7. Decisions and alternatives

- **Convention-agnostic blocking zone over a measured `nodeord` convention.**
  The convention could be estimated from GPS against stop coordinates in the
  raw streams, but the rule is safe under all four readings, so a measurement
  can only ever relax coverage, never safety. Rejected: tuning thresholds
  around F1.
- **Session memory (F4) over a commit-on-crossing rule.** Committing to the bus
  that crosses the stop would select a departed vehicle with no independent
  evidence that the rider boarded it. Rejected.
- **Rider state from the declaration, not from any vehicle.** The alternative
  (inferring on-board from which bus moved) reads the answer.
- **The workflow computes gate evidence but never raises readiness.** A job
  with write access could commit its own result; instead the readiness claim
  moves only in a reviewed commit, which CI ties to the committed gate result.
  Rejected: automatic promotion from a scheduled job.
- **Gate by evidence dimensions, not ride counts.** Minimums rest on the rule
  of three at the trajectory level (`MINIMUMS` in `matcherSafetyGate.ts`) and
  were not fitted to existing evidence: v3's 29 trajectories meet neither the
  confirmation-assisted (60) nor the automation (300) minimum.

## 8. Blocker and exact next action

The full-window replay (milestone 2), the counterfactual suite on real bases
(3) and every new live window (5) need a machine that can read GitHub
artifacts and the provider. This session has none: its egress blocks both, the
integration cannot dispatch workflows, and changing a trigger so that a push
from this branch starts one was refused. Nothing here attempts another route.

`.github/workflows/matcher-evidence.yml` does all three with no rider and no
manual step once it is on `main` and GitHub Actions can start jobs: the merge
commit runs the evidence-of-record replay (and copies the raw artifact before
it expires on 2026-10-09T06:28:03Z), and the schedule runs one bounded window
a day; after either, the `gate-evidence` job recomputes the gate's live inputs
from every retained raw collection.

Since 2026-09-29 GitHub-hosted jobs of this repository fail before a runner is
assigned (§2; cause `INFERRED`: the account's Actions budget). So there are two
ways through, and either works before the expiry:

1. The owner restores the account's Actions budget or spending limit (an
   account and payment action), then merges the pull request.
2. The owner allows this environment to reach
   `productionresultssa18.blob.core.windows.net` (the artifact store; the
   integration already mints signed download URLs) and `tapso-api.vercel.app`.
   A session like this one then copies the raw, replays it offline with the
   same scripts, and commits the counts, with no Actions run at all.

Granting the Claude GitHub App `actions: write` helps only once Actions can
start jobs.

## 9. Reproduce

```bash
npm --prefix services/api test
node --experimental-strip-types scripts/matcher-evidence/redecide-ledger.ts
# With a raw collection directory (ignored work/ storage):
node --experimental-strip-types scripts/passive-shadow/migrate.ts <collection-dir> \
  --expect-raw-tree=bce8b504e5b287d9f86eb79345f7e50bdce4537625247c0dee164c2afb8c82fb \
  --expect-summary=artifacts/passive-shadow-validation-v3-summary.json \
  --expect-ledger=artifacts/passive-shadow-validation-v3-wrong-commits.json
node --experimental-strip-types scripts/matcher-evidence/live-evidence.ts <collection-dir>... \
  --record=pv3-20260925T052712Z-f096de91,artifacts/passive-shadow-validation-v3-summary.json,artifacts/passive-shadow-validation-v3-wrong-commits.json
TAPSO_PROPERTY_CASES=20000 node --experimental-strip-types --test services/api/test/matcherProperties.test.ts
```
## 10. Evidence inventory (Phase 0 audit, 2026-09-29)

Every evidence source the repository holds or cites, classified once and not blurred afterwards. Classes are as of the audit; items produced by this work are in §6 and in `docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md`. Line references are to the audited revision `d81998d`.

| Id | Source | Class | Supports | Cannot support |
|---|---|---|---|---|
| E01 | 13 historical ride reports (*.report.json) with capture source `web-controller` (written by the controller page, the quick page and the Railway collector alike, so which produced each is not recorded; four show browser-hidden gaps), across 10 routeIds, kept in the operator's own library. | `HISTORICAL_REPORT_ONLY` | That real people rode Jeju buses with the phone recorder, and that the v2 sample-size minimums are attainable in the field: 12 of 13 meet 20 snapshots / 3 tracked sequences / 5 content changes; | Matcher correctness, any gate count (they are REPORT_ONLY_NO_RAW and count 0 of 30), provider lag, or freshness thresholds. |
| E02 | Two earlier physical rides captured with the local/browser recorder, both confounded by Safari background suspension. | `HISTORICAL_REPORT_ONLY` | Qualitative sanity only, and the finding that browser-owned polling gaps cannot be attributed to TAGO. | Freshness thresholds, provider lag, polling-gap statistics, matcher correctness, or any gate. |
| E03 | Railway background collector acceptance run, 2026-09-22: captureEngine railway-background, 20 snapshots, 103.06 s of browser background time, worst polling gap 7.94 s at a 5 s interval, verdict PASS. | `VERIFIED_LIVE_INFRASTRUCTURE` | That, in one run, the server-side collector kept polling TAGO while the phone page was backgrounded. | Anything about TAGO data itself: provider timestamp or lag, boarding accuracy, candidate margin, marker lag, arrival accuracy, the 30-boarding gate, or reliability (it is one run, not a distribution). |
| E04 | Passive Shadow v3 live collection, GitHub Actions run 36098610702 (commit 0ec57f9), 2026-09-25 05:28:01 to 06:27:52 UTC (14:28-15:27 KST). | `VERIFIED_LIVE_PASSIVE` | Rider-free, hash-anchored real provider trajectories for one hour on five route IDs, replayable offline under any matcher version while the artifact exists. | Observed boardings; |
| E05 | Passive v3 blind offline evaluation of record: run 36108364969 at commit db51667, over the E04 raw. | `VERIFIED_BY_REPLAY` | How the committed symmetric TypeScript matcher (services/api/src/matching.ts:99-117) behaves on real trajectories. | Correctness for real riders (labels come from the first-arrival model, E06); |
| E06 | The passive first-arrival ground-truth model: a rider waiting at stop S from T0 boards the first bus observed to cross S. | `INFERRED` | Pseudo-labels for scoring a matcher's choice for a waiting rider who takes the first arriving bus. | Which bus a person actually boards: it cannot see a rider who lets a bus go. |
| E07 | Passive v3 adversarial section: 17 perturbation variants over 300 basis cases. | `SIMULATED` | Robustness trends under synthetic stress, for example dropout_every_3rd abstains on all 300 cases and synthetic_competitor_one_stop_behind produces 15 wrong commits. | Any live property; |
| E08 | Bounded TAGO cadence probe: 2 minutes, 24 samples per direction at a 5 s target, 48 calls, on the two full-length Route 365 directions. | `HISTORICAL_REPORT_ONLY` | The order of magnitude of TAGO content-change cadence on two directions. | Provider observation lag; |
| E09 | Credentialed TAGO probes of 2026-09-10 and 2026-09-11, plus desk inspection of the official data-portal resources 15098529 (route) and 15098533 (location). | `HISTORICAL_REPORT_ONLY` | Provider identity and schema: cityCode 39; | nodeord semantics (last-passed or next stop; |
| E10 | Authenticated B551982 (resource 15157601) calls on 2026-09-10: the key was accepted, but /mst_info returned zero rows for stdgCd 50110, 5011000000, 50 and 5000000000; | `HISTORICAL_REPORT_ONLY` | Why the project moved from B551982 to TAGO. | Anything about TAGO or current behaviour. |
| E11 | Production verification of https://tapso-api.vercel.app, build b59e9e60b863, on 2026-09-12: manual HTTP checks and a review of Vercel runtime logs. | `VERIFIED_LIVE_INFRASTRUCTURE` | At that build and date: /health 200 with credential.source canonical; | Current production. |
| E12 | Live Upstash journey-session verifiers, 2026-09-23: store 15/15 (commit c89452131c, namespace tapso:verify:journey-session:verify-<uuid>) and preview deployment 12/12 (preview of commit 8d3dbd4dad73). | `VERIFIED_LIVE_INFRASTRUCTURE` | Real Upstash SET NX PX, PTTL, Lua compare-and-set, stale-writer rejection and 8-way concurrent CAS; | Production, which still runs the memory store with sessions disabled on Vercel; |
| E13 | Live capture-journal verifier on the production collector's Upstash database, 2026-09-25: 16/16 invariants plus cleanup, run as a temporary Railway start-command hook (deployment 78ab4598-febe-4670-8cb2-897f3850b1c9, nam… | `VERIFIED_LIVE_INFRASTRUCTURE` | The FENCED_WRITE Lua and lease path of UpstashCaptureJournal on real Redis. | The real-iPhone path of active beta ride, Railway restart and recovered ride; |
| E14 | Read-only checks of the build host's Apple account, keychain and disk on 2026-08-21. | `VERIFIED_LIVE_INFRASTRUCTURE` | As of that date: the only team was the free Personal Team 89CGFQ24U5, with an Apple Development certificate only and no distribution certificate or profiles, and the host had about 394 MB free. | Current account or disk state; |
| E15 | data.go.kr portal UI observation on 2026-09-10: both TAGO development applications approved, expiring 2028-09-10. | `VERIFIED_LIVE_INFRASTRUCTURE` | That credentials exist and when they expire. | That the earlier key was revoked (the portal session was logged out, so it was never re-checked), or any quota figure. |
| E16 | Deployment-state statements with no captured observation: BETA_TESTERS_ENABLED=true on the Railway collector since 2026-09-25, and production still running the memory session store with no Upstash variables. | `HISTORICAL_REPORT_ONLY` | The operator's stated configuration. | Current state. |
| E17 | The claim that Upstash eviction is off for the evidence database ('already confirmed for the field-validation data'). | `HISTORICAL_REPORT_ONLY` | Only that one document asserts the check was done. | That no-TTL evidence is safe from eviction. |
| E18 | Report that TAGO intermittently answers without a body object and /operator/snapshot returned 502 in production. | `HISTORICAL_REPORT_ONLY` | That the failure mode exists. | Its frequency, date or fix status. |
| E19 | CI job main-history-policy: on every push to main it queries the GitHub API for a merged pull request. | `VERIFIED_LIVE_INFRASTRUCTURE` | After-the-fact detection of a direct push to main. | Prevention; |
| E20 | services/api node:test suite: 387 test()/it() cases at HEAD (README says 68), run by the CI api job. | `VERIFIED_BY_TEST` | Deterministic code behaviour on synthetic data. | Any real-world property; |
| E21 | Swift transit-core XCTest suite: 38 tests (VehicleMatchingEngineTests 17, JourneyStateMachineTests 9, DestinationProgressEngineTests 12) on synthetic DemoFixtures, run by the CI transit-core job on macos-15. | `VERIFIED_BY_TEST` | Deterministic behaviour of the Swift matcher, state machine and progress engine. | Real transit behaviour; |
| E22 | apps/ios TapsoActivityAttributesTests: 8 XCTest methods covering the 4 KB payload guard, fail-closed stale and unknown phases, and milestone alerts only for exact fresh (phase, count) pairs. | `HISTORICAL_REPORT_ONLY` | That these tests passed on the build host on 2026-08-21 at a7b2734. | Current code. |
| E23 | Manual simulator build, launch and visual inspection of the Lock Screen and Dynamic Island (compact 8/2/1/0, expanded, request/update/end) on the iOS 26.3 iPhone 17 Pro Simulator; | `HISTORICAL_REPORT_ONLY` | That the app and widget extension built and rendered in the simulator on that date. | Physical-device behaviour, alert sound or banner, or current code. |
| E24 | Emulated checks of the web ride-capture pages: a headless Chromium sweep of the controller at four iPhone viewports in light and dark, a 390 px beta-page walkthrough with a mocked network, and node --check syntax checks … | `SIMULATED` | Layout and flow in an emulated browser. | iOS Safari wake lock, IndexedDB eviction, the download sheet, lifecycle suspension, or the real-iPhone restart path. |
| E25 | Rehearsals against fabricated upstreams: the CLI operator dry run (2026-09-12), operator endpoints exercised over local HTTP, the three-configuration HTTP run (13/13), and the Upstash verifier scripts run against a fake … | `SIMULATED` | That the wiring works end to end. | TAGO or Upstash behaviour. |
| E26 | Synthetic fixtures and the iOS demo ride: DemoFixtures.swift (demo route 365, synthetic linear coordinates, fixed 2027-01-15 reference date, one obvious candidate scoring 147 → high), fixtures/transit/scenarios.json and … | `SIMULATED` | The deterministic 8→0 demo and test inputs. | Any real-world property. |
| E27 | An auditor's ad hoc probes of the pre-change code (session scratch files, not committed) | `VERIFIED_BY_TEST` | Code behaviour: a Railway replay that never commits is CLEAN_GATE_CANDIDATE in v1 (MATCHER_FIELD_NOT_COUNTED in v2); | How often any of this happens in the field (inputs are synthetic). |
| E28 | Policy thresholds: TAGO_CADENCE_POLICY_V1 (90 s window, 3 samples, 10 s span, 30 s receipt age, 30 s receipt gap), AMBIGUITY_MARGIN 12, MAX_AGE_SECONDS 90, 20 s vehicle TTL, 75 s missing-vehicle grace, 120 m near-stop ra… | `INFERRED` | Operational choices reasoned from E08 and E03, all labelled PROVISIONAL or ASSUMED. | Calibration against real boardings, or any claim that stale-data behaviour is correctly bounded. |
| E29 | A hand trace of the Swift VehicleMatchingEngine against the 22 cases in fixtures/transit/directed-matcher-invariants.json. | `INFERRED` | A prediction that the Swift engine would select where the directed backend policy withholds, or pick a different bus, on at least 9 of 22 cases (W3, W4, W5, W10, W13, W14, O3, O4, O7). | Measured Swift behaviour. |
| E30 | Uncommitted directed-matcher work on this branch at audit time | `INFERRED (at audit time)` | The intended fixes and the proposed gate | Anything as evidence of record until committed and run by CI; re-deciding commit instants cannot show what happens later in each window |
| E31 | apps/web test suites: waitlist backend (90 tests per README) and the Toss payment adapter, state machine and webhook reconciliation, run by the CI web job. | `VERIFIED_BY_TEST` | Waitlist validation, duplicate protection, rate limiting, confirmation email, and payment-adapter logic. | Live Supabase, Resend or Toss behaviour (no credentials, no merchant account). |
| E32 | Marketing site deployment dpl_59QDWXwmBRAYNBwkJpa3EMdchram and manual desktop and mobile browser QA. | `VERIFIED_LIVE_INFRASTRUCTURE` | That the deployment reached READY and served HTTP 200 at the time. | Anything about transit. |
| E33 | Recorded, raw-backed human boardings for any gate. | `MISSING` | Nothing. | Any claim of matcher correctness for real riders. |
| E34 | Calibration distributions from physical observation. | `MISSING` | Nothing. | Provider lag against physical stops (the marker-lag distribution), arrival and alighting accuracy, candidate-margin calibration, the dropout or disappearance distribution, or whether a bus dwelling at the boarding stop s… |
| E35 | Physical-device and real-iPhone evidence. | `MISSING` | Nothing. | Signed-device Live Activity behaviour (2/1/0 alert sound and banner, Island truncation, VoiceOver, power and network states), remote APNs updates, the Safari controller on a real iPhone, the real-iPhone beta restart E2E,… |
| E36 | Evidence that the Swift engine conforms to the backend policy or behaves correctly on real data. | `MISSING` | Nothing. | Any claim about on-device matching; |
| E37 | Operational facts: a numeric TAGO quota, revocation of the earlier TAGO key, brand clearance, and live APNs, waitlist and payments. | `MISSING` | Nothing. | Budgeting passive collection against a quota; |

## 11. Human procedures found by the audit

The procedures the repository asked people to perform before this work (the status of each is in `docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md` §15). *Where* cites the audited revision `d81998d` (read it with `git show d81998d:<path>`); later edits in this branch move those lines.

| Id | Kind | Procedure | Where |
|---|---|---|---|
| H01 | BUS_RIDE | v1 operator field-validation ride on /ride-capture/background.html. | docs/DATA_VALIDATION.md:192,241-243,298-304 |
| H02 | STOP_MARKER | Tap each stop where the bus physically halts and the doors open (CLI p <seq>; | docs/HANDOFF.md:107-121 |
| H03 | BUS_RIDE | Invited friends ride with /ride-capture/beta.html: enter the bus number and plate last 4, pick the boarding stop, tap 탑승 시작 and 하차 완료. | docs/exec-plans/BETA_FIELD_TESTER.md:5-10,151-176 |
| H04 | BUS_RIDE | Legacy Task B controlled ride with the CLI (scripts/ride-capture/capture.ts on a laptop with .env.local, stdin commands b/p/n/a/q), the phone controller /ride-capture/ (local-device), or quick-local.h… | docs/HANDOFF.md:26-129 |
| H05 | BUS_RIDE | Repeat the controlled capture on a second and further routes after the first. | docs/HANDOFF.md:127-129 |
| H06 | BUS_RIDE | Collect ride evidence that separates provider lag from collector lag, then re-derive the PROVISIONAL cadence thresholds, the 75 s missing-vehicle grace, the 90 s freshness window and the 120 m near-st… | docs/exec-plans/TASK_C_SOURCE_FRESHNESS.md:106-112 |
| H07 | DEVICE_TEST | Acceptance rides: (a) one practice ride to confirm the submission receipt on a real phone; | docs/exec-plans/FIELD_VALIDATION_SUBMISSION.md:154-155 |
| H08 | DEVICE_TEST | Physical-device matrix: Dynamic Island and non-Island iPhones on the minimum and current iOS; | docs/DEVICE_TEST_PLAN.md:3-29 |
| H09 | MANUAL_INFRA_CHECK | On a Mac, run xcodegen and xcodebuild build test for the app, the widget extension and the 8 iOS tests; | AGENTS.md (verification block) |
| H10 | DEVICE_TEST | Run the Safari ride-capture controller on a real iPhone to verify wake lock, IndexedDB eviction, the lifecycle listeners and the export sheet. | docs/KNOWN_ISSUES.md:8 |
| H11 | DEVICE_TEST | On an iPhone, start a background_acceptance capture on a live bus and leave Safari for at least 60 s while the collector gathers at least 20 snapshots; | services/api/public/ride-capture/acceptance.js:136-338 |
| H12 | OTHER | Keep the phone screen on and the capture page in front for the whole of a browser-owned capture. | docs/HANDOFF.md:72-73 |
| H13 | MANUAL_EXPORT | After every operator ride, tap 검증 데이터 제출 within 2 hours, and 다시 제출 if it fails. | docs/DATA_VALIDATION.md:267-282 |
| H14 | MANUAL_EXPORT | Backup path when submission fails or storage is unconfigured (503): save ① RAW then ② REPORT under one stem to the Files app before the 2-hour deadline, move the files off the phone by hand, and run b… | docs/DATA_VALIDATION.md:249-265,280-281 |
| H15 | MANUAL_EXPORT | Legacy instruction: send back only the sanitized .report.json, never the raw capture; | docs/HANDOFF.md:122-125 |
| H16 | MANUAL_ANALYSIS | Run scripts/ride-capture/analyze.ts on a raw capture by hand when the server analyze step is skipped (captures above about 3.5 MB), fails, or after the analyzer changes. | docs/HANDOFF.md:96-100 |
| H17 | MANUAL_ANALYSIS | To replay the campaign under a newer matcher: run pull-campaign.ts --yes with Upstash credentials, then batch-analyze.ts (v1 rules only), then re-classify beta rides under v2 by hand. | docs/DATA_VALIDATION.md:279-282 |
| H18 | MANUAL_ANALYSIS | A person reviews campaign alerts (replay drift, sameRideAs, GATE_FAILURE, FAIL_CLOSED_BUG, beta records missing their v2 block) before trusting the count. | services/api/src/fieldValidation.ts:123-124,154-161 |
| H19 | MANUAL_ANALYSIS | A person judges 'clear candidate margin', 'multiple routes', 'a source-freshness rule exists' and calibration, reviews the v2 criteria, then edits the literal fieldValidationGate.status in apiConfig.t… | docs/DATA_VALIDATION.md:284-285 |
| H20 | MANUAL_ANALYSIS | Define and test a TAGO source-freshness rule (Task C) from freshnessEvidence and tracked.markerComparisons. | docs/HANDOFF.md:131-140 |
| H21 | MANUAL_ANALYSIS | Decide the written-down policy on whether local-device, cli or engine-less captures can ever count (currently UNRESOLVED). | services/api/src/rideCampaign.ts:336-340,369-375 |
| H22 | MANUAL_ANALYSIS | Tune matcher thresholds and decide which provider fields to trust using real Jeju history, including observing at stops whether nodeord means last-passed or next stop and whether it updates on arrival… | docs/VEHICLE_MATCHING.md:23 |
| H23 | BUS_RIDE | Measure from real riders how often they board the first arriving bus. | services/api/src/passiveShadowSummary.ts:679 |
| H24 | MANUAL_ANALYSIS | Validate the Swift engine separately, or build cross-language conformance tests. | services/api/src/passiveShadowSummary.ts:681 |
| H25 | ACCOUNT_OR_CREDENTIAL | Apply for and rotate TAGO keys in the data.go.kr portal (current keys expire 2028-09-10); | README.md:47-49 |
| H26 | ACCOUNT_OR_CREDENTIAL | In the Vercel dashboard: set TAGO_SERVICE_KEY as Sensitive (Production, and Preview only when needed; | docs/PRODUCTION_TRANSIT_API.md:197-202,331-346 |
| H27 | ACCOUNT_OR_CREDENTIAL | Set by hand in the Railway dashboard: TAGO_SERVICE_KEY, RIDE_CAPTURE_OPERATOR_TOKEN, UPSTASH_REDIS_REST_URL and TOKEN, BETA_TESTERS_ENABLED, WEB_PUSH_VAPID_*, TRANSIT_ALLOWED_ORIGINS (must include the… | services/api/Dockerfile.collector:1-10 |
| H28 | ACCOUNT_OR_CREDENTIAL | Enter the operator token on the phone in each Safari session (sessionStorage), and again after any 401. | services/api/public/ride-capture/app.js:181-203,375-388 |
| H29 | ACCOUNT_OR_CREDENTIAL | Create, send, revoke and reissue beta invites (at most 30 days and 50 rides each); | docs/exec-plans/BETA_FIELD_TESTER.md:226-236,332-333 |
| H30 | ACCOUNT_OR_CREDENTIAL | The owner decides whether to add a TAGO_SERVICE_KEY repository secret, so passive collection uses tago-direct at 5 s instead of the 20 s-cached public API. | docs/KNOWN_ISSUES.md:30 |
| H31 | ACCOUNT_OR_CREDENTIAL | Obtain a paid Apple Developer Program membership or an upload-capable organisation role (legal agreement, 2FA, purchase); | docs/HANDOFF.md:5,147 |
| H32 | ACCOUNT_OR_CREDENTIAL | Provision Supabase, a verified Resend domain and a Toss merchant account; | README.md:26-27,88-91 |
| H33 | ACCOUNT_OR_CREDENTIAL | An administrator enables branch protection on main. | AGENTS.md |
| H34 | MANUAL_INFRA_CHECK | After deploys or env changes, read /health, run services/api/scripts/smoke.ts by hand and review Vercel runtime logs. | README.md:20,76 |
| H35 | MANUAL_INFRA_CHECK | Read the Railway collector /health after deploys to confirm operatorEnabled, fieldValidationStorage 'upstash', betaTesters and betaRestartRecovery. | services/api/src/backgroundServer.ts:91-104 |
| H36 | MANUAL_INFRA_CHECK | Confirm in the Upstash console that eviction is disabled for the database holding no-TTL evidence. | docs/KNOWN_ISSUES.md:25 |
| H37 | MANUAL_INFRA_CHECK | Run the three live verifiers by hand, with Upstash credentials in .env.local, a preview deployment on the redis store, VERCEL_AUTOMATION_BYPASS_SECRET, a bus in service and a quiet database. | scripts/upstash/verify-session-store.ts:5-8,30-72,307-313 |
| H38 | OTHER | Decide whether to move production to TRANSIT_SESSION_STORE=redis with TRANSIT_SESSION_KEY_PREFIX=tapso:prod:journey-session:, then re-run the checks. | docs/KNOWN_ISSUES.md:21 |
| H39 | MANUAL_INFRA_CHECK | Roll back by hand: Vercel Instant Rollback, a revert on main, fixing env vars and redeploying, or pausing the project. | docs/PRODUCTION_TRANSIT_API.md:370-381 |
| H40 | MANUAL_INFRA_CHECK | Before boarding, run four production curls (cities, routes, stops, vehicles) and check by eye that stops are contiguous, the chosen sequences are in order and vehicles are present. | docs/HANDOFF.md:78-89 |
| H41 | MANUAL_INFRA_CHECK | Re-run credentialed TAGO probes by hand (scripts/tago/probe.py, the bounded cadence probe, the local server). | README.md:52-54 |
| H42 | OTHER | Trigger each passive collection or re-evaluation by editing ops/passive-shadow-v3/collection-request.json on a claude/**passive-shadow** branch, or by dispatching the workflow, at the wall-clock time … | .github/workflows/passive-shadow-v3.yml:9-13,38-44 |
| H43 | MANUAL_EXPORT | Copy artifact 10849693394 (run 36098610702's raw streams, 14-day retention) to non-expiring private storage before about 2026-10-09. | .github/workflows/passive-shadow-v3.yml:140-151 |
| H44 | MANUAL_EXPORT | Reassemble the summary and ledger byte-for-byte from base64 chunks in the CI log, check their hashes by hand, and commit them to artifacts/. | docs/validation/PASSIVE_SHADOW_VALIDATION_V3_RESULTS.md:32 |
| H45 | MANUAL_ANALYSIS | Hand-write the per-case wrong-commit analysis of all 268 records, and re-run evaluate.ts per collection. | docs/validation/PASSIVE_SHADOW_VALIDATION_V3_WRONG_COMMITS.md:3-18 |
| H46 | MANUAL_INFRA_CHECK | TestFlight pipeline: increment the build number, archive, validate and upload in Xcode Organizer, inspect the archive's signing, answer export compliance, assign a group, confirm processing; | docs/HANDOFF.md:149,153 |
| H47 | MANUAL_ANALYSIS | Corroborate route existence and classification against the Jeju BIS website by hand, and record request parameters, times, provider and schema for every live validation. | docs/DATA_SOURCES.md:35,39,51-55 |
| H48 | OTHER | An operator sets TRANSIT_AUTOMATIC_MATCHING_ENABLED=true in a deployment's environment. | services/api/src/apiConfig.ts:91-97,165-168 |
| H49 | OTHER | In the default shadow mode, the rider must explicitly confirm the bus before any tracking or progress. | services/api/src/journeySession.ts:282-302,395-411 |
| H50 | OTHER | Governance decisions: threat model, privacy review (including ride-capture retention), brand and trademark clearance with counsel, the support-payment retention decision, and hosting choices. | docs/ROADMAP.md:10 |
| H51 | MANUAL_INFRA_CHECK | Run local replacement checks whenever the GitHub Actions budget blocks CI. | docs/exec-plans/MARKETING_SITE.md:74,80 |
| H52 | OTHER | Working-tree proposed gate: supply the humanOnlyMitigations booleans (BA-3, the rider can see and undo an automatic pick; | services/api/src/matcherSafetyGate.ts:150-161,217-224,295-309 (untracked) |

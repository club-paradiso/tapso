# Passive Shadow Validation v3 — results, 2026-09-25

Policy `passive-shadow-validation-v3`. The method is in
`../exec-plans/PASSIVE_SHADOW_VALIDATION_V3.md`. The machine-readable evidence is
`../../artifacts/passive-shadow-validation-v3-summary.json` (sha256
`e4b50f2a29de0a1136cb995c203733ef731f7cb11e746c4907af715dd1580c66`,
pseudonyms only).

**Release-gate decision: `NOT_READY`.** The live evidence contains 268 wrong
committed selections. All of them are the same failure mode: the matcher commits
to a bus that has already left the rider's stop. Automatic matching stays off
(`TRANSIT_AUTOMATIC_MATCHING_ENABLED=false`).

## Provenance (verified, not inferred)

| Item | Value | How it was established |
|---|---|---|
| Live collection | GitHub Actions run `36098610702`, commit `0ec57f9`, 2026-09-25 05:28:01 → 06:27:52 UTC (14:28–15:27 KST) | job record |
| Provider path | **`tapso-public-api`** (`requestedProviderPath` also `tapso-public-api`) | the collected `manifest.json`, cross-checked against every stream's `providerPath` by `evaluate.ts` |
| Provider calls | 1 815 requests to TAPSO's public `/v1/*`, 5 failed; stop reason `DURATION_REACHED`; 0 incidents | manifest |
| Raw artifact | `passive-shadow-v3-raw`, id `10849693394`, zip sha256 `3b644dbcc1c970adea35547f9761de645b97afa212164c06d218c1864d9de995`, private, 14-day retention | artifact record; the same digest was re-reported by `actions/download-artifact` in both re-evaluation runs |
| Raw evidence tree | sha256 `bce8b504e5b287d9f86eb79345f7e50bdce4537625247c0dee164c2afb8c82fb` over `manifest.json` + 5 `streams/*.json` | hashed before and after evaluation; unchanged |
| Stream checksums | 5 of 5 streams match the manifest's sha256 | `evaluate.ts` refuses on any mismatch |
| **Evidence evaluation** | run `36103361789`, commit `4f84177` (PR head code, includes `GT_VEHICLE_AT_STOP_AT_START`) | `summary.provenance` |
| Network during evaluation | **0 attempts** (`fetch` and sockets replaced; any attempt aborts) | `summary.provenance.networkAttemptsDuringEvaluation` |
| Determinism | run `36103115258` (commit `7211a7b`) re-evaluated the same raw streams; every live classification field is identical to `36103361789` | field-by-field comparison |

The raw streams are immutable evidence. **The evaluation that run
`36098610702` produced at `0ec57f9` is audit history only.** It predates the
`GT_VEHICLE_AT_STOP_AT_START` rejection, which removes 564 candidate cases
under the current code. It is kept as artifact `passive-shadow-v3-summary` id
`10849902390` and is used nowhere below.

Because this container's egress policy blocks the artifact store, the raw
artifact was downloaded and verified inside the CI re-evaluation job, not in
this workspace. The logs of both re-evaluation runs print every raw file's
sha256 and the collected manifest before evaluation starts.

## Live evidence (`LIVE_PASSIVE` only)

### Scope

| Measure | Value |
|---|---|
| Captures (route streams) | 5: `JEB405136001`, `JEB405136002`, `JEB405136521`, `JEB405320111`, `JEB405320112` |
| Time span | 1.0 h, one weekday afternoon (14h–15h KST) |
| Successful snapshots | 593 of 598 (5 failed, recorded as failed, never as empty) |
| Re-served cache receipts dropped | 1 172 |
| Genuine receipt interval | median 29.8–30.1 s per stream, p90 33.5–40.1 s, max 49.7–51.6 s |
| Vehicles seen per stream | 7, 7, 7, 4, 6 (max concurrent 4–6) |
| Trajectories | 31 (29 produced cases) |
| Independent ground-truth vehicles | 27 |
| Distinct boarding events (trajectory × stop) | 739 |
| Pseudo-boarding cases | 6 377 (5 638 `WAIT_AT_STOP`, 739 `ON_BOARD_START`) |
| Vehicles seen on two route streams | 2 |
| Candidate count per case (distinct vehicles before boarding) | 3: 1 141 · 4: 3 030 · 5+: 2 206 |

Generator refusals (candidate cases that never became cases): no arrival
observed 5 146; no arrival within 20 min 2 378; stream truncated 808; a bus at
the boarding stop at the start 564; crossing bracket straddling the start 217;
every other reason 0.

### Buckets, raw cases

| Bucket | All | `WAIT_AT_STOP` | `ON_BOARD_START` |
|---|---:|---:|---:|
| `PASSIVE_CORRECT` | 4 700 | 4 271 | 429 |
| **`PASSIVE_WRONG`** | **268** | **268** | 0 |
| `PASSIVE_ABSTAINED` | 1 210 | 920 | 290 |
| `PASSIVE_AMBIGUOUS` | 3 | 2 | 1 |
| `PASSIVE_STALE_FAILURE` | 0 | 0 | 0 |
| `PASSIVE_DIRECTION_FAILURE` | 0 | 0 | 0 |
| `PASSIVE_INSUFFICIENT_EVIDENCE` | 0 | 0 | 0 |
| `PASSIVE_PROVIDER_FAILURE` | 196 | 177 | 19 |

| Metric (denominators explicit) | All | `WAIT_AT_STOP` | `ON_BOARD_START` |
|---|---:|---:|---:|
| Evaluable (cases − provider failure − insufficient) | 6 181 | 5 461 | 720 |
| Committed | 4 968 | 4 539 | 429 |
| Committed-selection precision (correct / committed) | 0.9461 | 0.9410 | 1.0000 |
| Coverage (committed / evaluable) | 0.8038 | 0.8312 | 0.5958 |
| Wrong-commit rate (wrong / evaluable) | 0.0434 | 0.0491 | 0 |
| Abstention rate ((abstained + ambiguous) / evaluable) | 0.1962 | 0.1688 | 0.4042 |

Selections made on non-fresh cadence: **0**. Of the 1 409 non-committed cases
(abstained, ambiguous, provider failure), 970 are ones where the true bus never
had `fresh` cadence.

### By difficulty

| Difficulty | Cases | Correct | Wrong | Abstained | Provider failure | Precision | Wrong-commit rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| `DEPARTED_DECOY` (another bus already past the stop, within 4 stops, before boarding) | 785 | 444 | **268** | 21 | 52 | 0.6236 | **0.3656** |
| `SINGLE_CANDIDATE` | 5 592 | 4 256 | 0 | 1 189 (+3 ambiguous) | 144 | 1.0000 | 0 |

No case fell into `CONTESTED` without also having a departed decoy. On a route,
a second nearby bus is either ahead of the stop or behind it.

### Grouped (correlated cases collapsed)

| Unit | Total | ≥ 1 wrong commit | Only correct commits | Never committed |
|---|---:|---:|---:|---:|
| Trajectory | 29 | **15** | 13 | 1 |
| Boarding event | 739 | **142** | 510 | 87 |

The 268 wrong cases are not 268 independent rides. They come from 142
boarding events on 15 trajectories. Fifteen of 29 observed bus runs produced at
least one wrong commit.

### Every wrong committed selection

All 268 come from the full profile, not from the capped diagnostics.

| Property | Value |
|---|---|
| Kind | `DEPARTED_VEHICLE`: 268 of 268 |
| Scenario | `WAIT_AT_STOP`: 268; `ON_BOARD_START`: 0 |
| Committed bus position at commit | 1 stop past the boarding stop: 17 · 2 past: 60 · 3 past: 95 · 4 past: 96 |
| Commit time relative to the true bus reaching the stop | min −1 096 s, median −709 s, p90 −520 s, max −309 s |
| By route | `JEB405136521` 133 · `JEB405136002` 100 · `JEB405136001` 34 · `JEB405320112` 1 · `JEB405320111` 0 |

The mechanism is finding F1. The stop-position term is
`20 − 5·|seq − boardingSeq|`, so a bus 1–4 stops past the rider scores like
one 1–4 stops before. A bus that has just left is fresh (it is moving). In all 50
retained wrong-commit timelines it was the **only** eligible candidate at the
commit. The true bus was either rejected as `implausible_boarding_position`
(more than 4 stops away; 26) or not among the four listed candidates or not in
the feed (24). With one eligible candidate the ambiguity margin never applies,
so the matcher commits alone. The median commit came about 12 minutes before
the bus the rider actually boards arrived. Sanitized per-case timelines for the
first 50 are in `summary.live.wrongCommits`.

Correct commits: 2 707 before the modelled boarding and 1 993 at or after it.
The median is 51 s before boarding.

## Adversarial evidence (`SYNTHETIC_OR_PERTURBED`, never live)

The variants perturb 300 real cases: one `WAIT_AT_STOP` case per boarding event,
deterministic stride. Baseline on those 300: 241 correct, 4 wrong, 44
abstained, 11 provider failure. "Stale rej." means no commit while the true bus
was never `fresh`. "Dir. rej." means cases in which some candidate was rejected
on route or direction. `T` marks variants built using the answer's identity.

| Family | Variant | T | Correct | Wrong | Abstained | Stale rej. | Dir. rej. |
|---|---|:-:|---:|---:|---:|---:|---:|
| Poll dropout | every 3rd | | 0 | 0 | 300 | 300 | 0 |
| | every 5th | | 174 | 4 | 122 | 92 | 0 |
| | seeded 20 % | | 199 | 1 | 100 | 77 | 0 |
| | 60 s outage before boarding | | 235 | 4 | 61 | 37 | 0 |
| Delay | content lag 10 s | | 247 | 1 | 52 | 27 | 0 |
| | content lag 20 s | | 247 | 1 | 52 | 27 | 0 |
| | content lag 40 s | | 243 | 1 | 56 | 36 | 0 |
| | receipt jitter 10 s | | 0 | 0 | 300 | 300 | 0 |
| | receipt jitter 20 s | | 0 | 0 | 300 | 300 | 0 |
| | receipt jitter 40 s | | 3 | 0 | 295 | 294 | 0 |
| Stale repetition | 60 s frozen before boarding | | 239 | 4 | 57 | 36 | 0 |
| | 120 s frozen before boarding | | 234 | 4 | 62 | 41 | 0 |
| Vehicle disappearance | true bus, 60 s | T | 235 | 4 | 61 | 37 | 0 |
| | nearest real competitor, 60 s (13 applicable, 287 had none) | T | 8 | 4 | 1 | 1 | 0 |
| Competitor pressure | synthetic bus one stop behind the true bus | T | 44 | 15 | 241 (173 ambiguous) | 34 | 0 |
| Direction ambiguity | synthetic opposite-route twin | T | 241 | 4 | 55 | 34 | 300 |
| | synthetic reversing decoy | | 241 | 4 | 55 | 34 | 0 |

Receipt jitter 40 s also produced 2 `PASSIVE_DIRECTION_FAILURE`: reordered
receipts showed the committed bus stepping backwards more than 90 s before the
commit, outside the cadence window.

What the adversarial runs say:

- **Fail-closed on freshness holds.** Losing polls or jittering receipts turns
  commits into abstentions, not into wrong buses. No variant produced a
  selection on non-fresh cadence.
- **The opposite-route twin and the reversing decoy never win.** Both are
  rejected on every case: on `wrong_route`, and on stale cadence from sequence
  regression, respectively.
- **Competitor pressure is handled partly.** A bus one stop behind the true bus
  turns 173 of 241 correct cases into `ambiguous`, which is the intended
  withholding. It also adds 11 wrong commits: the follower wins once the true
  bus has moved past the stop.
- **Content lag of 10–40 s barely changes outcomes.** Wrong commits here come
  from topology, not lag.

## Historical evidence

No replayable historical raw capture exists in the repository or in this
workspace. The 13 historical rides audited on 2026-09-23 are
`REPORT_ONLY_NO_RAW` (`../DATA_VALIDATION.md`). Upstash field-validation
submissions were not reachable from this environment. Historical evidence
therefore contributes **no matcher result**. Its only use here is supporting
context: the 2026-09-11 probe measured a 27.52 s median content-change
interval (`TAGO_2026-09-11.md`), consistent with the movement cadence seen
here.

## Human-beta replacement analysis

| Validation property | Human beta provided | Passive v3 provides | Equivalent? | Residual uncertainty |
|---|---|---|---|---|
| Vehicle matcher correctness | Rider-confirmed boarded bus | First-arrival model over real trajectories; 6 377 cases, 739 boarding events, 29 trajectories | **Partially.** Stronger in volume, weaker in ground-truth certainty | Riders who let a bus go, or board a departing one, are invisible |
| Candidate ambiguity | Only the rides actually taken | Every stop × start on 5 routes, including 785 departed-decoy cases | **Stronger** for coverage of hard geometry | One afternoon hour; 5 routes |
| Route diversity | Whatever testers ride | 5 route IDs, 1 hour | **Not equivalent yet** | Needs more routes, days and hours |
| Freshness rejection | Real session cadence (5 s uncached) | Real receipts through a 20 s cache (≈ 30 s median) | **Not equivalent** | The public-API path sits at the 30 s gap limit; coverage figures do not transfer to 5 s sessions |
| Direction safeguards | Real reversals if they occur | TAGO carries no direction code; route ID filters direction; 0 reversals committed; synthetic twins rejected | **Partially** | No real direction-code data exists to test |
| Provider cadence | Session receipts | Receipt and content cadence of the cached public path | **Partially** | Direct-TAGO cadence not observed here |
| Physical stop timing | Operator markers (v1 only) | None | **Not equivalent** | Needs physical markers |
| Passenger bus confirmation | Tester enters bus + plate | None | **Not equivalent** | UI and interaction untested |
| iPhone Safari behaviour | Real device | None | **Not equivalent** | Device-only |
| Railway restart during a real ride | Real ride + restart | None | **Not equivalent** | Device + collector |

Conclusion: passive v3 can **replace** repeated human rides for discovering
matcher identity failures across many real geometries, and it already found
one the human campaign had not. It **cannot replace** human beta for ground
truth certainty, interaction, physical timing, device lifecycle or restart UX.

## Validity threats (stated, not resolved)

1. **Cached provider path.** Receipts came through TAPSO's public API with a
   20 s shared cache, polled every 10 s. The genuine receipt median of about
   30 s equals `server_observed_cadence_v1`'s 30 s `maximumReceiptGap`, so cadence
   was often `stale` and the matcher abstained. A 5 s uncached session would see
   fresh cadence more often. `INFERRED`: that would produce more commits, and the
   departed-bus commits in particular would not decrease, because the departed
   bus is moving and fresh either way. The wrong-commit rate here is therefore
   not an upper bound.
2. **Ground-truth model.** "First vehicle to reach the stop after T0" is a
   behavioural assumption. The generator refuses every start where it cannot be
   established (including a bus at the stop at T0), but the model cannot see
   rider choice.
3. **TAGO `nodeord` semantics are unverified** (last-passed or next stop). The
   `DEPARTED_VEHICLE` label holds under either reading, because a start with a
   bus reporting the stop itself is refused.
4. **Correlation.** Cases share trajectories and streams. The grouped counts
   above are the honest sample size: 29 trajectories, 739 boarding events.
5. **One hour, one afternoon, one weekday, 5 route IDs.**

## Decision

`NOT_READY`. The matcher committed to the wrong bus in 268 of 5 461 evaluable
waiting-rider cases (142 of 739 boarding events; 15 of 29 trajectories). Every
wrong commit is a bus that had already passed the rider's stop. Collecting
more passive data will not close this. It needs a matcher change: for example,
refusing or penalising a candidate whose stop sequence is at or past the
boarding stop before the session has evidence the rider is aboard. That change
must then be re-validated on these same raw streams and on new ones.
`ON_BOARD_START` showed 0 wrong in 429 commits, which suggests the risk is
concentrated in sessions started while waiting. That is not evidence that
either session start is safe to automate.

Automatic matching remains disabled. Nothing here changes v1
(`broad-real-mode-30-boardings-v1`) or v2 (`beta-matcher-30-boardings-v2`)
counts.

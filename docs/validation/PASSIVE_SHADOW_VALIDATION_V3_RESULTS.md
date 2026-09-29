# Passive Shadow Validation v3 — results, 2026-09-25

> **Note, 2026-09-29.** Every matcher result below comes from the matcher then
> serving, `symmetric-stop-distance-v0`, and everything below stands as
> recorded, including the `NOT_READY` decision and the 268 wrong commits. F1
> is fixed in `directed-route-progress-v1`, now the serving backend policy;
> the old one survives only in `services/api/src/matchingLegacy.ts`, for
> comparison and negative controls.
> Re-decided at each of the 268 commit instants from the hash-checked ledger,
> the directed policy selects nothing and the legacy policy reproduces all 268
> selections (`VERIFIED_BY_REPLAY`, instant level, in the labels of
> `../exec-plans/HUMAN_LABOR_ELIMINATION.md`; per case:
> `FORMER_WRONG_COMMITS_UNDER_DIRECTED_POLICY.md`). What the directed policy
> does over each full case window is `MISSING` until
> `.github/workflows/matcher-evidence.yml` replays the raw streams after merge.
> New raw uploads are kept 90 days; the raw artifact of run `36098610702`
> below (14-day retention) expires 2026-10-09T06:28:03Z, and that workflow's
> first replay run copies it. The release gate is now
> `matcher-passive-safety-v4` (`MATCHER_SAFETY_EVIDENCE_V4.md`), and the
> current replacement analysis for human rides is
> `EVIDENCE_SUBSTITUTION_MATRIX.md`.

Policy `passive-shadow-validation-v3`. The method is in
`../exec-plans/PASSIVE_SHADOW_VALIDATION_V3.md`. The machine-readable evidence is
`../../artifacts/passive-shadow-validation-v3-summary.json` (sha256
`0422f291e59738d82a73d222a522f6b5b743c322efae78ca4b812da4b54f5069`), and
every live wrong commit is recorded individually in
`../../artifacts/passive-shadow-validation-v3-wrong-commits.json` (sha256
`a960d428caa9d967ddbde0e66f9f1a9963cfd65df519bc6acc58951532fd8773`) and
rendered in `PASSIVE_SHADOW_VALIDATION_V3_WRONG_COMMITS.md`. Both files use
pseudonyms only.

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
| **Evidence evaluation of record** | run `36108364969`, commit `db51667` (PR head code: includes `8af4ed3` offline guard, `bfcc8b8` `GT_VEHICLE_AT_STOP_AT_START`, and every later fix); collect step `skipped` | job record; `summary.provenance` |
| Raw files before evaluation | the job printed `sha256sum` of every file in the downloaded collection before evaluation started: `manifest.json` `36b75847…a005`; streams `c2a50259…`, `f3bc6a56…`, `253dde69…`, `7bb05118…`, `91da65b9…` | job log |
| Raw files after evaluation | `evaluate.ts` re-hashed `manifest.json` + `streams/*.json` after evaluation; raw tree `bce8b504…c82fb` identical before and after (it aborts otherwise); per-file sha256 in `summary.provenance.rawFiles` equal the pre-evaluation listing | `summary.provenance` |
| Network during evaluation | **0 attempts** (`fetch` and outbound sockets replaced; any attempt aborts); **0 provider calls** (collect step skipped); **0 production writes** (the job has `contents: read`, `actions: read` and no Upstash or deployment credential); outputs written to `work/passive-shadow*/`, outside the raw directory | `summary.provenance`, job record, workflow |
| Summary / ledger | summary sha256 `0422f291…5069` (604 711 bytes), ledger sha256 `a960d428…8773` (714 583 bytes), both reassembled byte-for-byte from the job log and matched against the hashes the job printed | log reassembly |
| Determinism | runs `36103115258` (commit `7211a7b`) and `36103361789` (commit `4f84177`) re-evaluated the same raw streams; every live classification field and the full adversarial section are identical across all three | field-by-field comparison |

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

### Contested and ambiguous cases

| Measure | Cases |
|---|---:|
| Cases with ≥ 2 eligible candidates at some decision (contested) | 46 |
| Cases with at least one `ambiguous` decision | 46 (29 correct, 14 wrong, 3 ended ambiguous) |
| Cases that *ended* `PASSIVE_AMBIGUOUS` | 3 |
| Most eligible candidates at any one decision: 0 / 1 / 2+ | 1 406 / 4 925 / 46 |

Two eligible buses at once were rare: 46 of 6 377 cases. The ambiguity margin
was exercised in 46 cases. Everything else was decided by which single bus was
eligible.

### Difficulty of the live evidence

"Nearby" means within ±4 stops of the boarding stop at a pre-boarding decision.
That is the matcher's own plausibility range.

| Class | Cases | Correct | Wrong | Abstained | Ambiguous | Provider failure | Precision | Wrong-commit rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Trivial**: only the true bus was ever nearby (`SINGLE_CANDIDATE`) | 5 592 | 4 256 | 0 | 1 189 | 3 | 144 | 1.0000 | 0 |
| At most one bus nearby at any decision (includes cases where that one bus was the departed decoy) | 6 188 | 4 558 | 222 | 1 209 | 3 | 196 | 0.9536 | 0.0370 |
| Two or more buses nearby at some decision | 189 | 142 | 46 | 1 | 0 | 0 | 0.7553 | 0.2434 |
| Departed decoy: another bus already at/past the stop, within 4 stops, before boarding | 785 | 444 | **268** | 21 | 0 | 52 | 0.6236 | **0.3656** |
| Approaching-vs-departed at the same decision (one bus within 4 before, one within 4 at/after) | 185 | 139 | 46 | 0 | 0 | 0 | 0.7514 | 0.2486 |
| Same-route competitor *behind* the true bus, nearby | **0** | – | – | – | – | – | undefined (0 denominator) | undefined |

What this means:

- **The 4 256 correct commits on trivial cases are not matcher validation.**
  With one bus near the stop and it being the right one, any matcher that
  checks the route would pick it. They are reported so they cannot be hidden
  inside a headline number.
- **A single nearby bus is not the same as an easy case.** 222 of the 268
  wrong commits happened with only one bus nearby. That bus was the departed
  decoy, while the true bus was still outside the ±4-stop range.
- On the non-trivial classes, committed-selection precision is 0.62–0.76.
- **Same-route competitor pressure (a second bus following the true bus into
  the stop) was not observed at all.** Its denominator is 0. The only evidence
  on that geometry is synthetic (below).

### Was abstention safer than commitment?

Counterfactual over the 1 409 non-committed cases: had a policy forced a commit
to the top eligible candidate at the first decision that had one, what would it
have picked?

| Outcome | Cases |
|---|---:|
| No candidate was ever eligible (nothing to force) | 1 406 |
| Forced commit would have been the true bus | 3 |
| Forced commit would have been the wrong bus | 0 |

In this sample, abstention never avoided a wrong commit that a forced commit
would have made. Almost every abstention (1 406 of 1 409) was the cadence or
position gate leaving no eligible candidate: 970 of the 1 409 had the true bus
never `fresh`. The matcher's fail-closed behaviour is therefore not what
protected riders from the departed-decoy failure. Where the decoy was present,
the matcher committed (712 of 733 evaluable departed-decoy cases).

### Grouped (correlated cases collapsed)

| Unit | Total | ≥ 1 wrong commit | Only correct commits | Never committed |
|---|---:|---:|---:|---:|
| Trajectory | 29 | **15** | 13 | 1 |
| Boarding event | 739 | **142** | 510 | 87 |

The 268 wrong cases are not 268 independent rides. They come from 142
boarding events on 15 trajectories, with 15 distinct true buses and 15
distinct selected buses. Fifteen of the 29 observed bus runs produced at least
one wrong commit.

### Every wrong committed selection (268, each inspected)

Per-case table: `PASSIVE_SHADOW_VALIDATION_V3_WRONG_COMMITS.md`. It gives the
true bus, selected bus, boarding sequence, candidate set at the commit,
freshness, direction, status timeline and mechanism for every one of the 268.
It is generated from the ledger. What all 268 records show:

| Property | Value |
|---|---|
| Kind | `DEPARTED_VEHICLE`: 268 of 268 |
| Scenario | `WAIT_AT_STOP`: 268; `ON_BOARD_START`: 0 |
| Eligible candidates at the commit | exactly 1 in 268 of 268 (so no margin was ever computed) |
| Selected bus at the commit | 1 stop past the boarding stop: 17 · 2: 60 · 3: 95 · 4: 96; cadence `fresh` in all 268; score 70 / 65 / 60 / 55 = 30 route + 25 fresh + (20 − 5 · offset) |
| True bus at the commit, **M1** (200) | in the feed, `fresh`, 5–14 stops *before* the stop (−5: 37, −6: 52, −7: 50, −8: 31, −9: 18, −10: 6, −11: 4, −12: 1, −14: 1), rejected `implausible_boarding_position` |
| True bus at the commit, **M2** (68) | not present in that snapshot at all |
| Freshness | 0 selections on non-fresh cadence |
| Direction | 0 stop-sequence or direction-code reversals by the committed bus before the commit; 0 route/direction rejections |
| Commit time relative to the true bus reaching the stop | min −1 096 s, median −709 s, p90 −520 s, max −309 s |
| By route | `JEB405136521` 133 · `JEB405136002` 100 · `JEB405136001` 34 · `JEB405320112` 1 · `JEB405320111` 0 |
| Passed through `ambiguous` first | 14 of 268 |

**Mechanism, the same in every row (F1).** The stop-position term is
`20 − 5·|seq − boardingSeq|`, so it cannot tell a bus 1–4 stops past the rider
from one 1–4 stops before. A bus that has just left the stop is moving, so its
cadence is `fresh`, and it lies inside the ±4-stop plausibility range. The bus
the rider will actually board is further away: rejected as implausible (M1) or
not yet in the feed (M2). The departed bus is therefore the only eligible
candidate, and with one candidate the ambiguity margin cannot trip. The
matcher commits a median of about 12 minutes before the right bus arrives.

The matcher was not changed to make any of these pass.

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

| Validation property | Human beta provided | Passive v3 provides | Equivalent? | Verdict |
|---|---|---|---|---|
| Vehicle matcher correctness | Rider-confirmed boarded bus | First-arrival model over real trajectories: 6 377 cases, 739 boarding events, 29 trajectories | Stronger in volume, weaker in ground-truth certainty | **Partially replaces**. It finds identity failures a human campaign would need many rides to meet; it cannot confirm which bus a person boarded |
| Candidate ambiguity | Only the rides actually taken | Every stop × start on 5 routes: 785 departed-decoy cases, 185 approaching-vs-departed, 46 contested | Stronger for the geometries observed; 0 follower-pressure cases observed | **Partially replaces** |
| Route diversity | Whatever testers ride | 5 route IDs, one weekday hour | Weak diversity | **Partially replaces**. More days, hours and routes needed |
| Freshness rejection (matcher side) | Real session cadence (5 s uncached) | Real receipts through a 20 s cache (≈ 30 s median); 0 stale selections; adversarial dropout/jitter fail closed | The cadence regime differs from a session | **Partially replaces** |
| Direction safeguards | Real reversals if they occur | TAGO has no direction code; the route ID filters direction; 0 reversals committed; synthetic twins rejected | No real direction-code data exists | **Partially replaces** |
| Provider cadence | Session receipts | Cadence of the cached public path only | Not the direct-TAGO cadence | **Partially replaces** |
| Physical stop timing (marker lag) | Operator markers (v1) | Nothing | – | **Cannot replace** |
| Passenger bus confirmation | Tester enters bus + plate | Nothing | – | **Cannot replace** |
| iPhone Safari behaviour | Real device | Nothing | – | **Cannot replace** |
| Railway restart during a real passenger ride | Real ride + restart | Nothing | – | **Cannot replace** |

Passive v3 fully **replaces** no property. It partially replaces the
matcher-side properties, and it has already surfaced a failure the human
campaigns had not. Physical boarding timing, passenger confirmation, iPhone
Safari and restart UX are **not** validated by anything in this document.

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

`NOT_READY`. The evidence of record is run `36108364969` at `db51667`,
identical to the two earlier re-evaluations. In it, the matcher committed to
the wrong bus in 268 of 5 461 evaluable waiting-rider cases (142 of 739
boarding events; 15 of 29 trajectories). On the non-trivial difficulty
classes, precision is 0.62–0.76. Every
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

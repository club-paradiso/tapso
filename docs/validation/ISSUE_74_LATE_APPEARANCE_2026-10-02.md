# Issue #74: `late_appearance_s_minus_2` on real bases, measured (2026-10-02)

Status: **not fixed, by decision.** Readiness stays `READY_FOR_SHADOW`; CA-5 stays FAIL.
The counterfactual family is unchanged and was not narrowed.

Every result here is `SYNTHETIC_OR_PERTURBED` (`COUNTERFACTUAL_OF_LIVE_PASSIVE`): the
counterfactual suite applied to retained raw passive collections, offline. Nothing is a
live observation or an independent ride. Vehicle identities appear nowhere below.

## Inputs

- The five raw collections in the private vault release (`passive-evidence-vault`),
  each verified against its `.sha256` before use; one (`pv3-20260930T155501Z`) has no
  applicable case.
- Matcher at this branch's head: `directed-route-progress-v1`. The counterfactual
  catalogue `COUNTERFACTUALS` is unchanged.
- Tools: `scripts/matcher-evidence/trace-counterfactual.ts` for the role-only traces, and
  `runCounterfactuals` with a replacement matcher for the candidate rules. The script is
  a scratch harness, not committed, about 30 lines. The replacement is labelled with its
  own policy name, so `matchReplay` refuses a mislabelled run.

## The 23 failures, confirmed

| Collection | `late_appearance_s_minus_2` applicable | failing |
|---|---:|---:|
| `pv3-20260925T052712Z` (evidence of record) | 4 699 | 0 |
| `pv3-20260930T071906Z` | 3 344 | **23** |
| `pv3-20261001T021451Z` | 2 361 | 0 |
| `pv3-20261002T110609Z` | 2 709 | 0 |

The full suite over all four bases fails on nothing else: 23 expectation failures and 23
wrong commits in 772 000 applicable evaluations, all in this family. That answers the
issue's first open question.

The role-only traces show one shape:

- All 23 are on one route variant (`JEB405328101`), at four boarding events (stop
  sequences 31, 51, 54 and 55). The repeated cases are the same event under different
  session start times.
- **Every wrong commit is at offset −4**, the far edge of the approach window. The
  hidden first-arriving bus is between the committed bus and the stop: it is at −3 or −2
  until it first reports at −2.
- The committed bus had been in sight for 4 to 28 polls, so a minimum observation
  duration does not separate these cases.
- The hidden bus arrives 194 to 415 s after the commit.

## Candidate rules, measured

Correct commits across all families and bases are the coverage measure. Wrong commits
and expectation failures are the safety measure.

| Rule | Wrong commits (all bases) | Late-appearance failures | Correct commits | Change |
|---|---:|---:|---:|---:|
| Production (`approachWindowStops` 4) | 23 | 23 | 229 035 | — |
| Never select at the window's far edge (−4) | 0 | 0 | 198 395 | **−13.4 %** |
| Approach window of 3 stops | 0 | 0 | identical to the row above on the three bases run | |

Per base, the far-edge rule loses 13.5 %, 12.5 %, 15.3 % and 12.9 % of correct commits.
It adds no wrong commit, no expectation failure and no invariant violation in any family.

The loss is spread over families in which the true bus is plainly visible, for example
`true_bus_approaching`, `follower_behind_k3`, `decoys_absent` and `reappearance_60s`.
So it is lost coverage, not lost risk.

## Why neither rule ships

1. **It is fitted to the family's parameter.**
   - The family hides the leader until it reports two stops out. A commit at −4 leaves
     an unobserved gap of three stops, and the leader can hide in it. A commit at −3
     leaves two stops, and under this family the leader would already be visible there.
   - A leader hidden until one stop out (`s_minus_1`) defeats the 3-stop rule in the
     same way. The problem is partially observable, as the issue states: no rule that
     reads the feed can see a bus the feed does not report.
   - Adopting the rule would turn CA-5 green by matching one parameter. It would not
     remove the hazard.
2. **The cost is real and the gain is nil today.**
   - Thirteen percent of correct commits are lost on clean cases.
   - Readiness would still not rise: CA-6 and CA-7 fail on sample volume
     (`MATCHER_SAFETY_EVIDENCE_V4.md`).
3. **The hazard does not reach a rider at the current readiness.**
   - At `READY_FOR_SHADOW` the matcher's pick reaches no rider (issue #80, enforced in
     code since 2026-10-02).
   - The rider identifies the bus from raw positions and confirms by tap.
   - Automatic matching stays refused below `READY_FOR_BOUNDED_AUTOMATION`, and the
     boarding watch (F20) withdraws an automatic selection once the hidden bus is seen
     at the stop.

## What would change this decision

- Before any delayed-commitment rule is adopted, add `late_appearance_s_minus_1` and
  `late_appearance_s_minus_3` beside the existing family. A rule can then be judged on
  families it was not tuned on. This adds to the catalogue and removes nothing. It is a
  release-gate change for a reviewed PR.
- Field evidence of how often a Jeju bus is absent from TAGO while within four stops of
  a stop would turn the hidden-leader hazard from `SIMULATED` into a measured rate.
  Today it is `MISSING`.

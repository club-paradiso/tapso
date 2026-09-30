# Evidence substitution matrix — what replaced the thirty rides

The legacy gates (`broad-real-mode-30-boardings-v1`, `beta-matcher-30-boardings-v2`)
asked for thirty human boardings each. Neither was ever run: both counts are
zero, and they stay zero — nothing here manufactures a ride. This document
decomposes those gates into the risks they were meant to cover and says, for
each risk, what now covers it, with what kind of evidence, and whether that is
stronger than, equivalent to, partly a substitute for, or no substitute at all
for a human ride.

Labels are those of `docs/exec-plans/HUMAN_LABOR_ELIMINATION.md` and are never
blurred. "30 rides" below means what thirty rides *would* have provided; none
exists.

## Verdict scale

| Verdict | Meaning |
|---|---|
| `STRONGER` | The new evidence covers the risk more completely than thirty rides could |
| `EQUIVALENT` | Covers it as well |
| `PARTIAL` | Covers part of it; the remainder is named |
| `NON_SUBSTITUTABLE` | Only a person can establish it; see the architecture response |

## Matrix

| Risk | What 30 rides would have provided | What covers it now (label) | Verdict | Remainder / response |
|---|---|---|---|---|
| **Matcher identity correctness** (the matcher picks the bus the rider boards) | Rider-confirmed ground truth on ≤ 30 rides | Blind replay of real trajectories under the first-arrival model (`VERIFIED_LIVE_PASSIVE` base, 6 377 cases, 739 boarding events, 29 trajectories); instant re-decision of all 268 former wrong commits (`VERIFIED_BY_REPLAY`); 16 invariants × ≥ 2 000 seeds (`VERIFIED_BY_TEST`); counterfactual families and ground-truth journey sessions through the session coordinator (`SIMULATED`) | `PARTIAL` | Ground truth is a rider *model*, not an observed boarding. Response: shipped behaviour is confirmation-assisted at most, so the rider's own tap is the identity decision |
| **Passed-bus rejection** (F1) | Rare: a departed decoy appears only in some rides | Structural rule + runtime invariant (`assertDirectedInvariant` throws), P1/P2 properties, the F1 negative controls, 268/268 former instants no longer commit | `STRONGER` | None for the matcher: a departed bus cannot be committed by construction. Provider lag can still show a departed bus as approaching — see "physical-only" below |
| **Same-route ambiguity** (leader/follower, bunching) | Only the bunching that happened on the rides taken | Leader rule + 3-stop margin + memory of dropped vehicles; P12, P3; counterfactual separations 1–5 and 10 stops, overtaking, multiple eligible; after a selection, the boarding watch withdraws it when another bus is seen reaching the stop first (F20, P16, `SIMULATED` ground truth) | `STRONGER` (construction) / `PARTIAL` (live) | Live contested cases: 46 in v3 (from at most 29 trajectories), 0 follower-pressure cases. Scheduled windows add more; gate CA-6 counts contested trajectories, not cases, and needs ≥ 30 |
| **Candidate diversity** | ≤ 30 candidate sets | Every stop × start on every observed route | `STRONGER` | Volume grows with each automated window |
| **Route diversity** | Whatever routes testers ride | 5 route IDs live so far; seven route pools scheduled, each once a week (by KST weekday) | `PARTIAL` | Gate CA-7 needs ≥ 8 routes, ≥ 3 windows, ≥ 2 time bands |
| **Cadence liveness** | Session-cadence receipts during the rides | Passive receipts through the cached public path (~30 s median); the 2026-09-22 Railway run (`VERIFIED_LIVE_INFRASTRUCTURE`, one run, 7.94 s worst gap) | `PARTIAL` | Direct-TAGO passive collection needs a `TAGO_SERVICE_KEY` repository secret (owner's credential); gates BA-1 and BA-2 count only session-cadence windows toward bounded automation |
| **Stale-data rejection** | Whatever staleness occurred naturally | Cadence classifier + P5/P6/P8 + freeze, jitter, loss, error-burst families | `STRONGER` | — |
| **Provider failures** | Natural failures only | Fault injection (P7: a failed poll counts exactly as nothing; error bursts; long gaps); 5 real failures in 1 815 calls observed | `STRONGER` | A vehicle seen *only* in failed polls cannot be defended against; memory and fresh-cadence minimums bound the effect |
| **Provider observation lag vs physical stop** | Operator stop markers (v1 only) | Nothing: TAGO has no observation timestamp and passive ground truth comes from the same feed | `NON_SUBSTITUTABLE` | Removed from the matcher's safety path: under confirmation-assisted operation the rider taps the bus they can see. Alert timing still depends on it (2-stop "prepare" alert as margin); gate BA-4 blocks automation until it does not |
| **Bus-entry correctness** (rider identifies the right bus) | Beta testers typing bus + plate | Nothing passive can observe a person's input | `NON_SUBSTITUTABLE` | Not a release requirement any more; the confirmation list is plausible buses nearest the stop first, each with its identifier |
| **Boarding-stop entry correctness** | Rider picks a stop by name | Nothing passive | `NON_SUBSTITUTABLE` | A boarding stop whose name or id repeats on the route withholds automation (`boarding_stop_repeats_on_route`) |
| **iOS Safari lifecycle** | Operator rides on the web recorder | Not needed: the web recorders existed only to capture human rides | Eliminated as a dependency | The rider product is native iOS |
| **Railway background continuity** | Background acceptance during rides | One clean run 2026-09-22 (`VERIFIED_LIVE_INFRASTRUCTURE`); deterministic tests | `EQUIVALENT` for what remains needed | Railway serves only the legacy human flows, which are no longer release requirements |
| **Railway restart durability** | Real-iPhone ride across a restart (never done) | Two-process restart tests (`VERIFIED_BY_TEST`); live Upstash capture-journal verifier 16/16 on 2026-09-25 (`VERIFIED_LIVE_INFRASTRUCTURE`) | `PARTIAL` | The full phone → restart → recovery path is unverified and relevant only to legacy human rides |
| **Raw evidence durability** | Raw exports saved by hand within a 2-hour window | Checksum-verified private draft-release vault, written directly by the evidence workflows | `STRONGER` | The v3 evidence-of-record was migrated into the vault on 2026-09-30; its plaintext Actions copies were then deleted because the repository is public |
| **Matcher determinism** | Not tested by rides | P13; the replay job migrates the record twice and requires byte-identical output; the gate's live inputs are computed twice in two processes, with a case-level digest of every decision per window, and must be byte-identical (gate CA-4) | `STRONGER` | — |
| **Swift/backend policy drift** | Not tested by rides | Swift engine documented demo-only; `crossLanguageAuthority.test.ts` fails if the app gains a network path or real data reaches it; 22 language-neutral specification cases | `STRONGER` | A Swift port must pass the shared cases before it may decide anything |
| **Dynamic Island / physical-device UX** | Not part of the ride gates | Simulator verification (iOS 26.3) | `NON_SUBSTITUTABLE` on hardware | A device check, not a bus ride; not a matcher-safety property; gate BA-5 requires it before automation |

## Physical-only unknowns and the architecture response

| Unknown | Needed for an unsafe autonomous decision? | Response |
|---|---|---|
| Provider reporting lag relative to the physical stop | Yes, for *automatic* commitment: a lagging feed can show a bus that has left as still approaching, and passive replay cannot see it | Automatic commitment is not part of the shipped contract. Confirmation-assisted operation makes the rider's tap the decision. Destination alerts keep the 2-stop prepare margin and fail closed on stale or mismatched data |
| Whether riders board the first arriving bus | Yes, for automatic commitment | Same: the rider confirms. `READY_FOR_AUTOMATIC_MATCHING` requires measuring it and is not a product target |
| Rider data-entry mistakes (wrong stop, wrong bus, wrong rider state) | Rider-state mistakes only in one direction | Default rider state is waiting, whose failure mode is abstaining; repeated boarding-stop names withhold; the rider always confirms |
| Physical-device Live Activity appearance | No (presentation, not selection) | Simulator-verified; hardware check required before automation (gate BA-5) |

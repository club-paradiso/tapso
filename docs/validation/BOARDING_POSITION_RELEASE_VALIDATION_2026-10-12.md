# Boarding position release validation (2026-10-12)

Validation of the boarding-anchor ride position shipped in PR #130 (`docs/exec-plans/BOARDING_ANCHOR_POSITION_V2.md`). Branch `feat/boarding-position-release-validation`, from `main` at `23d3cca`. Reality labels as in `docs/DATA_VALIDATION.md`. This is release-blocker work, not a release: hybrid tracking stays off (`TRANSIT_HYBRID_TRACKING_ENABLED` unset, `-tapsoHybridTracking` Debug-only), automatic matching and any automatic boarding commit stay off, nothing was deployed.

Three things are kept apart throughout: **implemented** (code on this branch), **automated** (a deterministic test that ran and passed here), **device** (a person on a real Jeju bus with a signed build). Nothing in this document is device-verified.

## 1. Regressions found and fixed

| # | Finding (audit of `23d3cca`) | Fix | Test that pins it |
|---|---|---|---|
| R1 | **Hybrid ride in the background read nothing.** `reconcileRidePosition` returned when the scene was not active, while the poll loop kept calling it under `RideKeepAlive`; push is off for hybrid rides. Lock Screen / Dynamic Island froze until unlock while the keep-alive kept the location indicator and its battery cost. | The foreground check gates sampling only (`RideDeviceEvidencePolicy.maySample`); the background evaluates official progress with `device: nil`. | `HybridRideReconcileTests.testABackgroundRideStillReadsOfficialProgressWithoutSampling`, `LocationSamplingReleaseTests.testOnlyAForegroundRideSamples` |
| R2 | A fix taken in the foreground was re-retained after the scene went inactive mid-reconcile. | Retention decided after the awaits (`RideDeviceEvidencePolicy.retained`). | `testAFixFromBeforeTheSceneWentInactiveIsNotRetained`, `testRetainedFixFollowsForegroundPermissionAndOutcome` |
| R3 | An official read older than the engine's last strong evidence moved the association clock back, or read as `official_backward_conflict`. | Ignored as `official_stale_reordered` (fail closed, nothing advances). Verified failing first (6 assertion failures with the guard removed). | `HybridPositionEngineReleaseTests.testOlderEvidenceAfterNewerIsIgnoredAsAStaleReorderedRead` |
| R4 | A `lost` result still named a device-held stop, and the fallback named the very read the engine had refused, on the ride screen and in the Live Activity content. | `HybridRidePosition.officialStopSequence` / `usableStopSequence`; surfaces fall back to the accepted official stop or the boarding pole. | `testALostResultNamesOnlyTheAcceptedStopOnAnySurface`, `testARefusedReadAheadMovesNoSurface`, `testOnlyAUsableResultNamesItsStop`, `testALostResultNeverNamesARefusedReadAhead` |
| R5 | A window cancelled by the scene going inactive used up the 10–30 s spacing slot, so the return to the foreground had no device sample. | `LocationUnavailableReason.cancelled` releases its slot (`LocationSampleThrottle.release`); a window that ran and found nothing keeps it. | `testOnlyACancelledWindowGivesItsSlotBack`, `RideLocationSamplerTests.testStopMidWindowResumesExactlyOnceAndGivesTheSlotBack` |
| R6 | A cancelled reconcile waited out its location window (≤ 6 s) holding `readInFlight`. | The sampler window is stopped on cancellation. | none dedicated (needs a task seam in `TapsoAppModel`); the `stop()` path is covered by R5's sampler test |
| R7 | Nothing proved that sessions read through the active-ride path and `/v1/vehicles` through its 20 s cache: swapping the provider in `apiRuntime.ts` passed every test. | Test only. Mutation-checked: substituting the cached provider fails it. | `through the real wiring, /v1/vehicles is served by its 20 s cache and sessions read through the active-ride path` |
| R8 | Domain-quality FAILs (CA-5, issue #74) and swallowed migration blockers left CI and the evidence workflow green with no visible trace; `MATCHER_SAFETY_EVIDENCE_V4.md` still said `MISSING`. | `renderGateSummary` → `::warning` per FAIL criterion and a criterion table in the job summary; migration exit 5 annotated (exit codes unchanged); docs corrected to FAIL. | `the gate summary shows a CA-5 FAIL as a warning while the award stays READY_FOR_SHADOW (issue #74 visibility)` |

## 2. Results table

`AUTO` = deterministic test ran and passed on this branch. `DEVICE` = needs a rider (§3); none run. `PINNED` = current behaviour fixed by a test, not a policy endorsement.

| Area | Item | Automated | Device |
|---|---|---|---|
| Sampling window | per-mode window, early finish on good-enough fix, best acceptable fix at the deadline | AUTO (`LocationSamplingPolicyTests`, `testDocumentedThresholdsPerMode`) | DEVICE: real fix arrival times in a bus |
| | updates always stop: good fix, deadline, `stop()`, error, permission change; continuation resumed once; second call `busy` | AUTO (`RideLocationSamplerTests`, fake manager) | DEVICE: blue indicator off after each window |
| Accuracy filter | invalid / future / stale / too inaccurate rejected; 50 m and 10 s inclusive, 50.01 m and 10.01 s refused; policy ≤ engine limits | AUTO (`testBoundaryAccuracyAndAgeAreInclusive`, `testDeviceAcceptanceBoundsMatchTheSamplingPolicy`) | DEVICE: acceptance rate on Jeju buses (`MISSING`) |
| Spacing | one clock across ride modes; measured from window start; backward clock; cancelled window releases | AUTO (`LocationSamplingReleaseTests`) | — |
| Provider freeze | engine: stall → predicted (bounded) → lost; no time-only advance; fresh-flagged old evidence not strong | AUTO (`HybridPositionEngineTests`, `testFreshFlaggedButOldEvidenceIsNotStrong`) | DEVICE: case F6 |
| | server: a confirmed ride on identical rows stays `live`, observation `unchanged`, for 300 s | PINNED (`confirmedRideProgression.test.ts`). No freeze threshold invented; one needs device evidence | DEVICE: case F6 |
| Provider delay / order | implausible jump, reordered older read, backward official, out-of-order device sample, GPS jump all fail closed with named reasons | AUTO (`HybridPositionEngineReleaseTests`) | — |
| Active ride reads | single flight; < 5 s share; failure never stored; budget fallback ≤ 15 s inclusive with true receipt time; slow upstream coalesces, window from completion, waiters use no budget; variants and cities keyed apart | AUTO (`activeRideSnapshot.test.ts`) | `/health.activeRideReads.outcomes` during rides |
| Public vehicle cache | `/v1/vehicles` 20 s cache and `s-maxage=20` unchanged; never the active-ride path; sessions never the 20 s cache | AUTO (wiring test, R7) | — |
| Permission | denied / restricted / notDetermined never start updates, prompt only when requested; ride continues on official progress | AUTO (`RideLocationSamplerTests`) | DEVICE: F8, F9 |
| Reduced accuracy | before a window: never starts; mid-window: ends it; retained fix dropped | AUTO (`testReducedAccuracy*`, `testRetainedFixFollowsForegroundPermissionAndOutcome`) | DEVICE: Precise Location toggled in Settings mid-ride |
| Lock / return | background reads official, never samples, keeps no fix; return samples at once | AUTO (R1, R2, R5) | DEVICE: F7 |
| Relaunch | restore clears hybrid result and freshness; engine rebuilt | AUTO (existing `testHybridRestoreDoesNotMakeAnOldOfficialMilestoneFresh`) | DEVICE: F10 |
| Geometry | dense poles (< 50 m, 45 m fixes) never skip; loop variant fails closed; chord deviation on a curve → `route_deviation` | AUTO (synthetic geometry only) | DEVICE: F2, F3 |
| Opposite pole | inside the 1 km anchor radius, not flagged (documented limit); opposite-direction bus after boarding → `direction_conflict` | AUTO (pins the limit) | DEVICE: F8 |
| Destination | 2/1/0 never held by device evidence, including stalls at 1 and 0 | AUTO | DEVICE: F4 |
| Matcher #74 | `late_appearance_s_minus_1/2/3` all applied, judged and counted in CA-5 evidence; FAIL criteria annotated | AUTO (synthetic: 0 wrong on all three) | real bases: next gate-evidence run (§5) |

Run on this branch (2026-10-12, macOS, Xcode 26.3):

| Command | Result |
|---|---|
| `swift test --package-path packages/transit-core` | 310 tests, 0 failures (baseline `23d3cca`: 289) |
| `npm --prefix services/api test` | 962 / 962 pass after `npm install --prefix services/api --omit=optional` (as CI does). Without that install the one `web-push` test fails, on main as well (baseline 951 / 952) |
| `scripts/negative-controls/run.ts` on a quiet tree | 140 killed, 0 survived, baseline green, exit 0 |
| `xcodebuild … -destination 'platform=iOS Simulator,name=iPhone 16' build test` | TEST SUCCEEDED, 116 tests, 3 skipped (snapshot renders, skipped before too), 0 failures |
| `tsc` on `services/api/tsconfig.json` and `scripts/tsconfig.json` | exit 0 (TypeScript 5.9 / @types/node 22, the `apps/web` pins) |
| matcher artifact regeneration + `cmp` (counterfactual summary, redecide ledger, ground-truth sessions, rendered instants) | identical |
| `gate.ts --check` (committed suite + this run's negative controls) | `READY_FOR_SHADOW`, matches the committed result; prints `BA-3 FAIL`, `BA-4 FAIL` warnings |
| `check_localization.py`, `check_brand.py`, `sync_xcodeproj.py --check` | pass |

Not reproduced locally: `run-suite.ts` (its TAP count parsing needs CI's Node 22; local Node 24 prints no `# tests` lines). CI is the authority for it.

## 3. Real-device protocol (`DEVICE_REQUIRED`, not run)

**Why not run here.** This work ran on a Mac. The paired iPhone can be built to, but the scenarios need a person on a Jeju bus writing down stop announcements. No ride was taken; no row below has a device result.

**Build.** Debug, signed, from this branch or main after merge; launch argument `-tapsoHybridTracking`; `RideTrace` on (ride screen → diagnostics → share). Release builds show no trace and no demo data. Hybrid is never enabled through `TRANSIT_HYBRID_TRACKING_ENABLED` for these rides.

**Per ride, record.** Route, variant, boarding pole (name + direction marker), destination, confirmed masked plate; every stop announcement with wall-clock time (the Debug ground-truth mark if present, otherwise a written note); lifecycle actions (lock, unlock, relaunch) with times. Export the trace text and the hybrid diagnostic lines. Never commit raw coordinates.

| Case | Setup | Pass |
|---|---|---|
| F1 Straight segment | ≥ 5 stops on a straight arterial (e.g. 연삼로, 평화로 segment) | no stop passage shown before ground truth; device estimate never ahead of announcement |
| F2 Dense stops | downtown poles < 150 m apart (제주시청 – 중앙로 area) | no skipped stop, no double advance |
| F3 Curve / loop | a route with a sharp bend and a variant that loops back past a stop | `route_deviation` or `lost` allowed; any advance must follow ground truth |
| F4 Destination approach | 3 → 2 → 1 → 0 | 2/1/0 only from official evidence; zero false arrival |
| F5 Waiting at the pole | confirmed bus ≥ 2 km away | no `official_device_conflict`, no estimate (`boarding_needs_official`) |
| F6 Bus moving / provider freeze | note any period the count does not move while the bus does | record duration; compare with server observation `unchanged` |
| F7 Lock then return | lock for 2–5 min mid-ride with "앱을 닫아도 계속 알려 주기" on, then unlock | Live Activity keeps changing while locked (R1); on unlock, one fresh sample within the mode's window |
| F8 Opposite pole | stand at the opposite pole of the same stop name, then board correctly | note whether any warning appears (expected: none, a documented limit); after boarding the wrong-direction bus (only if safe and intended), `direction_conflict` |
| F9 Permissions | location denied; Precise Location off; toggled mid-ride in Settings | ride continues on official progress; approximate-location copy shown; no device evidence |
| F10 Relaunch | swipe the app away mid-ride, reopen | resumes as checking until a fresh official read; no old milestone shown as fresh |
| F11 Music + Dynamic Island | Apple Music or Spotify playing for the whole ride; open the expanded island for each | TAPSO compact/minimal readable (2-digit counts not clipped), expanded island content matches the ride screen |

**Release evidence.** ≥ 10 rides covering F1–F11, zero early stop passage and zero false early arrival (`compare-jeju-bis-position.ts --displayed/--reference`), trace exported per ride.

## 4. Battery and GPS measurement plan (`DEVICE_REQUIRED`)

| Measure | How | Compare | Decision it feeds |
|---|---|---|---|
| Energy impact per ride | Xcode → Devices → app → Energy (or Instruments Energy Log) over the ride; note foreground minutes and lock minutes | hybrid off vs on, same route and time band, ≥ 3 rides each | whether hybrid sampling is affordable |
| Battery % per hour | Settings → Battery per-app over a fixed 30 min ride segment | KeepAlive on vs off | keep-alive copy and default |
| Location-on time | count of sampling windows × window length from the hybrid diagnostic lines; blue indicator observation | expected ≤ 6 s per 10–30 s spacing | confirms bounded sampling |
| GPS acceptance | per-window outcome (`fix`, `noAcceptableFix`, `throttled`, `cancelled`, `background`) and `accuracy10m` bucket from diagnostics | per mode, per route type (F1–F3) | whether the 50 m / 10 s limits suit Jeju buses (today `ASSUMPTION`) |
| Upstream volume | `/health.activeRideReads.outcomes` and `providerHealth` before and after a ride | outcomes per poll | share window and budget (`ASSUMPTION`) |

Stop rule: any measured early passage or false arrival ends the series and is filed before more rides.

## 5. Release blockers

| # | Blocker | Owner / next action |
|---|---|---|
| B1 | No real-device ride evidence (§3, §4). Hybrid cannot be enabled for anyone. | Tester with a signed Debug build on a Jeju bus |
| B2 | CA-5 FAIL on real bases (issue #74, 23 `late_appearance_s_minus_2` wrong commits). After this branch the digest changed, so CA-5 reads `MISSING` until the next `matcher-evidence.yml` gate-evidence run, which also measures s-1 / s-3 on real bases. CA-6 / CA-7 fail on volume. Readiness `READY_FOR_SHADOW`; automatic matching stays refused. | Dispatch gate-evidence after merge; owner reviews s-1/s-3 real-base counts |
| B3 | A frozen TAGO feed on a confirmed ride stays `live` without a time bound (pinned, not endorsed). Choosing a threshold needs F6 evidence. | Owner decision after F6 |
| B4 | A reordered official read shows one poll of rechecking (`official_stale_reordered`) instead of re-issuing the held state. Late, never early; re-issuing is an owner choice. | Owner decision |
| B5 | `live.currentStopSequence` is still written before the engine judges a read; it now feeds no stop name, but it still feeds sampling mode and the Debug trace. | Owner decision (changes sampling inputs) |
| B6 | APNs not configured (free team): background updates exist only through the opt-in keep-alive. | Paid Apple account |
| B7 | Crosswalk: a person reviews the shipped table and taps through the official reservation page for sample poles, opposite-pole pairs included (V2 §11). | Person with a device |
| B8 | CI annotation noise: `gate.ts` now prints `BA-3 FAIL` / `BA-4 FAIL` warnings on every CI run, since those human-only criteria fail today. Honest, but loud. | Owner may scope warnings to the next level if preferred |

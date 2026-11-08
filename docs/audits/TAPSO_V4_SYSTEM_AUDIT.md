# TAPSO V4 system audit

Date: 2026-11-08 (Asia/Seoul). Base: `main` at `52fa468`. Branch: `claude/eloquent-volta-oef0a6`.

Reality labels: `VERIFIED` (seen in code and exercised by a test run in this audit), `OBSERVED` (seen in a committed artifact or a measurement taken here), `OFFICIAL_DATED`, `ESTIMATED`, `ASSUMED`, `UNKNOWN`, `CONFLICTED` (documents disagree with code or with each other), `UNAVAILABLE`.

Companion documents: [transit data](TAPSO_V4_TRANSIT_DATA_AUDIT.md), [UX](TAPSO_V4_UX_AUDIT.md), [implementation plan](../exec-plans/TAPSO_V4_IMPLEMENTATION.md), [accuracy protocol](../validation/TAPSO_V4_ACCURACY_PROTOCOL.md), [performance baseline](../validation/TAPSO_V4_PERFORMANCE_BASELINE.md).

## 1. What was inspected and how

| Item | Method | Result |
|---|---|---|
| Repository state | `git status`, `git log`, open PRs via GitHub | Clean tree on `main` `52fa468`; one open PR (#197, Vercel Git deploy budget, not touched) |
| API test suite | `npm --prefix services/api test` before any change | `VERIFIED` 988/988 pass, 37.7 s wall |
| API test suite after this branch | same | `VERIFIED` 1018/1018 pass, 36.5 s wall |
| API typecheck | `(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)` | `VERIFIED` clean |
| Localization / brand checks | `scripts/ios/check_localization.py`, `check_brand.py` | `VERIFIED` both pass (ko, en, zh-Hans, ja; 561 keys used) |
| Swift core and iOS app | Code read (93 Swift files, 19,816 lines) | Not compiled here: this Linux container has no Swift toolchain. Swift changes are verified only by CI jobs `transit-core` and `ios` (`UNAVAILABLE` locally) |
| Live TAGO / Jeju BIS | — | `UNAVAILABLE`: no provider key in this session, and earlier sessions recorded egress to `bus.jeju.go.kr` and `data.go.kr` as denied (`docs/DATA_SOURCES.md`). No new live observation was taken |
| Physical device, APNs | — | `UNAVAILABLE` (no signed build, no Apple team credentials). Unchanged from the release gates |

## 2. Findings

Severity: **S0** wrong guidance that can strand or mislead a rider; **S1** wrong or unlabelled state with a fallback; **S2** degraded quality or maintainability; **S3** hygiene.

### F-01 (S1) Late-night trips vanish after midnight in the timetable reader — FIXED on this branch (server)

- Files: `services/api/src/officialTimetable.ts` (`routeTimetableView`), `services/api/src/apiRouter.ts` (`/v1/timetables` uses `koreanDate(now)`).
- Evidence (`VERIFIED`, test `nightGuard.test.ts` "baseline: the date-only reader…"): a synthetic weekday table with a 24:10 departure, read at Saturday 00:05, yields `today: []` and `applicability: does_not_apply`. Friday's service day is never consulted after midnight.
- Passenger impact: the last trips of a Friday-night table are invisible at 00:05, exactly when a rider is deciding whether to wait. `OBSERVED`: today no stated-day-type service in the 2026-10-03 bundle crosses midnight (0 of 388), so the defect is latent; every late-night route (3001–3008, 5001–5006) is `unstated` and is never called "today" anyway.
- Remediation: new `nightGuardView` reads both the current and the previous service day before 06:00 and labels each entry with its `serviceDate`; exposed as `GET /v1/night-guard`.
- Verification: 19 NightGuard tests, including midnight, last-trip-started, drop-after-06:00, holiday, stale, conflict, unstated, not-in-effect, duplicate tables and timepoint columns.

### F-02 (S1) Timetable bundle ages out on 2027-01-01 — OPEN (operations)

- Files: `services/api/data/jeju-timetables.json` (`retrievedOn: 2026-10-03`), `officialTimetable.ts` (`TIMETABLE_FRESH_DAYS = 30`, `TIMETABLE_USABLE_DAYS = 90`, both `ASSUMED`).
- Evidence (`VERIFIED`, test "real bundle: on 2027-01-01 every table turns stale…"): today (36 days) the bundle is `aging`; from 2027-01-02 every route answers `unknown`. The weekly `jeju-timetables.yml` refresh opens a PR to its topic branch, but no refreshed bundle has reached `main` since 2026-10-03 (`OBSERVED` from the committed file).
- Passenger impact: in 55 days every "today" first/last-bus answer disappears at once.
- Remediation: owner merges a refreshed import PR (or dispatches `jeju-timetables.yml`) before 2026-12-31. Proposed (not implemented): a release-gate warning when the bundle is older than 60 days.

### F-03 (S1) Most official timetables cannot answer "tonight" — OPEN (data limitation)

- Evidence (`OBSERVED`, measured with `nightGuardView` over the real bundle, see performance baseline §3): on Monday 2026-11-09 21:30 only **15 of 256** timetable route numbers get a day-qualified answer; 341 service entries are `day_type_unstated` and 59 are withheld `source_conflict`.
- Passenger impact: TAPSO can rarely say "the last bus has left" from the timetable. This is correct behaviour (an unlabelled table may not run today) but the product must not imply coverage it lacks.
- Remediation: keep `unknown`; show the table's own published last departure as a dated table fact, never as tonight's last bus (NightGuard already separates `last` from `status`). Long-term: obtain day types from an authorised source; do not guess them.

### F-04 (S1) An estimated position could hide the offline and lost warnings — FIXED on this branch (Swift core, CI-verified only)

- File: `packages/transit-core/Sources/TapsoTransit/RideGuidance.swift` (`RideGuidancePolicy.moment`).
- Evidence (`VERIFIED` by reading): the `isEstimated` branch returned before `isOffline` and `.vehicleTemporarilyLost` were checked, so an offline phone with a fresh-looking estimate showed a riding count.
- Remediation: offline and lost now outrank an estimate. Test `testAnEstimatedPositionNeverHidesOfflineOrALostBus`. Compiled and run only in CI (`UNAVAILABLE` locally).

### F-05 (S1) Boarding-first arrivals load once and never age — OPEN

- Files: `apps/ios/TapsoApp/TapsoAppModel.swift` (`loadTripArrivals`, ~876, 954–981), `BoardingFirstViews.swift` (303–322).
- Evidence (`VERIFIED` by reading): one load, refreshed only by pull-to-refresh; no as-of time; count 0 renders "곧 도착" in mint; note says "버스 위치는 실시간이에요".
- Impact: a bus that left minutes ago can read as "arriving soon, live".
- Remediation: timestamp each result, show its age, grey after 60 s, poll with `.task` while visible. Planned for PR 4 (needs simulator verification).

### F-06 (S2) No official disruption feed — OPEN; schema added

- Evidence (`VERIFIED`): no notice ingestion in `services/api/src`; `journeySafety.ts` has a `disruption` input nothing feeds. Three "suspension notice" timetable entries (369, 1112, 1113) are a census by-product without effective periods.
- Remediation on this branch: `OfficialNotice` schema in `transitEvidence.ts` with mandatory expiry, https source, reviewer; `assessOperatingEvidence` never infers cancellation from missing live data. No notice data is ingested yet (no verified machine-readable official source; `UNKNOWN`).

### F-07 (S2) Stop-level arrival predictions are not used — OPEN (blocked on authorisation)

- Evidence (`VERIFIED`): TAGO `ArvlInfoInqireService` (dataset 15098530) appears only in a docs probe; `PRODUCT_V3_JEJU_NATIVE.md:154–157` records it as awaiting the owner's data.go.kr authorisation. Jeju coverage and its timestamp semantics are `UNKNOWN`.
- Consequence: no ETA model is built (spec §2.5 requires source quality first). TAPSO keeps showing remaining stops.

### F-08 (S2) Matcher readiness stays `READY_FOR_SHADOW` — unchanged

- Evidence (`OBSERVED`, `artifacts/matcher-passive-safety-v4/gate-result.json`, 2026-10-01): SH-1…SH-6 pass; CA-1…CA-7, BA-1, BA-2, BA-5, AM-1 missing; BA-3, BA-4 fail. Issue #74 (late appearance, 23 wrong commits on one perturbed family) is open by decision. Automatic matching remains off; the passenger-confirmation fallback is preserved. No matcher code was changed on this branch.
- `CONFLICTED`: the committed artifact shows CA-5 `MISSING`, while `MATCHER_SAFETY_EVIDENCE_V4.md:338` reports a later CA-5 `FAIL` (run 36871560482). Live evidence is not committed, so the artifact is stale.

### F-09 (S2) Documentation drift — OPEN

`CONFLICTED` items found:
1. `RIDE_3001_FALSE_DELAY_2026-10-04.md` header says the fix is on a topic branch; it is on `main` (`confirmedRideProgression.ts` used at `journeySession.ts:1093–1095`). Its step 2 describes the old 20 s cache; sessions now read through `ActiveRideSnapshotProvider` (5 s share, `apiRuntime.ts:90–97`).
2. `LIVE_JOURNEY_V3.md`: "tracking means fresh cadence" and "one uncached TAGO request per read" are both outdated.
3. `KNOWN_ISSUES.md:37,49`: sessions "uncached" and "not live today" contradict `:46` (production sessions since 2026-10-03).
4. `JEJU_SAFETY_LAYER_V3.md`: timetables "not imported"; they are imported and served.
5. `ops/matcher-evidence/human-only-mitigations.json`: "the iOS app runs the deterministic demo only" contradicts live sessions in production.

Remediation: correct each in a documentation-only PR (planned PR 5).

### F-10 (S2) Receipt time vs observation time — mostly correct

- `VERIFIED`: TAGO rows set `observedAt = epoch`, `timestampSource: "unavailable"` (`tagoProvider.ts:229–240`); session views publish `evidenceAtIs: "tapso_server_receipt"`; `/v1/vehicles` publishes `providerObservationTimestamp: "unavailable"`.
- Residual (`ASSUMED` risk): the Live Activity `updatedAt` is the receipt time and drives `staleDate`; `HybridPositionEngine.swift:213–221` gates on receipt age ≤ 30 s, which understates true age by the unmeasured provider lag. Not a mislabel, but the comment should say so.
- New code on this branch never copies receipt time into `observedAt` (test "its receipt is never its observation time").

### F-11 (S3) Provider cost of scheduled jobs — OBSERVED

`matcher-evidence.yml` runs on seven weekly crons and polls TAGO (≤ 1,080 calls per window direct, ~900 via the public API, per `MATCHER_SAFETY_EVIDENCE_V4.md:304–312`). TAGO's daily quota for the key is `UNKNOWN`. No change made.

## 3. What was implemented on this branch

| Change | Files | Evidence |
|---|---|---|
| NightGuard: timetable read for an instant across midnight, never "operating" | `services/api/src/nightGuard.ts`, `test/nightGuard.test.ts` | 19 tests pass |
| Transit Evidence Engine layer 1: schedule + live + notices, conservative, receipt ≠ observation, absence ≠ cancellation | `services/api/src/transitEvidence.ts`, `test/transitEvidence.test.ts` | 10 tests pass |
| `GET /v1/night-guard` with cache bounded by the next status change | `services/api/src/apiRouter.ts`, `services/api/api/v1/night-guard.ts`, `services/api/vercel.json`, `test/staticData.test.ts` | 1 test; full suite 1018/1018 |
| Offline/lost outrank an estimated position | `RideGuidance.swift`, `RideBoardingRegressionTests.swift` | CI only |
| Docs | `docs/PRODUCTION_TRANSIT_API.md`, `README.md`, the six V4 documents | — |

## 4. Known safety limitations (unchanged by this work)

- No real-device validation; no APNs; simulator results are not device results.
- TAGO has no observation timestamp; automatic matching stays withheld.
- Timetables are `OFFICIAL_DATED` imports; 30 of 235 contradict themselves and are withheld; most have no day type.
- `transitEvidence.ts` is not yet wired into a passenger-facing endpoint: a route variant ↔ timetable direction crosswalk does not exist, and joining live vehicles to the wrong table direction would be worse than not joining.
- No claim about TAPSO's accuracy relative to KakaoMap or NAVER Map is made or supported.

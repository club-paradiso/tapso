# ExecPlan: TAPSO V4 — evidence, NightGuard, trust-centred UX

Format: `.agent/PLANS.md`. Living document; update as work lands.

## 1. Outcome and non-goals

Outcome: TAPSO never tells a rider more than its evidence supports — at night especially — and the rider's next action stays obvious in degraded states.

Non-goals: automatic vehicle identification (gate not met); ETA predictions (no authorised source); scraping competitors or undocumented Jeju BIS endpoints; new paid infrastructure.

## 2. Constraints (labelled)

- TAGO rows have no observation time (`VERIFIED` 2026-09-11).
- Jeju timetables are `OFFICIAL_DATED` imports, 85 % without a day type, 30 of 235 self-contradictory (`OBSERVED` 2026-10-03).
- Timetable freshness bounds 30 / 90 days are `ASSUMED`; the 2026-11-05 bundle goes stale after 2027-02-03 (the 2026-10-03 bundle it replaced would have gone stale on 2027-01-02).
- No Swift toolchain in the agent container: Swift changes are verified only in CI (`UNAVAILABLE` locally).
- No device, no APNs (`BLOCKED_BY_APPLE_ACCOUNT`, `BLOCKED_BY_PHYSICAL_DEVICE`).

## 3. Milestones

| PR | Scope | Completion criterion | Status |
|---|---|---|---|
| #199 (1 + 2 combined) | Evidence engine layer 1 (`transitEvidence.ts`), NightGuard (`nightGuard.ts`, `GET /v1/night-guard`), offline/lost outrank estimate (Swift core), six V4 documents | API suite green, typecheck clean, CI green incl. `transit-core` and `ios` | Merged 2026-11-09 |
| #201 (3a) | Route-number operating status, live feed quality, arrival contract + probe, live observation, first-bus check | API suite green; bounded live observations committed | Merged 2026-11-09 (with two Codex fixes: evaluation after live reads; unresolved directions stay uncertain) |
| #202 | Timetable bundle 2026-11-05 | Gate `--check` exit 0; tests follow the bundle date | Merged 2026-11-09 |
| #200 (4a) | U-02, U-03/04/05, U-06, U-08, U-11, NightGuard card | CI `ios` and `transit-core` green | Merged 2026-11-09 (with four Codex fixes: freshness policy moved to core, NightGuard refresh loop, next-day display against the answer's date, trip reads superseded by screen) |
| #203 | TAGO HTTP 429 → `PROVIDER_RATE_LIMITED`; at most 4 concurrent TAGO requests per instance | Tests first; API green | Merged 2026-11-09 |
| #204 | Catalog `c9eacac26d848f6a` (791/785 stop sequences); weekly refresh fails loudly when it cannot propose a PR | Gate and crosswalk `--check` exit 0 | Merged 2026-11-09 |
| #205, #207 | Arrival probe samples running buses; reports prediction-minus-position offsets | Live runs with the key | Merged 2026-11-09 |
| #206 | `main-history-policy` waits for GitHub's merge-commit ↔ PR link | Passed on the next main push | Merged 2026-11-09 |
| 3b | Matching: real-base replay for Issue #74 families; reviewed variant ↔ timetable crosswalk; no policy change without counterfactual evidence | Gate re-run with committed result | Not started: the real-base replay needs the vault raw streams, and the crosswalk needs a human review (0/389 name matches) |
| 4 (rest) | U-09; NightGuard card in the return screen; snapshot evidence in ko/en at default and AX5; VoiceOver checklist | Snapshots committed from macOS CI | U-09 merged (#209). NightGuard on the return screen on `claude/eloquent-volta-oef0a6`: its own block above the last-bus rows, no longer waiting for the timetable download. Snapshot evidence at AX5 and the VoiceOver checklist not started |
| 5 | Docs drift (system audit F-09); timetable-age release-gate warning; performance follow-ups | Docs match code; gate warns at > 60 days | In progress: age warning and this plan (this branch); docs drift and performance not started |

PR 1 and PR 2 were combined: NightGuard is the first consumer of the evidence types, and splitting would have shipped an unused module.

## 4. Decisions

- **Previous service day until 06:00.** Tables never exceed 29:59 (`officialTimetable.ts` TIME); 06:00 bounds the read and keeps an early-morning service from being confused with last night's. Alternative (always read both days) rejected: noisier output for no gain.
- **Trip start by default, timepoint only by exact unique name.** Fuzzy stop-name matching would amount to inventing stop-level times. Alternative (interpolate between timepoints) is forbidden by the spec.
- **Unstated day type ⇒ `unknown` with the table's `last` as a fact.** Hiding the table entirely loses information; calling it "tonight" would be a guess.
- **Conditional trips ⇒ `uncertain`.** A winter-only last bus cannot be resolved without verified season rules.
- **Cache bounded by `validUntil`.** A shared cache may never serve a status past the minute it changes; at most 60 s.
- **Evidence engine exposed at route-number scope only** (`GET /v1/operating-status`, #201). Joining live vehicles to timetable directions still needs a crosswalk (PR 3b); a direction-level join without it could attach a vehicle to the wrong direction.
- **No confidence percentages.** Claims are categorical with reasons.

## 5. Reproduction

```bash
npm --prefix services/api install --omit=optional
npm --prefix services/api test
node --experimental-strip-types --test services/api/test/nightGuard.test.ts services/api/test/transitEvidence.test.ts
(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
swift test --package-path packages/transit-core   # macOS / CI only
```

## 6. Progress log

- 2026-11-08: baseline 988/988 API tests (37.7 s). Implemented NightGuard, evidence layer, endpoint, Swift fix; 1018/1018 (36.5 s). Figma read-only check: no NightGuard frame; return rows designed only in the populated state.
- 2026-11-08 (later): live observation (552 reads, 0 failures) found and fixed a false-positive feed-quality rule. 0/389 timetable services match catalog names, so the crosswalk is not automatable. The arrival probe needed the repository key and then activation of dataset 15098530 on it (owner did both).
- 2026-11-09 05:44–06:59 KST: first-bus check (`docs/validation/TAPSO_V4_FIRST_BUS_CHECK_2026-11-09.md`). 12 of 13 first-hour departures on 365/785 matched; the 365 06:00 한라대 trip row was not seen and contradicts the same file's summary (`CONFLICTED`). It also surfaced two production defects, both now fixed: the stale stop catalog (791 sequences off by 7) and TAGO HTTP 429 shown as 502.
- 2026-11-09: #199–#207 merged; main CI green on every merge commit. Codex review found 7 real defects across #200, #201 and #205; all fixed with failing tests first.
- 2026-11-09: arrival service vs position feed, two live runs (`OBSERVED`, 34 comparisons): 22 exact, 12 off by +1 stop, none by −1. The arrival service sometimes lags the position feed by a stop.
- 2026-11-09: weekly catalog refreshes had silently failed to open PRs since 2026-10-11 (Actions may not create PRs); the run now fails instead.
- 2026-11-09: NightGuard on the return screen. Found while reading: NightGuard was drawn only inside the timetable card's loaded branch, so a slow or failed timetable download hid tonight's answer on both the return and the route screens; and on the return screen it sat above "돌아갈 때 막차" rows that TAGO usually cannot fill. Tests written first (`ReturnScreenLayoutTests`, `NightGuardTests.testLinesAreShownOnlyWhileTheAnswerIsCurrent`); Swift is checked only in CI.
- 2026-11-09: U-09. The source guard was written first and failed with 9 errors on main (home 8 mint uses, live badge, live entry, resume notice, comfortable last bus). The test was a Python source check, not an XCTest: colour placement is a property of view source, and it runs without macOS. After the change it passes; Swift build verified only in CI.

- 2026-11-10: cleanup. Removed Swift code the app never used: `JourneyStateMachine` (its transition tests moved onto `RideSession`, the path the app uses), the Swift Journey Contract and Transfer Guardian (server specification kept, no endpoint uses either), `TrustBadge` (U-13; its 7 strings stay only as the website preview's copy source), `TransitSnapshot`, `AdaptiveStack`, `TrailingIconLabelStyle`, and unused `RideSession` members. 18 finished or superseded docs moved to `docs/archive/`; `docs/CURRENT_STATE.md` is the new entry point.

## 7. Risks and next action

- Risk: the timetable bundle (2026-11-05) goes stale after 2027-02-03 → every NightGuard entry `unknown`. The release gate now warns after 2027-01-04 and errors once stale. Next action: dispatch `jeju-timetables.yml` before then.
- Risk: the weekly catalog refresh fails red until the owner enables "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General).
- Risk: TAGO's burst limit is unknown; 4 concurrent requests per instance is `ASSUMED`. Next action: read production function logs (blocked from the agent environment: Vercel connector 403).
- Risk: release gate 3 reads `PENDING_EVIDENCE` until 순환버스 (22:00–23:40 KST) is probed against catalog `c9eacac26d848f6a`. Scheduled for 2026-11-09 22:05 KST.
- Risk: the 365 06:00 한라대 trip row may not run; NightGuard reads trip rows and says 06:00. Next action: repeat the first-bus check on two more weekdays before changing any rule.
- Risk: two crosswalk poles (`JEB405002827`, `JEB406002166`) are withheld as `direction_mismatch` until BIS station evidence is collected again.
- Decision for the owner: the app-wide control tint (`TapsoRootView` `.tint(mintDeep)`, primary buttons) is still mint, so buttons read as "live" too. U-09 left it as is; 13 of the 25 remaining mint uses are controls on that tint; the other 12 mark observed data.
- Exact next action: snapshot evidence in ko/en at default and AX5 for the return screen and NightGuard, then the VoiceOver checklist.

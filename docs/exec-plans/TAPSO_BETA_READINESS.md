# ExecPlan: TAPSO beta readiness (journey contract, languages, iOS design, field-test infrastructure)

Started 2026-10-20 from `main` at `67c344f` (PR #144). Branch `claude/tapso-ios-beta-readiness-pt25eg`, PR #146.
Design direction approved by the owner on 2026-10-20 ("너가 판단해서 작업해줘" after the Phase 0 report).

Reality labels used here: `CODE_IMPLEMENTED`, `UNIT_VERIFIED` (a test in this repository passes), `SIMULATOR_VERIFIED`,
`DEVICE_VERIFIED`, `PRODUCTION_VERIFIED`, `NOT_TESTED`, `BLOCKED`, `FAILED`.

## 1. Outcome and non-goals

**Outcome.** A tester at a Jeju stop can choose where to get off, confirm the physical bus, and trust what the
app, Lock Screen and Dynamic Island say at every moment: waiting, riding, two stops, next stop, arrival,
and every degraded state. They can do it in Korean, English, Simplified Chinese or Japanese. When something
goes wrong they can report it from the app and get a receipt.

**Non-goals.**
- Automatic bus matching. Readiness stays `READY_FOR_SHADOW`; issue #74 (CA-5 on real bases) stays open.
- Background location as a workaround for missing APNs.
- Payments, accounts, analytics SDKs.
- Redesigning the marketing site. It only takes the revised app copy verbatim.
- Declaring `READY_FOR_TESTFLIGHT_BETA` without a paid team, APNs and device evidence.

## 2. Verified constraints (2026-10-20)

| Fact | Label | Evidence |
|---|---|---|
| main `67c344f`; one open PR (#145); one open issue (#74) | PRODUCTION_VERIFIED | GitHub API |
| #145 overwrote `TapsoAppModel.swift`/`HomeView.swift` with versions older than #138–#144 (drops `rideLength`, `RideReadScheduler`, out-of-order rejection, stale ageing, trip budget, `TAPSO_FIELD_TOOLS`), references the missing `TripArrival.soonestFirst`, and fails `ios` (project out of sync) and `api` (gate 2) | FAILED | `git diff main...origin/feat/tourist-i18n`; CI run 39350692568 |
| Release gates on main: 1, 2, 3, 6 PASS; 4, 5 BLOCKED; 7 PENDING_EVIDENCE | UNIT_VERIFIED | `node --experimental-strip-types scripts/release-gates/jeju-v1.ts --check` |
| Post-deploy smoke (API and session lifecycle) passed 2026-10-19 06:20 UTC; failed 2026-10-17 | PRODUCTION_VERIFIED | `post-deploy.yml` runs 39209339982, 39007281838 |
| The Railway collector logs `live_activity_ticker outcome=push_unavailable`; last successful deploy 2026-10-13 (#142) | PRODUCTION_VERIFIED | Railway logs, `tapso-ride-collector` / `collector` |
| APNs is off in production; the app has no `aps-environment` entitlement | BLOCKED | `/health` per docs; `apps/ios/TapsoApp/Tapso.entitlements` |
| Apple team is the free Personal Team `89CGFQ24U5` (last checked 2026-08-21) | BLOCKED | `docs/TESTFLIGHT.md`; `apps/ios/project.yml` |
| No `artifacts/device-validation/` | NOT_TESTED | repository |
| This container cannot reach `*.vercel.app` (proxy 403) and has no Swift/Xcode; iOS and Swift checks run in CI only | — | session |

## 3. Milestones

| # | Milestone | Status | Completion evidence |
|---|---|---|---|
| A | Waiting is a first-class journey state on every surface; `rideLength` is mandatory on Live Activity paths | CODE_IMPLEMENTED, UNIT_VERIFIED (transit-core in CI) | `RideBoardingRegressionTests`, `RidePresentationTests.testWaitingIsOneDecisionOnEverySurface` |
| B | Server push planner shares the boarding-aware decision; parity fixture covers before-boarding | UNIT_VERIFIED | `liveActivityContent.ts` `boardingAwareGuidance`; `fixtures/journey/live-activity-signals-v1.json` (`short-ride-before-boarding`) |
| C | Journey language (ko/en/zh-Hans/ja), carried by session and activity; server alerts localized | CODE_IMPLEMENTED; device behaviour NOT_TESTED | `JourneyLanguageTests`, `liveActivityContent.test.ts` |
| D | Session ids no longer in logs; session input bounded; pilot ride budget | UNIT_VERIFIED | `apiRouter.test.ts` (log redaction, budget, validation) |
| E | zh-Hans/ja localizations (machine-translated); four-language localization check | UNIT_VERIFIED (static) | `scripts/ios/check_localization.py` |
| F | Basalt palette, Pretendard (app only), stop rail with waiting zone and stop beads | CODE_IMPLEMENTED; SIMULATOR evidence pending CI | `docs/beta/DESIGN_DIRECTION.md` |
| G | Korean copy pass (humanize-korean method) | UNIT_VERIFIED (static) | 48 of 541 values changed, 1.8% change rate, self-check 6/6 |
| H | Beta feedback with server receipt | UNIT_VERIFIED (server); app NOT_TESTED on device | `services/api/test/feedback.test.ts` |
| I | Tourist stop guides re-landed, checked against the catalog; foreign-language spot search | UNIT_VERIFIED (CI) | `TouristStopGuidesTests` |
| J | Beta documentation: human actions, release decision, device protocol, operations | Done in repository | `docs/beta/` |
| K | Physical-device acceptance | BLOCKED (hardware, Apple account) | `docs/DEVICE_TEST_PLAN.md` §Beta field protocol |
| L | APNs end to end | BLOCKED (paid team, .p8 key) | `docs/beta/HUMAN_ACTION_REQUIRED.md` |

## 4. Decisions

1. **#145 is superseded, not merged.** Merging it would remove reliability fixes. Its additive parts are re-landed
   on main: the stop guides, checked against the catalog. Its in-code string table is replaced by real
   `.lproj` files, and its `UserDefaults` language store by the journey language.
2. **Waiting is data, not a copy key.** `RideGuidance.stopsBeforeBoarding` is set whenever the bus has not
   reached the boarding stop, including in degraded moments. Surfaces show that number, never the
   bus-to-destination count.
3. **The journey language is fixed at ride start** from `Bundle.main.preferredLocalizations`. It is sent with
   the session, which carries no other personal data, and put in the activity attributes; the widget renders
   with `.environment(\.locale, …)`. Alternative rejected: an App Group preference read by the extension.
   It adds a shared mutable store and still would not reach the server's alerts.
4. **Pretendard is bundled unmodified.** Its OFL 1.1 licence reserves the font name, so subsetting would
   require renaming. It is in the app target only; the extensions keep the system font until a device
   confirms memory headroom.
5. **Feedback is kept only where it survives.** That means Redis; Vercel without Redis answers 503. The app
   says "sent" only on 201.
6. **Ride budget defaults to 30 new sessions a minute per deployment.** That is far above a pilot of tens of
   riders, and it caps creation at 60 TAGO reads a minute. Over budget the server answers 429; the app
   already retries.
7. **Kept as is: session id as a bearer capability.** Logs now carry `sessionRef`, a one-way hash. A separate
   write token for mutations is recorded as P2.

## 5. Reproduction

```bash
swift test --package-path packages/transit-core          # CI (macos-15); not available in a Linux container
npm --prefix services/api install --omit=optional && npm --prefix services/api test
python3 -m unittest discover -s scripts/tago -p 'test_*.py'
python3 -m unittest discover -s scripts/timetables -p 'test_*.py'
python3 scripts/ios/check_localization.py
python3 scripts/ios/check_brand.py
python3 scripts/ios/sync_xcodeproj.py --check
npm --prefix apps/web test && npm --prefix apps/web run typecheck:vercel && npm --prefix apps/web run build
(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
node --experimental-strip-types scripts/release-gates/jeju-v1.ts --check
node --experimental-strip-types scripts/journey/session-views.ts --check
node --experimental-strip-types scripts/journey/live-activity-signals.ts --check
```

## 6. Progress, findings, risks, next action

- 2026-10-20: Phase 0 audit and design proposal. Owner approval. Milestones A–J committed on PR #146.
- 2026-10-20: review pass on the Swift diff. Fixed: an ended ride or hidden count read as waiting; the estimated eyebrow was lost while waiting; Live Activity code-built strings ignored the journey language; the waiting unit lost "last seen"; feedback limits counted characters, not code points (`c4d48e3`).
- Finding: the macOS runners for this repository queued for about 20 minutes per job; at most one ran at a time.
- Evidence: CI run 39362474415 on `0d356af` (milestone A) passed every job, including `ios`: build and XCTest on the iOS 26.2 iPhone 17 Pro simulator, snapshot evidence rendered, and `transit-core` with `RideBoardingRegressionTests` (SIMULATOR_VERIFIED for the waiting state and `testWaitingIsOneDecisionOnEverySurface`).
- Incident: `7d35bc8` added `Shared/JourneyLanguage+Bundle.swift`. `sync_xcodeproj.py` wrote its path unquoted, which made the project unreadable to `xcodebuild`, so the iOS jobs of the following commits failed before compiling. Fixed in `6105a7b`: the file was renamed, `-` paths were quoted, and the script now quotes names it cannot write bare.
- Evidence: CI run 39387008884 on `c547cf5` (all milestones plus review fixes) passed `ios` (build, XCTest, snapshots in ko/en/zh-Hans/ja), `transit-core`, `api`, `web` and `matcher-evidence`.
- Finding: `AGENTS.md` said the transit API ships no dependencies. It depends on `web-push` 3.6.7, and the
  local test suite needs `npm install` first.
- Risks:
  - The Lock Screen's locale override (`.environment(\.locale)`) applies only to `Text(LocalizedStringKey)`.
    Strings built in code (detail line, VoiceOver labels) now read the journey language's `.lproj` through
    `RideText.string(_:language:)` (`testLiveActivityStringsFollowTheJourneyLanguage`). Whether the widget
    extension bundles every `.lproj` on a device is still device-only verification.
  - Machine-translated zh/ja copy needs native review before external testing.
- 2026-10-20: #146 merged (`10a39dc`); post-deploy smoke on that commit passed 19/19 and the session lifecycle 8/8
  (run 39394592084). Owner closed #145 and chose a free-team pilot before paid enrollment. Added the **Tapso Beta**
  scheme, a CI build of the Beta configuration for a device (it was never compiled before), a write-free feedback
  probe in the production smoke, `docs/beta/FREE_TEAM_FIELD_TEST.md` and the evidence template.
- **Next action:** the owner runs the free-team pilot (`docs/beta/FREE_TEAM_FIELD_TEST.md`); Claude turns reported
  results into sanitized evidence files and fixes what they find.

# UX audit before Product V2

Audited on 2026-09-30 against `main` at `d94b5fd`: the SwiftUI app (`apps/ios/TapsoApp`), the Live Activity extension (`apps/ios/LiveActivity`), the shared policy (`apps/ios/Shared`), the Swift core (`packages/transit-core`) and the Figma file `kkx04GvqOzHje7Dw5ikO9X` (`04 iOS` workbench, node `11:2`; on `13 Archive` since 2026-10-01). Every finding cites the code or node it comes from. The status column says what Product V2 did about it; `FIXED` means the fix is in this branch and covered by the named test or evidence.

Severity: **P0** misleads the rider about getting off, or contradicts the product's safety posture. **P1** breaks the core promise (configure once, trust, put the phone away) or blocks a main flow. **P2** polish, consistency, maintainability.

## P0

| # | Finding | Evidence | Status |
|---|---|---|---|
| P0-1 | **A passed destination was shown and alerted as an arrival.** `RideSession.state(for:)` maps `DestinationProgressPhase.passedDestination` to `.arrived` and `remainingStops` is clamped to `0`, so the old `TapsoLiveActivityPolicy` produced the arrival milestone: "목적지에 도착했어요 · 지금 버스에서 내리세요" for a bus already beyond the stop. | `packages/transit-core/Sources/TapsoTransit/JourneyStateMachine.swift` (`case .arrived, .passedDestination: return .arrived`); old `Shared/TapsoLiveActivityPolicy.swift` `(.arrived, 0) → .arrived` | `FIXED`: `RideSignal.destinationPassed` (read from the session's progress phase) yields `RideMoment.passedDestination`, which has no milestone, an attention haptic and a recovery action. Core state machine untouched. Tests: `RideGuidanceTests.testPassedDestinationIsItsOwnMomentNotAnArrival`, `RideSetupTests.testPassedScriptEndsInPassedDestinationWithoutArrivalAlert`, `RidePresentationTests.testContentStateCarriesTheSameGuidanceAsTheApp` |
| P0-2 | **The demo selected the bus without the rider.** `startDemo()` took the Swift engine's `high` result and went straight to an active ride. Real sessions run in shadow mode: automatic selection is refused below `READY_FOR_BOUNDED_AUTOMATION` and only a rider's confirmation selects a vehicle. The demo taught the opposite of the product. | old `TapsoAppModel.startDemo`; `docs/ARCHITECTURE.md` › Runtime strategy; `services/api/src/matchingReadiness.ts` | `FIXED`: the engine's pick is a *proposal*; the ride starts only from `confirmVehicle`. Test: `RidePresentationTests.testSampleRideProposesAndWaitsForTheRidersConfirmation` |

## P1

| # | Finding | Evidence | Status |
|---|---|---|---|
| P1-1 | No way to say where you get off, which bus, or where you board; the app was one demo button. Roadmap item 4 was `OPEN`. | old `HomeView`; `docs/ROADMAP.md` item 4 | `FIXED` on synthetic data: destination search → route (only when two directions reach it) → boarding stop → vehicle check. See `INFORMATION_ARCHITECTURE_V2.md` |
| P1-2 | No repeat path: every ride from scratch. | old `HomeView` | `FIXED`: on-device `JourneyLibrary` (recents, favourites, recent destinations); Home "다시 타기" reaches the vehicle check in one tap; App Shortcut "탑서로 다시 타기". Tests: `RideSetupTests` library cases, `RidePresentationTests.testConfirmedRideWalksToArrivalAndIsRememberedForOneTapRepeat` |
| P1-3 | Trust strip merged the wrong signals: "다이나믹 아일랜드 연결됨" beside "차량 매칭 신뢰 높음/보통/확인 필요". Island connectivity is not a rider trust signal, data freshness was missing in the app, and "신뢰 높음" implies a validated confidence the product does not have. | old `ActiveJourneyView.activityStatus`, `matchTrustValue` | `FIXED`: two separate badges, vehicle identity (확인됨 / 확인 중 / 찾는 중) and data (실시간 / 업데이트 지연 / 오프라인 / 연결 확인 중); no confidence wording or percentage. Test: `RideGuidanceTests.testVehicleIdentityAndDataFreshnessAreSeparateSignals`, `RidePresentationTests.testCopyNeverShowsEngineeringLanguage` |
| P1-4 | Degraded states were collapsed: a lost vehicle showed the same "데이터 지연" as stale data; offline did not exist; nothing said whether tracking continued. | old `TapsoLiveActivityPolicy.displayPhase` (`vehicleTemporarilyLost → .delayed`) | `FIXED`: `delayed`, `vehicleLost`, `offline`, `checking` are distinct moments, each saying what happened, that tracking continues, and what to do; none alerts or buzzes |
| P1-5 | Two, one and zero stops were one layout with a different number and tint. | old `ActiveJourneyView.remainingPanel` | `FIXED`: four hero layouts (riding count, amber "2정거장 남았어요", coral "다음에 내려요" + destination + stop button, tangerine "여기서 내려요" + one button) |
| P1-6 | Relaunch lost the ride; a still-running Live Activity was reattached while the app showed Home. | old `TapsoAppModel` (in-memory session), `LiveActivityClient.init` reattach | `FIXED`: `ActiveRide` persists on device and resumes with a notice; an orphaned activity is ended at launch. Test: `RidePresentationTests.testRelaunchResumesTheRideInProgress` |
| P1-7 | Demo controls (speed picker, step button) sat on the ride screen. | old `ActiveJourneyView.demoControls` | `FIXED`: moved to a "체험 설정" sheet behind the ride menu |
| P1-8 | Ending a ride was a small "취소" text button with no confirmation. | old `ActiveJourneyView` toolbar | `FIXED`: full-width "여정 끝내기" with a confirmation dialog; arrival has one primary "내렸어요" |
| P1-9 | Live Activities disabled showed a raw red error. | old `errorBanner` with `live_activity_disabled` | `FIXED`: calm notice that the app keeps guiding and where to turn it on |

## P2

| # | Finding | Evidence | Status |
|---|---|---|---|
| P2-1 | Colours defined twice with drift (`TapsoTheme` coral `#FF6152` vs Figma `state/coral` `#D64545`; separate `TapsoLiveActivityPalette`). | old `TapsoTheme.swift`, `TapsoLiveActivityWidget.swift` | `FIXED`: one `TapsoTokens.swift` shared by app and extension, mirrored by the Figma `TAPSO V2 Semantic` collection |
| P2-2 | Several text colours failed contrast once measured (white on coral 4.4:1; tertiary grey 3.5:1). | `DESIGN_SYSTEM_V2.md` › Contrast | `FIXED`: coral `#C93C3C`/`#FF7A6E` with appearance-aware text, tertiary `#5F7079` |
| P2-3 | Decoration competed with the count: gradient numerals, sparkles, a 96 pt 돌이 beside the ride card in Figma. | old `ActiveJourneyView.header/remainingPanel`; Figma `11:43` | `FIXED`: flat numerals; 돌이 is 34 pt in the corner and hidden from VoiceOver |
| P2-4 | Copy that answered nothing: "제주 바람 따라 잘 가고 있어요." on the Lock Screen; "공공데이터로 탑승 차량을 따라가며…" on Home, although the app makes no network request. | old `ko.lproj/Localizable.strings` (`island_tracking_message`, `demo_explanation`) | `FIXED`: "내릴 때 알려드릴게요 · 지금은 편하게 가셔도 돼요"; Home states "체험판 · 합성 데이터" |
| P2-5 | No CI job built the app ("no CI job builds the app", `docs/DEVICE_TEST_PLAN.md`). | `.github/workflows/ci.yml` | `FIXED`: `ios` job builds and tests the committed project on a simulator and renders snapshot evidence |
| P2-6 | No map-app synergy. | — | `PARTIAL`: paste intake of shared place text and a NAVER Map name-search hand-off; see `MAP_APP_HANDOFF_V2.md` |
| P2-7 | `.textCase(.uppercase)` on Korean eyebrows and fixed 8–9 pt glyphs in island pills. | old `PhaseBadge`, `CompactActionPill` | `FIXED` (removed); island glyphs remain small by necessity, paired with words |

## What was already right, and kept

- No location permission anywhere (`DESIGN_PRINCIPLES.md` 9). V2 still requests none; see `INFORMATION_ARCHITECTURE_V2.md` › Permissions.
- Fail-closed milestones: an action state needs an exact phase/count agreement and fresh data. V2 keeps every existing test in `TapsoActivityAttributesTests` unchanged and adds an exhaustive check (`RideGuidanceTests.testMilestonesRequireExactFreshOnlineAgreementForEveryInput`).
- One alert per milestone, relevance rising toward arrival, stale dates on nonterminal content.

# UX QA V2

Evidence for Product V2 and what it does not yet prove. Reality labels as in `README.md`.

## Evidence sources

| Source | What it shows | How to reproduce |
|---|---|---|
| CI job `transit-core` | `RideGuidanceTests`, `RideSetupTests` and every pre-existing core test | `swift test --package-path packages/transit-core` |
| CI job `ios` › Build and test | App + Live Activity extension build; `TapsoActivityAttributesTests` (unchanged), `RidePresentationTests` | `xcodebuild … -scheme Tapso build test` |
| CI job `ios` › Render snapshot evidence | Every V2 screen (light, dark), 375/440-pt widths and AX3 text for the densest screens, Lock Screen and island regions for every ride moment, in Korean and English — rendered by `SnapshotEvidenceTests` with SwiftUI `ImageRenderer` on the simulator | Set `TEST_RUNNER_TAPSO_SNAPSHOT_DIR`, run `-only-testing:TapsoTests/SnapshotEvidenceTests -testLanguage ko` (and `en`) |
| Branch `ci-evidence/feat/product-v2-figma-ios-ux` | JPEG copies of the same images, one orphan commit per push | Published by CI on topic-branch pushes |
| Figma `04 iOS` `157:10`, `160:1208` | Designed screens and the Live Activity / island board | — |
| `scripts/ios/check_localization.py` | Every used key exists in ko and en with matching format arguments | `python3 scripts/ios/check_localization.py` |
| `services/api/test/crossLanguageAuthority.test.ts` | The app still makes no network request and the Swift matcher still sees only the demo fixture | `npm test --prefix services/api` |

`ImageRenderer` renders SwiftUI only: UIKit-backed controls (the search `TextField`, `PasteButton`) appear as placeholders, and island regions are drawn inside a mock outline. These are layout evidence, not device screenshots.

## Pass 1 — product flow and information architecture

Walked through the code paths and Figma frames `V2 / 01`–`19`.

| Check | Result |
|---|---|
| Home has one obvious question and CTA | Pass: "어디서 내릴까요?" + search field; nothing else competes above the fold |
| Repeat rider reaches a tracked ride in ≤ 2 taps | Pass: 다시 타기 → 맞아요 (`RidePresentationTests.testConfirmedRideWalksToArrivalAndIsRememberedForOneTapRepeat`) |
| New rider is asked only what is needed | Pass: route step skipped when one direction reaches the stop (`testDestinationFirstSkipsTheRouteStepWhenOnlyOneDirectionReachesIt`); boarding stop is "타는 정류장", never "출발지" |
| No bus selected without the rider | Pass (`testSampleRideProposesAndWaitsForTheRidersConfirmation`, `testRejectingTheOnlyBusKeepsWatchingInsteadOfSwitching`) |
| Every degraded state says what happened / whether tracking continues / what to do | Pass: copy in `JOURNEY_STATE_MODEL_V2.md` |
| No dead ends | Fixed in this pass: demo settings were unreachable from Home (toolbar hidden with the nav bar) → the synthetic-data chip opens them; rejecting both similar buses left the check with nothing to offer → further synthetic buses are proposed |
| No modal on modal | Pass: ride, end and setup replace each other; only the demo sheet is modal |

## Pass 2 — visual hierarchy, typography, spacing

| Check | Result |
|---|---|
| Ride priority: count → destination → action → route → trust → vehicle | Pass in Figma `V2 / 10`–`13`: numeral 76 pt, destination beside it, instruction below, route badge in the bar, trust badges under the hero, plate inside the vehicle badge |
| 2 / 1 / 0 visibly different at a glance | Pass: grey card with count, amber card "2정거장 남았어요", coral card with destination name, tangerine card with one button |
| 돌이 never competes | Pass: ≤ 36 pt in the app, 18–26 pt on the island, corner placement |
| Tokens only | Pass: every colour in app and extension comes from `TapsoTokens.swift`; Figma screens bind `TAPSO V2 Semantic` |
| Withheld count not shown | Fixed in this pass: the riding hero showed a number while signals disagreed (`checking`) |

## Pass 3 — app ↔ Lock Screen ↔ Dynamic Island consistency

| Check | Result |
|---|---|
| One source of truth | Pass: app `ActiveRide.signal` and `ContentState.signal` both feed `RideGuidancePolicy` (`testContentStateCarriesTheSameGuidanceAsTheApp`) |
| Same moment, same colour, same words, same symbol on every surface | Pass by construction (colour role, copy keys and symbol come from `RideGuidance`); board `160:1208` shows all four surfaces per moment |
| Alerts only on milestones, once each | Pass: `LiveActivityClient` alerts a milestone once per ride; exhaustive policy test |
| Stale activity never shows a fresh milestone | Pass (`testAStaleActivityNeverShowsAFreshMilestone`) |
| Coral next-stop Lock Screen readable | Fixed in this pass: the coral rail on the coral surface vanished → removed there |

## Pass 4 — accessibility and localization

| Check | Result |
|---|---|
| Contrast | Fixed in this pass: coral and tertiary tokens failed (4.4:1, 3.0:1, 3.5:1); all text pairs now ≥ 4.9:1 (`DESIGN_SYSTEM_V2.md`) |
| Meaning not by colour alone | Pass: every moment has words and a symbol; trust badges are icon + words |
| VoiceOver | Pass by code: ride hero, Lock Screen and expanded island read one sentence including route, destination, count (only when safe), headline and detail; 돌이, rails and dots are hidden; proposals read route, plate digits and position; moment changes are announced (`RideFeedback.announce`) |
| Dynamic Type | Fixed in this pass: count + labels, trust badges and the Home header now reflow vertically at accessibility sizes; long text wraps. Evidence: `*-ax3` snapshots |
| Reduce Motion | Pass: hero moment animation and the searching pulse are disabled |
| Korean / English | Pass: 187 keys in both tables, equal format arguments; `RidePresentationTests.testEveryGuidanceAndCheckKeyIsTranslatedInKoreanAndEnglish`; English Figma frames `V2 / EN · 02, 10, 12` |
| No engineering language | Pass: `testCopyNeverShowsEngineeringLanguage` bans READY_, CA-, BA-, matcher, confidence, 매칭, 확신, percentages |
| Touch targets | Pass: primary 56 pt, secondary 48 pt, rows and the star ≥ 44 pt |

## Pass 5 — implementation vs Figma

See the section filled from the CI snapshots below.

## Pass 6 — first launch to arrival

1. First launch: Home with the question, search, map import, "처음이라면" sample card, privacy line; no permission prompt.
2. 샘플 여정 체험하기 → bus check "이 버스로 보여요 ••xxxx" → 맞아요.
3. Ride: "6 정거장 남았어요 · 제주출입국·외국인청까지 · 내릴 때 알려드릴게요"; Live Activity starts; "이제 앱을 닫아도 돼요".
4. Home button: compact island "365 · 6 정거장". Lock: basalt Lock Screen.
5. Two stops: amber hero, pill "준비 2", one alert "2정거장 남았어요", soft haptic.
6. Next stop: coral hero with destination, coral Lock Screen, "다음 하차", one alert, strong haptic.
7. Arrival: tangerine hero "여기서 내려요" + 내렸어요, tangerine Lock Screen, one alert.
8. 내렸어요 → "잘 내리셨어요", NAVER Map search for the walk, 홈으로 → Home now shows 최근 여정 with 다시 타기.

Steps 1–3 and 5–8 are exercised in logic by `RidePresentationTests`; the surfaces are in the snapshots. Steps 4–7 on a real island and Lock Screen, with real alerts and haptics, are hardware-only.

## Device matrix

| Axis | Covered by | Status |
|---|---|---|
| Small iPhone (375 pt) | Snapshots `*-375-se`; Figma `V2 / SE 375 ·` | `VERIFIED` (render) |
| Regular (402 pt, iPhone 17) | All snapshots; all Figma frames | `VERIFIED` (render) |
| Pro Max (440 pt) | Snapshots `*-440-promax` | `VERIFIED` (render) |
| Light / Dark | Snapshots `*-light`, `*-dark`; Figma dark frames | `VERIFIED` (render) |
| Korean / English | Snapshot runs `ko`, `en`; Figma EN frames | `VERIFIED` (render) |
| AX3 Dynamic Type | Snapshots `*-ax3` | `VERIFIED` (render) |
| VoiceOver order | Code review above | `IMPLEMENTED`, device run `UNVERIFIED` |
| Real Dynamic Island size, truncation, alerts, haptics, Lock Screen tint | — | `UNVERIFIED` (hardware) |

## Hardware-only checks (not done)

- Compact/minimal/expanded island at real size in Korean and English, including the longest pill ("오프라인", "다음 하차") and a three-digit route.
- Milestone alerts: screen wake, sound, expanded island, once each.
- Foreground haptics: soft / warning / success / error.
- VoiceOver on the Lock Screen and island.
- App killed mid-ride and reopened from the island.
- Live Activities turned off in Settings.

These need a signed build on a device (`KNOWN_ISSUES.md` › `BLOCKED_BY_PAID_MEMBERSHIP`).

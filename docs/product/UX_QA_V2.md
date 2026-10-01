# UX QA V2

Evidence for Product V2 and what it does not yet prove. Reality labels as in `README.md`.

## Evidence sources

| Source | What it shows | How to reproduce |
|---|---|---|
| CI job `transit-core` | `RideGuidanceTests`, `RideSetupTests` and every pre-existing core test | `swift test --package-path packages/transit-core` |
| CI job `ios` › Build and test | App + Live Activity extension build; `TapsoActivityAttributesTests` (unchanged), `RidePresentationTests` | `xcodebuild … -scheme Tapso build test` |
| CI job `ios` › Render snapshot evidence | Every V2 screen (light, dark), 375/440-pt widths and AX3 text for the densest screens, Lock Screen and island regions for every ride moment, in Korean and English — rendered by `SnapshotEvidenceTests` with SwiftUI `ImageRenderer` on the simulator | Set `TEST_RUNNER_TAPSO_SNAPSHOT_DIR`, run `-only-testing:TapsoTests/SnapshotEvidenceTests -testLanguage ko` (and `en`) |
| CI artifact `ios-snapshot-evidence` | The canonical evidence: PNGs per language, uploaded by the read-only `ios` job | Actions run › Artifacts |
| Figma `03 iOS — GO` `205:3310`, `04 iOS — RIDE` `157:10`, `05 Live Activity · Dynamic Island` `160:1208` | Designed screens and the Live Activity / island board | — |
| `scripts/ios/check_localization.py` | Every used key exists in ko and en with matching format arguments | `python3 scripts/ios/check_localization.py` |
| `services/api/test/crossLanguageAuthority.test.ts` | The app still makes no network request and the Swift matcher still sees only the demo fixture | `npm test --prefix services/api` |

`ImageRenderer` renders SwiftUI only: UIKit-backed controls (the search `TextField`, `PasteButton`) appear as placeholders — the English "Paste" label in the Korean images is the test's placeholder, not the system button — horizontal `ScrollView` content (Home's recent-destination chips) renders empty, and island regions are drawn inside a mock outline. These are layout evidence, not device screenshots.

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
| Alerts only on milestones, once each | Fixed in this pass: the once-per-ride set lived in `LiveActivityClient` memory, so a relaunch or `nextStop → delayed → nextStop` could alert and buzz again. The set is now persisted with the ride (`ActiveRide.alertedMilestones`) and gates both alerts and haptics (`testConfirmedRideWalksToArrival…`, `testARestoredRideIsReagedAgainstTheWallClock…`) |
| Stale activity never shows a fresh milestone | Fixed in this pass: only the Lock Screen honoured `context.isStale`; the compact, minimal and expanded island regions and the keyline kept the fresh milestone. Every island view now takes `isStale` (`testAStaleActivityNeverShowsAFreshMilestone`; evidence `*-next-stop-stale`) |
| Restored ride not shown as fresh | Fixed in this pass: a ride restored at launch kept its saved freshness; it is now re-aged against the wall clock, and the Live Activity's stale date uses the wall-clock time of the last observation instead of the faster demo clock |
| App-closed promise | Fixed in this pass: copy said "이제 앱을 닫아도 돼요", but this build has no background mode or remote push, so a suspended app sends no update. Copy now says the preview plays while the app is open (app and Figma); `KNOWN_ISSUES.md` records it |
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

Compared the CI snapshots of `367b74a` (98 images per language; reviewed from a temporary JPEG copy on a `ci-evidence` branch that CI no longer publishes) with Figma `V2 / 01`–`19`, the dark, English and 375-pt frames and board `160:1208`.

| Check | Result |
|---|---|
| Screen structure and hierarchy | Pass: Home, search, route, boarding, map intake, the four bus-check stages, all ride moments and both end screens follow their frames — question title, one primary action, hero → trust badges → stop ladder order. The ride toolbar (route badge, destination, menu) and the bottom 여정 끝내기 button live in `RideView`, outside the rendered `RideContent`, as in Figma |
| Moment colours | Pass: basalt/mint riding, amber prepare, coral next stop (C93C3C light, FF7A6E dark), tangerine arrival, slate delayed/lost/offline, blue checking — app, Lock Screen, compact, minimal and expanded island agree per moment |
| Lock Screen and island | Pass: counts, word pills (준비 2, 다음 하차, 내려요, 지났어요, 지연, 찾는 중, 오프라인, 확인 중; Next, Offline, 6 stops in English), last-known counts dimmed with 마지막 확인, symbols where the count is withheld; no rail on the coral surface |
| Large text (AX3) | Fixed in this pass: the route badge truncated to "3…" on the proposal card (now never truncates) and stop-ladder names cut at two lines (now wrap). The Home wordmark splitting ("TAPS/O") and trust badges wrapping into three lines were fixed in `3f71f75`, after these images were rendered |
| Withheld count | Fixed in `3f71f75`: the `21-ride-checking` image of `367b74a` still shows "2 정거장 남았어요" |
| Dark mode | Fixed in this pass: on the dark end screens the neutral route badge (basalt) vanished into the navy background; it now uses the route colour as elsewhere |
| Evidence consistency | Fixed in this pass: the ride and surface images used plate ••0001 while the check proposed ••6639; they now share the proposed bus's plate |
| Copy | Changed in both: the preview copy above (riding detail, confirmation detail, close-app note) and the offline eyebrow "오프라인" (it read "연결 확인 중", the same words as the data-checking badge) |
| Figma sample data | Known: `V2 / 10` lists four stops under a count of 6; the app shows three and "2곳 더", which is the implemented rule (`StopLadder`) |

The fixes after `367b74a` are verified by build, unit tests and the next CI render, which replaces the evidence branch.

## Pass 6 — first launch to arrival

1. First launch: Home with the question, search, map import, "처음이라면" sample card, privacy line; no permission prompt.
2. 샘플 여정 체험하기 → bus check "이 버스로 보여요 ••xxxx" → 맞아요.
3. Ride: "6 정거장 남았어요 · 제주시청(아라방면)까지 · 내릴 때 알려드릴게요"; Live Activity starts; "체험판은 앱을 켜 둔 동안 진행돼요".
4. Home button (the app stays running briefly; in this build it must be reopened to keep advancing): compact island "365 · 6 정거장". Lock: basalt Lock Screen.
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

# Live Activity specification

Product V2 (2026-09-30). Layout: `apps/ios/Shared/LiveActivitySurfaces.swift` (plain views, also rendered by the app's snapshot tests); wiring: `apps/ios/LiveActivity/TapsoLiveActivityWidget.swift`; every decision: `RideGuidancePolicy` in the Swift core. Figma: `02F iOS Ride V2` Lock Screen / Dynamic Island V2 sets and the `04 iOS` state board. Per-moment detail: `product/JOURNEY_STATE_MODEL_V2.md`.

## Model

Static attributes hold route ID/number, boarding and destination stops, the trip's total stop count and the masked plate of the rider-confirmed bus. Dynamic content holds the journey phase, remaining stops, current and next stop, freshness, observation time, and — new in V2, optional so older payloads decode — whether the destination was passed and whether the phone is offline. `ContentState.signal` builds the same `RideSignal` the app builds from its session, so the app and every surface read one `RideGuidance`. iOS tests encode both objects together and enforce the 4 KB payload limit, and check that a V1 payload still decodes.

The activity starts only after the rider confirms the bus; there is no Live Activity for setup or the vehicle check.

## Surfaces

- **Lock Screen:** route badge and destination; the moment's headline and detail; the count (or, when withheld, the moment's symbol); a progress rail ending at the tangerine destination. A data badge appears only when data is not live; 돌이 appears while riding. The surface is basalt while riding and in every uncertain state, turns **coral at the next stop** and **tangerine on arrival** (`activityBackgroundTint`). The coral surface has no rail, which would vanish coral-on-coral; the destination name carries it.
- **Compact leading:** 돌이 (expression by moment) and the route number in the moment colour. VoiceOver hint: touch and hold for details.
- **Compact trailing:** while riding, the count and "정거장"; otherwise a pill with symbol and word — 준비 2, 다음 하차, 내려요, 지났어요, 지연, 찾는 중, 오프라인, 확인 중.
- **Minimal:** the live count, else the moment symbol.
- **Expanded:** leading 돌이 + route; centre the eyebrow; trailing the count (dimmed and labelled 마지막 확인 when last-known) or symbol; bottom the headline, destination, rail or detail, and both trust badges (vehicle identity and data freshness, never merged).

Counts are `live` for riding, prepare and next stop, `lastKnown` for delayed, lost and offline, and hidden for arrival, passed destination, checking and ended.

Past the destination, `nextStopName` carries the stop to get off at (`PassedStopRescue`: the first stop after the bus's last reported position), not the next stop before the destination. The Lock Screen, the expanded island and VoiceOver then read "다음 정류장 {stop}에서 내리세요" through `RideText.detail`; with no known position, or once the data ages into delayed, they keep the moment's own detail line.

## Update policy

- Relevance: riding 50; delayed, lost, offline, checking 75; prepare 85; next stop and passed destination 95; arrival 100.
- Nonterminal content becomes stale two minutes after the wall-clock time its last observation reached the app (`ActiveRide.lastObservedAt`; the demo's own clock runs faster and is not used). Arrival and ended content has no stale date. A system-stale activity is presented as delayed data, never as a fresh milestone, on the Lock Screen, every island region and the keyline (`guidanceAccountingForStaleness` with `context.isStale`).
- Milestones: `prepare`, `nextStop` and `arrived` each attach one `AlertConfiguration` (localized title/body, default sound), **at most once per ride**: the app model keeps the signalled milestones in the persisted ride (`ActiveRide.alertedMilestones`) and passes `LiveActivityClient.update(state:alerting:)` only a milestone not yet signalled, so neither a relaunch nor a delayed/lost/offline interruption repeats one; in-app haptics follow the same set. They are emitted only for an exact `(approachingDestination, 2)`, `(nextStopIsDestination, 1)` or `(arrived, 0)` on fresh data with the phone online. Negative counts, unknown or stale freshness, recovery, a lost bus, offline, a passed destination or any phase/count mismatch never alert (`RideGuidanceTests.testMilestonesRequireExactFreshOnlineAgreementForEveryInput`).
- Passing the destination is its own moment: no arrival alert, a single attention haptic in the app, a recovery action.
- Starting a ride ends any existing TAPSO activity first. At launch the app resumes a persisted ride and its activity, re-ageing its data against the wall clock (a ride saved at the next stop and reopened later shows delayed or checking until the next observation); an activity left without a ride is ended.
- Updates come only from the running app. There is no background mode or remote push in this build, so a suspended app sends nothing and the activity turns to delayed at its stale date (`KNOWN_ISSUES.md`).
- Finishing a ride ends the activity with the ended state ("여정을 마쳤어요") for a one-minute dismissal window; cancelling ends it immediately.

## The way back: "돌아갈 시간" (V2.4d)

A second activity type, `TapsoReturnAttributes` (`Shared/TapsoReturnAttributes.swift`, surfaces in `Shared/ReturnActivitySurfaces.swift`, widget `LiveActivity/TapsoReturnActivityWidget.swift`). After a live ride the end screen's last-bus card offers, per variant, "잠금 화면에 남은 시간 띄우기"; the rider's tap starts it, and nothing else does.

- **Content is fixed at start:** route number, the variant's direction, the `HH:MM` to be at the stop and the published last departure from the starting stop, plus `startedAt` and `beAtStopBy` (`LastBusAdvice.beAtStopByDate`, the same instant as the card's `HH:MM`). The countdown is `Text(timerInterval:countsDown:)` (SwiftUI, iOS 16+, VERIFIED on developer.apple.com 2026-10-01), which the system runs, so the activity is never updated, needs no push and keeps counting with TAPSO closed. In a widget a running timer cannot measure itself, so every countdown has a fixed width.
- **Stale date = `beAtStopBy`.** Past it the surfaces stop counting and say "정류장에 나갈 시각이 지났어요" with the last departure, never a negative time.
- **Offered only when it can finish:** the instant is at least 5 minutes away (`ASSUMED`; nearer, the card's own line is enough) and at most 8 hours away, because Apple ends a Live Activity after eight hours (ActivityKit, "Displaying live data with Live Activities", VERIFIED 2026-10-01). Farther than that the card says when it can start. Gone, unknown or `notRecommended` last buses are never counted down.
- **One at a time:** pinning another variant replaces it; "끄기" ends it. When TAPSO comes to the front it adopts a running countdown and ends one more than 30 minutes past its time (`ASSUMED`).
- **Below a ride:** relevance 10, under every ride moment, so a ride under way keeps the Dynamic Island; the two can coexist.
- **Surfaces:** basalt with fixed amber (counting) and tangerine (late) accents that read in light and dark mode; compact leading moon + route number, compact trailing the timer, minimal a moon (or `!` when late), expanded route badge, timer, headline and "direction · 막차 HH:MM 기점 출발". Snapshot evidence: `la-lockscreen-return-countdown`, `la-lockscreen-return-late`, `di-*-return-*`, and the card `31-end-return-countdown`.

## Lifecycle and constraints

The app starts, locally updates and ends the activity; the extension performs no network or location work. Per Apple's ActivityKit documentation, compact leading and trailing form one island, the minimal region is used when several activities compete, touch-and-hold opens the expanded view, an activity stays up to 8 hours active and up to 4 more on the Lock Screen, the system ignores animation modifiers except built-in transitions and `numericText`, and an update's `AlertConfiguration` lights the screen, plays the sound and shows the expanded island (a banner on devices without one). No custom vibration pattern is available to a Live Activity, so haptics are promised only while the app runs.

Remote updates would use APNs with `apns-push-type: liveactivity`; that path is `BLOCKED_BY_CREDENTIALS` and the activity is requested with `pushType: nil`.

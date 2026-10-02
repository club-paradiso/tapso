# Device test plan

> **Status, 2026-09-29.** This plan is a device check, not a bus ride. Release
> gate `matcher-passive-safety-v4` asks only for its Live Activity part on a
> physical device (criterion BA-5), and only for
> `READY_FOR_BOUNDED_AUTOMATION`; no lower readiness level needs it
> ([`validation/MATCHER_SAFETY_EVIDENCE_V4.md`](validation/MATCHER_SAFETY_EVIDENCE_V4.md),
> [`exec-plans/HUMAN_LABOR_ELIMINATION.md`](exec-plans/HUMAN_LABOR_ELIMINATION.md)).
> The demo plays a fixed timeline (`DemoFixtures.demoTimeline()` in
> `apps/ios/TapsoApp/TapsoAppModel.swift`) and makes no network request. Live
> rides (beta, since 2026-10-01) read TAPSO's API through
> `TapsoAPIClient.swift` and need production journey sessions, which answer
> `503 SESSIONS_UNAVAILABLE` until they are enabled. Where "ride" below means
> the demo, some checks cannot run against it:
>
> - Case 6: the app has no input injection path.
> - Case 8, the pushes in case 9 and the APNs criterion: the Live Activity is
>   requested with a push token only when the server has APNs configured, which no deployment has
>   yet; nothing pushes until the scheduler exists (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`), so
>   there is no remote update.
> - Network bytes in case 9: the demo makes no network request; a live ride
>   reads one session every 15 s while the app runs.
>
> Since 2026-09-30 the CI job `ios` builds the app and runs its tests on a
> simulator, and renders every Product V2 screen and ride surface
> (`product/UX_QA_V2.md`). The simulator result at the end is the historical
> V1 report.

## Matrix

- Dynamic Island iPhone on the minimum supported iOS and current stable iOS.
- Non-Island iPhone for Lock Screen-only behavior.
- Korean and English; largest accessibility text; light/dark mode; VoiceOver; Reduce Motion.
- Wi-Fi, cellular, offline, background, locked, Low Power Mode, app termination, and device restart.

## Ride cases

1. Start at 8 stops and verify request success, route/destination, and initial freshness.
2. Drive 8 → 3; ensure monotonic count and compact/minimal/expanded layouts.
3. Verify two-stop prepare, one-stop next destination, arrival, and activity end/dismissal.
4. From the Home Screen, verify compact leading/trailing at 8, 2, 1, and 0 stops; touch and hold to inspect the expanded Island.
5. Verify important-update presentation and system sound for the 2, 1, and 0 milestones on a signed physical device.
6. Inject duplicate, out-of-order, stale, missing, wrong-direction, ambiguous, and disappearance inputs.
7. Disable Live Activities and confirm honest in-app fallback.
8. Rotate push token and confirm the server replaces it without logging full token data.
9. Measure update latency, dropped pushes, CPU, network bytes, and battery during a full representative ride.

## Map hand-off cases (`product/MAP_HANDOFF_V3.md`)

10. From KakaoMap, NAVER Map and Apple Maps, share a Jeju place to TAPSO; record the share text and links the extension receives (no personal places), and check that name, address and location status match the place.
11. Share a place outside Jeju and a bare short link: "제주 밖 장소예요" and "링크만 받았어요", and nothing is kept.
12. "탑서에 남기기", then open TAPSO within 30 minutes: the import screen opens once with the place; reopening does not show it again; after 30 minutes nothing appears.
13. On a build without the App Group provisioned, the extension offers "복사하기"; pasting in TAPSO gives the same place.
14. Live: after naming the bus, the stops nearest the place are suggested after boarding; the end screen opens NAVER Map and KakaoMap walking routes to the place and shows it in Apple Maps.

## Rescue and way-back cases (`product/JEJU_SAFETY_LAYER_V3.md`, `LIVE_ACTIVITY_SPEC.md`)

15. Live: stay on past the destination. When TAPSO says "목적지를 지났어요", note the stop it names and where the bus actually stops next; compare the straight-line metres with the walk NAVER Map gives; check that no ride back is offered and the map buttons open a walking route to the stop (or the shared place).
16. After a live ride, pin a variant's last bus: the Lock Screen and Dynamic Island count down to the shown time with TAPSO closed and the phone locked; pinning another variant replaces it; "끄기" removes it; past the time the surfaces say so instead of counting; a ride started meanwhile keeps the Dynamic Island.

## Pass criteria

- No false confident arrival or silent vehicle switch.
- State is understandable without color and all actionable controls have meaningful VoiceOver output.
- Dynamic Island regions do not truncate the critical number/destination at supported text sizes.
- APNs and local updates are idempotent; stale data is visible within the configured threshold.

Current result: iOS 26.3 iPhone 17 Pro Simulator verifies the app build, 8 iOS tests, compact states at 8/2/1/0, expanded Island, and Lock Screen card. Important-update sound/banner behavior and the rest of the physical-device matrix remain `UNVERIFIED` until a signed real-device run.

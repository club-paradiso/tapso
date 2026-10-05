# ExecPlan: TAPSO starts the ride before the rider opens it

Started 2026-10-05. A living document; update it as each milestone lands.

## 1. Outcome and non-goals

**Outcome.** A rider who takes the same bus again does not open TAPSO, search, or pick a stop. When they reach their usual stop or press one button, TAPSO says first: "365번이 2정거장 전이에요 · 탈 거예요?". One answer starts the vehicle check. The Live Activity carries the ride from there to the right stop.

The device that carries the feature is **"탑서가 먼저 말을 건다"**: TAPSO speaks first, and the rider answers once. iOS does not let an app open itself to the foreground (see §2), so "auto-start" here means the system wakes TAPSO, or the rider triggers it without opening the app, and TAPSO puts the question on the Lock Screen.

**Non-goals.**

- No continuous passenger GPS, in the foreground or background (`AGENTS.md`, design principle 9). Location permission stays optional and is never a prerequisite for a ride.
- No automatic bus pick until the matcher's `READY_FOR_BOUNDED_AUTOMATION` gate passes (`docs/ROADMAP.md`). The rider confirms the bus.
- No hardware in buses (NFC tags, beacons) until an operator agrees to it.
- No motion-based "you are in a vehicle" detection: Core Motion does not wake a suspended app (§2).

## 2. Verified constraints

Sources are Apple's primary documentation, read on 2026-10-05. `UNVERIFIED` means no primary source confirmed it; each such item must be proven on a device before a milestone that depends on it is marked done.

| # | Constraint | Label | Source |
|---|---|---|---|
| C1 | Only Core Location region/condition monitoring, significant-location-change and visits relaunch a terminated app, and only with **Always** authorization ("Launches a terminated app automatically — When in Use: No; Always: Yes") | VERIFIED | [Requesting authorization to use location services](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services) |
| C2 | `CLMonitor` (iOS 17) monitors at most **20 conditions** per app; the system tries to launch a terminated app when a condition is satisfied; the monitor must be recreated with the same identifier; it does nothing before the first unlock after a reboot | VERIFIED | [CLMonitor](https://developer.apple.com/documentation/corelocation/clmonitor-2r51v), [Monitoring the user's proximity to geographic regions](https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions) |
| C3 | Region events usually arrive within 3–5 minutes and need a network connection. The minimum practical radius on current iOS is not documented (the legacy note says 1–400 m works better; Apple's example uses 200 m) | VERIFIED (timing) / UNVERIFIED (radius) | same |
| C4 | Push-to-start Live Activities (iOS **17.2**): `Activity.pushToStartToken` / `pushToStartTokenUpdates`; `apns-push-type: liveactivity`; the start payload needs `event: "start"`, `attributes-type`, `attributes`, `content-state`, `timestamp` and an `alert`; the system starts the activity, **wakes the app and grants it background runtime**; there is an hourly budget, and priority 5 does not count against it | VERIFIED | [Starting and updating Live Activities with ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications) |
| C5 | The app must run at least once to read the push-to-start token and send it to the server. What happens after the rider force-quits the app is undocumented | INFERENCE / UNVERIFIED | same |
| C6 | A `LiveActivityIntent` (iOS 17) starts a Live Activity "without opening the app"; Apple's example is a Control Center control | VERIFIED | [LiveActivityIntent](https://developer.apple.com/documentation/appintents/liveactivityintent) |
| C7 | `ControlWidget` / `ControlWidgetButton` (iOS 18) appear in Control Center, on the Lock Screen and on the Action button (iPhone 15 Pro or later), and run an action without opening the app | VERIFIED | [ControlWidget](https://developer.apple.com/documentation/swiftui/controlwidget), [Action button (Apple Support)](https://support.apple.com/guide/iphone/use-and-customize-the-action-button-iphe89d61d66/ios) |
| C8 | The same intent run from a Shortcut, the Action button set to a Shortcut, or a widget starts the activity without opening the app | INFERENCE (Apple documents only the Control Center case) | C6 |
| C9 | Shortcuts personal automations: Arrive, Leave, CarPlay, Wi‑Fi, Bluetooth, NFC tag, Time of Day and others can run without asking once the user turns off Ask Before Running. **Only the user can create them**; an app cannot | VERIFIED | [Create a personal automation](https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/ios), [Travel triggers](https://support.apple.com/guide/shortcuts/travel-triggers-apd8ebfc4e8e/ios) |
| C10 | A notification action without `.foreground` launches the app in the background and calls `userNotificationCenter(_:didReceive:withCompletionHandler:)`. Whether `Activity.request` is allowed there is undocumented; Apple says starting generally needs the foreground | VERIFIED / UNVERIFIED | [Handling notifications and notification-related actions](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions) |
| C11 | Core Motion activity updates "are not delivered while your app is suspended" | VERIFIED | [CMMotionActivityManager](https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager) |
| C12 | Always is requested only after When In Use, and **only once**; When In Use is "the preferred choice". Review Guidelines 5.1.1(ii)–(iv) and 5.1.5 require a purpose string that fully describes the use, data minimisation, and a working alternative when the rider says no; 2.4.2 forbids rapid battery drain; 4.5.4 says push must not be required for the app to work | VERIFIED | [requestAlwaysAuthorization()](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestalwaysauthorization()), [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) |
| C13 | APNs is not configured: the five `APNS_*` variables are missing and the only team on the build host is a free Personal Team | BLOCKED_BY_APPLE_ACCOUNT | `TAPSO_V1_RELEASE_CLOSURE.md` workstream I, `LIVE_ACTIVITY_PUSH.md` §2 |
| C14 | Today's `RideAgainIntent` opens the app (`openAppWhenRun = true`) at the vehicle check | VERIFIED (code) | `apps/ios/TapsoApp/TapsoShortcuts.swift` |
| C15 | Live Activity buttons that run an App Intent (a "맞아요" on the Lock Screen) | UNVERIFIED: not yet checked against Apple's documentation | — |

## 3. Milestones

Each milestone ships alone and is useful alone. They are ordered by how little they ask of the rider and of the Apple account.

### M1a. One press to the vehicle check — `IN_REVIEW` (PR #124)

No new permission, no APNs.

- `RideAgainOpenIntent`, an `OpenIntent` compiled into the app and the widget extension. Apple requires both: "The system requires the Target Membership of the app intent to be set to both the app and the widget extension to open the app" ([Creating controls](https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system)).
- `RideAgainControl`, an iOS 18 `ControlWidgetButton` "다시 타기", for Control Center, the Lock Screen and the Action button (C7).
- One press opens TAPSO at the vehicle check for the last ride. With no saved ride it opens search.

**Done when:** on the iPhone, the control is added to Control Center (and the Action button set to it); one press with TAPSO closed lands on the vehicle check of the last ride. Evidence: a screen recording. Tests: `RideAgainControlTests`.

### M1b. One press, app closed — `BLOCKED_BY_APPLE_ACCOUNT`

`StartLastRideIntent: LiveActivityIntent` starts the Live Activity in **checking** without opening the app (C6). The bus proposal then reaches the Lock Screen as an alert update.

This is deferred, not dropped. Without APNs (C13) the activity stops updating when the app is suspended and reads "확인 중" after 120 s (`KNOWN_ISSUES.md`). An activity that freezes is worse than opening the app (M1a). It ships with M4's APNs work. Confirming from the Lock Screen also waits for C15.

### M2. The rider's own automation — `IN_REVIEW` (PR #125)

Still no new permission. TAPSO cannot create automations (C9), but it can make one take ten seconds.

- `AutoStartGuideView` ("자동으로 시작하기"), reached from Home under 최근 여정 once there is a ride to repeat. It has two recipes, **정류장에 도착하면** (Arrive) and **정한 시간이 되면** (Time of Day), and a button that opens the Shortcuts app (`shortcuts://`; if it fails, the screen says so). The location stays inside Shortcuts; TAPSO never sees it.
- The step wording follows Apple's Korean Shortcuts guide: 자동화 탭, 개인용 자동화, 도착, 특정 시간, 동작 추가. The "run without asking" option is described, not named: its Korean label was not found in Apple's guide, and it differs across iOS versions.
- `RideAgainIntent` gains an optional `journey: SavedJourneyEntity` parameter. `SavedJourneyQuery` reads the on-device library and suggests favourites first. With no journey named, the intent starts the last ride.
- Opening `shortcuts://` without parameters is not in Apple's guide (only `shortcuts://run-shortcut` and the gallery URLs are): `UNVERIFIED` until a device opens it.

**Done when:** on the device, a rider follows the guide and the automation opens the vehicle check for the chosen journey; the Shortcuts button opens Shortcuts. Evidence: a recording of the setup and the trigger. Tests: `SavedJourneyEntityTests`.

### M3. "탑서가 먼저 말을 건다" at saved stops — `IN_REVIEW` (PR #126)

The owner decided D2 (yes) on 2026-10-05.

- **Opt-in.** The switches sit at the top of "자동으로 시작하기", one per saved journey, favourites first. Only live journeys can be switched on, because only they have a real stop. Everything is off by default.
- **Permissions.** Turning one on asks for notifications, then When In Use, then Always (Apple shows the Always prompt once, sometimes later: C12). Without Always, the screen says the nudge works only while TAPSO is open. With no location access, the switch stays off and the screen says why.
- **Monitoring.** `StopNudgeController` runs one `CLMonitor` ("tapso.stopNudges") with a 150 m `CircularGeographicCondition` per boarding stop, at most `StopNudge.maximumStops` = 10 (C2). The stop's coordinates come from the route's current `/v1/stops` list at opt-in, matched by stop id and provider sequence. The monitor and the notification delegate start in `TapsoApp.init`, so a relaunch for an event finds them (C1).
- **On entry.**
  - TAPSO reads `/v1/vehicles` for the route; the request carries `routeId` and `cityCode` only, and a test proves it.
  - `StopNudge.nearestStopsAway` names the nearest bus that has not passed the stop, within 12 stops.
  - TAPSO posts "제주버스터미널 정류장이에요 · 365번이 2정거장 전이에요. 탈 거예요?". If the bus is at the stop or not found, the text says so.
- **Actions.** **탈게요** (foreground) opens the vehicle check for that journey, through the same inbox as the control. **오늘은 아니에요** silences that stop until the start of the next day.
- **Privacy.** Whether the phone is near a stop is decided on the phone; no coordinate is sent. The purpose strings in `project.yml` (`NSLocationWhenInUseUsageDescription`, new `NSLocationAlwaysAndWhenInUseUsageDescription`) say exactly this.
- **Not yet.** The notification is `.active`, not time-sensitive: the Time Sensitive entitlement is unverified for the Personal Team (C12 risk). Starting from the notification without opening the app waits for C10 and M1b.

**Done when:**
- on the device, with TAPSO terminated and Always granted, walking into a switched-on stop produces the notification within 5 minutes;
- **탈게요** opens that journey's vehicle check;
- **오늘은 아니에요** silences it until tomorrow;
- denying location leaves M1a and M2 working;
- one day of battery use is recorded from Settings › Battery.

Tests: `StopNudgeTests` (core), `StopNudgePresentationTests`, `testVehicleStopSequencesSendsTheRouteAndNothingAboutTheRider`.

### M4. Push-to-start from the rider's schedule — `BLOCKED_BY_APPLE_ACCOUNT`

This is the best fit for "track the bus, not the rider": it needs no passenger location (C4).

1. The app sends `pushToStartToken` to the API with the rider's saved schedule ("평일 08:05, 365번, 제주버스터미널 → 제주시청").
2. Before the departure, the ticker that already runs on Railway (`services/api/src/liveActivityTicker.ts`) finds the next 365 approaching that stop and sends a push-to-start with an alert. The activity starts in **checking**, and the app wakes to create the session (C4).
3. Everything from there is M1.

**Blocked by:** C13 (a paid Apple developer team, a `.p8` key, and the five `APNS_*` variables). C5 must be checked on the device.

**Done when:** with the app terminated, the scheduled ride's activity appears on its own 5–10 minutes before the bus, and the hourly budget is respected in a one-week log.

### M5. Confirming the bus without a tap — `GATED`

This waits until the matcher passes `READY_FOR_BOUNDED_AUTOMATION` (≥ 300 trajectories plus the client mitigations, `docs/ROADMAP.md` item 7). It needs a visible undo for an automatic pick. Until then the rider confirms.

## 4. Decisions

- **D1 (taken).** "Auto-start" means TAPSO asks first; it never opens itself. Alternatives were rejected:
  - background GPS that detects boarding: principle 9, C12, and battery cost;
  - Core Motion "in a vehicle": cannot wake the app (C11);
  - in-bus NFC or beacons: needs an operator.
- **D2 (owner, decided yes on 2026-10-05).** Is opt-in, saved-stop-only region monitoring with Always permission acceptable under principle 9? Recommendation: **yes, as M3**. It is off by default, monitors stops rather than the rider, keeps location on the device, and leaves every feature working without it. If the answer is no, M3 is dropped and M2's Shortcuts "Arrive" recipe covers the same moment, with Shortcuts holding the location instead.
- **D3 (taken).** Ship order: M1a → M2 → M3, with M1b and M4 as soon as the account allows APNs. M1a and M2 need nothing from Apple and nothing from the rider beyond a button.

## 5. Reproduction and evidence

```bash
swift test --package-path packages/transit-core
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 16' build test
# Device (memory: paired iPhone 15 Plus; build generic when the phone is locked)
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build
xcrun devicectl device install app --device <id> <Tapso.app>
```

Intents, controls and Live Activity starts only prove themselves on a device. A simulator result is never the evidence for "done".

## 6. Progress, risks, next action

- 2026-10-05: plan written. Apple's documentation was checked for C1–C14 and C15 is still open. No code yet.
- **Risks:**
  - The Personal Team may not provision Control widgets or time-sensitive notifications. Check before M1 or M3 respectively.
  - Starting a Live Activity from an intent may be throttled, or may fail when Live Activities are off (`areActivitiesEnabled`). Say so in the UI instead of failing silently.
  - Region events can be minutes late (C3), so a bus that is already at the stop is missed. M3's notification must name the bus after it when the nearest one is already at the stop.
- 2026-10-05: M1a in PR #124 (control + `OpenIntent`), 95 iOS tests green in the simulator. On the device: not yet proven.
- 2026-10-05: M1a merged (#124). M2 in PR #125, with 97 iOS tests green in the simulator. Device evidence is still owed for both.
- 2026-10-05: M2 merged (#125). The owner decided D2 (yes). M3 in PR #126: 100 iOS tests and 245 core tests green in the simulator.
- **Exact next action:** device evidence for M1a, M2 and M3, the last by walking to a switched-on stop with TAPSO terminated.

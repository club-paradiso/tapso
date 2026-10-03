# ExecPlan: Live Activity updates by push (APNs)

Started 2026-10-01. Living document; update it as milestones land.

## 1. Outcome and non-goals

**Outcome.** A rider confirms their bus, locks the phone or switches apps, and the Lock Screen and Dynamic Island keep counting down to the destination from server pushes, alerting once each at 2 stops, the next stop and arrival, until the ride ends. Today they freeze and read "확인 중" 120 s after the app is suspended (`KNOWN_ISSUES.md`).

**Non-goals.** No passenger location, in the foreground or background. No push-to-start (the rider starts the activity by confirming the bus in the app). No alerts other than the three milestones. No client-side APNs credential of any kind: the iOS app never holds the `.p8` key and never talks to APNs.

## 2. Constraints and assumptions

| Item | Label | Source |
|---|---|---|
| Live Activity push: `POST /3/device/<token>` over HTTP/2 to `api.push.apple.com` or `api.sandbox.push.apple.com`, headers `apns-push-type: liveactivity` and `apns-topic: <bundle id>.push-type.liveactivity` | `VERIFIED` against Apple's documentation ("Starting and updating Live Activities with ActivityKit push notifications"), as implemented in `services/api/src/apns.ts` | Apple Developer documentation |
| Token auth: ES256 JWT, `kid` = key ID, claims `iss` = team ID and `iat`; refreshed at most every 20 min, never used past 60 | `VERIFIED` (docs); the module reuses 50 min | "Establishing a token-based connection to APNs" |
| `content-state` is decoded by ActivityKit into the app's `ContentState` with `JSONDecoder` defaults, so `Date` is seconds since 2001-01-01 | `VERIFIED_BY_TEST` in Swift (iOS test target and Linux Swift) against the committed fixture `fixtures/transit/live-activity-push.json`; on a device `UNVERIFIED` | `TapsoActivityAttributesTests` |
| A push token is per activity, can rotate (`Activity.pushTokenUpdates`), and is invalid once the activity ends | `VERIFIED` (docs); rotation handling on a device `UNVERIFIED` | ActivityKit documentation |
| Apple throttles priority-10 Live Activity updates per app | `VERIFIED` (docs): quiet updates use priority 5, alerts 10 | ActivityKit documentation |
| Vercel functions cannot run a loop between requests; something must call the server on a schedule | `VERIFIED` (platform model) | `docs/PRODUCTION_TRANSIT_API.md` |
| Apple developer team, App ID with Push Notifications, `.p8` APNs key | `BLOCKED_BY_APPLE_ACCOUNT`: the only team on the build host is a free Personal Team (`docs/TESTFLIGHT.md`) | |

## 3. Milestones

1. **Sender** — `DONE`: `services/api/src/apns.ts`.
   - Fail-closed configuration from `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` and `APNS_PRIVATE_KEY`; it names missing settings, never their values.
   - Provider-token lifecycle.
   - The request (headers, `aps` payload, priority).
   - Response classification (token rejected → drop it; our credential; throttled; unavailable or network).
   - Token fingerprints in logs, never tokens.
   - Tests: `services/api/test/apns.test.ts`, which verifies the JWT signature, the payload shape, the classification, the refresh rules, and that no token reaches a log line.
2. **Token registration** — `DONE`.
   - `PUT /v1/sessions/:id/live-activity` with `{ "pushToken": "<hex>" }` stores the token (normalised to lower case), its fingerprint and when it arrived in the session row (`liveActivityPush`, optional, no schema bump). The answer carries the fingerprint, never the token. `DELETE` clears it. Ending the session deletes the row and the token with it.
   - `503 LIVE_ACTIVITY_PUSH_UNAVAILABLE` while APNs is not configured, so no token is stored for pushes that cannot come. `/health` reports `liveActivityPush` by `describeApns` (enabled, environment, or the missing setting names).
   - Vercel rewrite `/v1/sessions/:id/live-activity` → `/api/v1/session-live-activity`. CORS allows `PUT`.
   - The write retries a lost compare-and-set up to three times (it derives nothing from a provider read), then answers `409 SESSION_WRITE_CONFLICT`. A refresh that raced it loses its own compare-and-set and keeps the token.
   - The session's TTL (4 h) bounds the token's life.
   - Tests: `journeySession.test.ts` (round trip, rotation, clear, end, refusal without echo, both race orders, bounded retry) and `apiRouter.test.ts` (push off, sessions off, rewrite, no token in any answer or log line, preflight). Two mutations (dropping the field on read, no retry) each fail a test.
   - Moved to milestone 5: the index of sessions with a token. Only the scheduler reads it, so it is built with the scheduler, inside the session namespace.
3. **App side** — `DONE` in code; on a device `UNVERIFIED` (milestone 6). In the live ride (`TapsoAppModel`, `LiveActivityClient`, `TapsoAPIClient`):
   - A live ride asks for `pushType: .token` only when the server reports push enabled (`/health` → `liveActivityPush.enabled`; any failure reads as off). A demo ride never asks.
   - If ActivityKit refuses the push request (a build without the push entitlement, which a Personal Team cannot have), the activity starts with `pushType: nil`, as before.
   - Every token from `pushTokenUpdates` is registered with `PUT /v1/sessions/:id/live-activity`: rotation is a re-registration. A relaunch with the activity still running observes it again. Finishing or cancelling the ride stops the observation; ending the session on the server deletes the token.
   - Tests: `TapsoAPIClientTests` (`/health` read as on, off, absent, failed, offline; the PUT and its hex body; a refused registration). The API client also typechecks under Swift 6 on Linux against transit-core. The `ActivityKit` calls compile only in the iOS job.
   - The app target has no `aps-environment` entitlement yet: adding it needs the paid team (`BLOCKED_BY_APPLE_ACCOUNT`).
4. **Push on change** — `DONE` in code (2026-10-02); nothing is pushed in production until APNs is configured (`BLOCKED_BY_APPLE_ACCOUNT`), and on a device `UNVERIFIED`.
   - `services/api/src/liveActivityContent.ts` ports `LiveSessionInterpreter.rideSignal`, `RideGuidancePolicy.moment`/`milestone`, the app's content-state builder and `PassedStopRescue.exitStop`. `fixtures/journey/live-activity-signals-v1.json` is generated from it over the server's own session payloads (`scripts/journey/live-activity-signals.ts`, checked in CI); `LiveSessionInterpreterTests.testServerPushSignalsAgreeWithTheApp` recomputes each entry in Swift.
   - `planLiveActivityPush`: only a rider-confirmed bus; the push's timestamp is when its content was true (`progress.evidenceAt`); never one no newer than the last accepted; changed content at priority 5; unchanged content again after 60 s, to move its 120 s stale date; a milestone reached for the first time carries its alert (the app's own `ride.<milestone>` words, checked against `Localizable.strings`), once per ride. `planLiveActivityEnd`: `completed` content, dismissed after 60 s.
   - `LiveActivityPusher` runs after `GET /v1/sessions/:id` and after a confirmation, and before `DELETE`. It records what Apple accepted in the session row (`liveActivityPush.delivery`, kept across a token rotation), forgets a token Apple rejects, and never fails the rider's request: a 3 s budget, every failure logged by kind with the token's fingerprint only.
   - Wired in `apiRuntime.ts` only when `readApnsConfig` is enabled.
   - Tests: `liveActivityContent.test.ts`, `liveActivityPusher.test.ts`.
5. **Scheduler** — `DONE` in code (2026-10-03). The owner chose the Railway collector. Nothing is pushed until APNs is configured (`BLOCKED_BY_APPLE_ACCOUNT`).
   - **Push index.** A Redis set of session ids under the deployment's own session namespace (`TRANSIT_SESSION_KEY_PREFIX` + `push-index`; no session id may take that name). It holds ids only, never tokens.
     - The store keeps it in step with the rows, in the same compare-and-set script as each save: a saved row with a token is in the index, one without is not. A stored token therefore always has its entry, and every later save of the ride repeats the membership.
     - Ending the ride removes the entry after the row.
     - An entry can outlive its row (a TTL expiry, or a failure between the delete and the removal). The tick prunes it only if the row is gone or unchanged since the tick read it, so a token registered meanwhile keeps its entry.
   - **Tick.** `POST /operator/live-activity/tick` (operator bearer token, operator rate limit):
     - It samples up to 20 indexed sessions (`SRANDMEMBER`).
     - It refreshes each session not read in the last 15 s and runs `LiveActivityPusher.afterRead`, the same path an app read takes.
     - It prunes entries whose row is gone, expired or tokenless. An expired row stays, so the app still reads `410`.
     - It answers within 8 s. Work still in flight at the deadline is abandoned: a late refresh is an ordinary compare-and-set write, and an unfinished push is retried by the next tick.
     - It answers and logs counts only.
     - It answers `503 LIVE_ACTIVITY_PUSH_UNAVAILABLE` where APNs is not configured.
   - **Clock.** `services/api/src/liveActivityTicker.ts` runs in the collector (`backgroundServer.ts`) and calls the tick every 20 s.
     - It is off unless `LIVE_ACTIVITY_TICK_URL` (https, the tick route only) and `LIVE_ACTIVITY_TICK_TOKEN` (the API's operator token) are both set.
     - It never overlaps a running tick.
     - After a `503` or `401` it waits 5 minutes.
     - It logs only ticks that did something, and never the token.
     - The collector's `/health` reports it as `liveActivityTicker`.
     - The collector never reads the session store: sessions, their namespace and APNs stay with the API.
   - Tests: `liveActivityScheduler.test.ts`.
6. **Device evidence** — `BLOCKED_BY_PHYSICAL_DEVICE`.
   - A TestFlight build on an iPhone with Dynamic Island.
   - Record:
     - updates arrive while the phone is locked;
     - the three alerts each sound once;
     - a rotated token is re-registered;
     - an ended activity's token is rejected and dropped;
     - stale dates read as "확인 중".
   - Simulator runs are not evidence for this milestone.

## 4. Decisions

- **The server decides what to push.** The client registers a token and does nothing else. The matcher, freshness and milestone logic stay where they are, so the pushed content is the same `RideGuidancePolicy` result the app would show.
- **Diagnostics separate the failure kinds.** "APNs rejected the token", "our credential", "Apple throttled us", "APNs or the network failed", "ActivityKit never gave a token" (client) and "the app was suspended" (stale date) are different log events. Each kind has its own fix, and none of them is reported as another.
- **No push without the readiness to back it.** A push carries only the rider-confirmed bus's progress, never matcher output. That is unchanged at `READY_FOR_SHADOW`.

## 5. Reproduction

```bash
node --experimental-strip-types --test services/api/test/apns.test.ts
node --experimental-strip-types services/api/scripts/livePushFixture.ts   # regenerates fixtures/transit/live-activity-push.json
xcodebuild ... test   # TapsoActivityAttributesTests.testServerPushContentStateDecodesAsTheAppsContentState
```

## 6. Progress and next action

- 2026-10-01: milestone 1 done. Milestones 2–4 need no Apple account and come next. Milestones 5 and 6 are blocked as labelled.
- 2026-10-01: milestone 2 done (token route, storage, rewrite, health). The push index moved to milestone 5.
- 2026-10-01: milestone 3 done in code (device `UNVERIFIED`). The marketing page's "only with the app open" claim is now pinned to milestone 6, not to `pushType: nil`.
- 2026-10-02: milestone 4 done in code. Pushes follow the session's reads; while the app is suspended nothing reads it.
- 2026-10-03: milestone 5 done in code, on the Railway collector (owner's decision). Exact next action: the paid Apple team, then APNs configuration on the API; the scheduler needs nothing more.
- 2026-10-03: the ticker is live on the Railway collector (`tapso-ride-collector` / `collector`, deployment `bbe39acb`).
  - `LIVE_ACTIVITY_TICK_URL=https://tapso-api.vercel.app/operator/live-activity/tick`.
  - `LIVE_ACTIVITY_TICK_TOKEN=${{RIDE_CAPTURE_OPERATOR_TOKEN}}`, a Railway reference to the collector's own operator token, so no secret was copied.
  - Its first tick (03:07:17 UTC) logged `outcome: push_unavailable`. The API answered 503 because APNs is not configured, as expected. The ticker now asks every 5 minutes.
  - `VERIFIED`: the collector reaches the tick route, and its token is accepted.
    - Post-deploy run 37091931321 shows the API's operator route enabled ("operator path is closed: 401 without a token"). A disabled route would answer `503 OPERATOR_DISABLED`.
    - On an enabled route the token is checked before anything else, so a wrong token would have read `unauthorized`.
    - The 503 the ticker got is therefore `LIVE_ACTIVITY_PUSH_UNAVAILABLE`: the request passed the operator check and the sessions check, and stopped at the missing APNs configuration.
  - Rollback: delete the two variables.

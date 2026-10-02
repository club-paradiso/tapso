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
4. **Push on change** — `NEXT`, after 2.
   - When a session refresh changes the content state, push it (priority 5).
   - When a milestone is first reached, push it with its alert (priority 10).
   - Push `event: end` with a dismissal date when the ride ends.
   - Idempotency: record the last pushed `timestamp` and content per session, never push older content, and drop the token on `token_rejected`.
5. **Scheduler** — `BLOCKED_BY_INFRASTRUCTURE`. With it, an index of sessions that have a token: a set under the deployment's own session namespace (`TRANSIT_SESSION_KEY_PREFIX` + `push-index`), so nothing outside that namespace is read or written. Something must refresh sessions that have a token while the app is suspended: an operator-authenticated `POST /operator/live-activity/tick` that refreshes due sessions from the index, called every 15–30 s by an external scheduler. The scheduler is not chosen: Vercel Cron's minimum interval is a minute, GitHub Actions schedules are not reliable at minutes, and a small always-on worker is a new piece of infrastructure the owner must approve.
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
- Exact next action: milestone 4. Compute the content state on the server from the session (a port of `RideGuidancePolicy` checked against the Swift one through a shared fixture), push on change, and record what was last pushed.

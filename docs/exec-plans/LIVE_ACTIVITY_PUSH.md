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
2. **Token registration** — `NEXT`.
   - `PUT /v1/sessions/:id/live-activity` with `{ "pushToken": "<hex>" }` stores the token, its fingerprint and when it arrived in the session record. `DELETE` clears it. Ending the session clears it too.
   - Add the Vercel rewrite next to the existing session rewrites.
   - The session's TTL (4 h) bounds the token's life.
   - Index of sessions that have a token: a set under the deployment's own session namespace (`TRANSIT_SESSION_KEY_PREFIX` + `push-index`), so nothing outside that namespace is read or written.
   - Tests: input validation (hex, length), storage round trip, deletion on end, the namespace guard.
3. **App side** — `NEXT`, after 2. In the live ride of club-paradiso/tapso#76 (`TapsoAppModel`, `LiveActivityClient`):
   - Ask for `pushType: .token` only when the server reports push enabled (`/health` → `liveActivityPush.enabled`); otherwise keep `pushType: nil`, as today.
   - Observe `pushTokenUpdates` and register every new token: rotation is a re-registration.
   - On the end of the ride, the server clears the token.
   - Tests use a recording transport, as in `TapsoAPIClientTests`, and the session fixture `fixtures/journey/session-views-v1.json`.
4. **Push on change** — `NEXT`, after 2.
   - When a session refresh changes the content state, push it (priority 5).
   - When a milestone is first reached, push it with its alert (priority 10).
   - Push `event: end` with a dismissal date when the ride ends.
   - Idempotency: record the last pushed `timestamp` and content per session, never push older content, and drop the token on `token_rejected`.
5. **Scheduler** — `BLOCKED_BY_INFRASTRUCTURE`. Something must refresh sessions that have a token while the app is suspended: an operator-authenticated `POST /operator/live-activity/tick` that refreshes due sessions from the index, called every 15–30 s by an external scheduler. The scheduler is not chosen: Vercel Cron's minimum interval is a minute, GitHub Actions schedules are not reliable at minutes, and a small always-on worker is a new piece of infrastructure the owner must approve.
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
- Exact next action: milestone 2. Add the token route and rewrite, store the token in `StoredJourneySession` (optional field, no schema bump), add the `push-index` set inside the session namespace, and write the tests listed above.

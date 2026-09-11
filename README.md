# TAPSO

TAPSO is an iPhone-first Jeju bus ride companion: choose a route and destination, identify the physical bus, close the app, and get a glanceable warning before the destination. The primary surface during a ride is a native ActivityKit Live Activity and Dynamic Island, not a map.

This repository contains a production-shaped first vertical slice. Its deterministic demo runs the same vehicle matching, remaining-stop, journey-state, and ActivityKit paths intended for real data.

Public product site: [tapso-nu.vercel.app](https://tapso-nu.vercel.app)

## Current status

| Area | Status | Evidence |
|---|---|---|
| Swift transit core | `VERIFIED` | 38 Swift tests cover matching, progress, freshness, journey transitions, and debug evidence |
| Native iOS app | `VERIFIED` | Xcode simulator build includes the app and WidgetKit extension |
| Local 8 → 0 demo | `IMPLEMENTED` | 1×, 5×, 10×, and manual stepping use production domain types |
| Lock Screen / Dynamic Island | `VERIFIED` | iOS 26.3 iPhone 17 Pro Simulator: compact 8/2/1/0, expanded, Lock Screen, request/update/end; 4 iOS tests |
| TypeScript API scaffold | `VERIFIED` | Native Node tests cover matching and official-schema normalization |
| Live-transit pilot orchestration | `IMPLEMENTED` | Route-scoped read-through cache, concurrent-miss coalescing, short-lived ride sessions, ambiguity confirmation, monotonic progress, and bounded missing-data handling are covered by deterministic Node tests |
| Controlled ride capture tool | `IMPLEMENTED` | `scripts/ride-capture` polls one TAGO direction during a real ride, keeps raw snapshots under ignored `work/rides/`, and emits a pseudonymised progression/freshness report; 6 Node tests. No real ride captured yet |
| Marketing website | `IMPLEMENTED` | React + Vite site under `apps/web`; 제주어 hero, responsive QA, and Vercel deployment workflow |
| Waitlist backend | `IMPLEMENTED` | Vercel Functions in `apps/web/api`; validation, duplicate protection, rate limiting, and confirmation email covered by 90 Node tests |
| Waitlist against live Supabase and Resend | `BLOCKED_BY_CREDENTIALS` | No project, key, or verified sending domain; see `docs/WAITLIST_SUPPORT_SETUP.md` |
| Support payment | `NOT ENABLED` | Toss Payments adapter, state machine, and webhook reconciliation are implemented and tested; no merchant account exists |
| Official API contract | `VERIFIED` | TAGO route/location schemas inspected from resources 15098529 and 15098533 |
| Live Jeju response quality | `VERIFIED_WITH_LIMIT` | HTTP 200/00; city 39, six Route 365 variants, real stops, and ten daytime vehicles across both full-length directions verified. TAGO provides no source observation timestamp, so automatic matching remains withheld. See [capture](docs/validation/TAGO_2026-09-11.md). |
| Remote APNs updates | `BLOCKED_BY_CREDENTIALS` | Requires Apple team, bundle, and APNs signing credentials |
| Physical-device validation | `UNVERIFIED` | Requires a signed device build and real Dynamic Island hardware |

## Quick start

Prerequisites: macOS, Xcode 26 or another stable Xcode supporting iOS 17, Swift 6, XcodeGen, and Node 22.18+.

```bash
swift test --package-path packages/transit-core
npm test --prefix services/api
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

Open `apps/ios/Tapso.xcodeproj`, run the `Tapso` scheme, then choose **Start demo ride** and allow Live Activities when iOS asks. The demo begins at eight stops remaining and supports accelerated or manual progression. Press Home to inspect compact mode and touch and hold the Island for the expanded journey surface.

To probe official TAGO data, store the new **Decoding** key in ignored `.env.local` as `PUBLIC_DATA_SERVICE_KEY`, with permissions `0600`. Never put it on the command line or in the iOS/web client. See [data validation](docs/DATA_VALIDATION.md).

```bash
mkdir -p work
python3 scripts/tago/probe.py > work/tago-probe.json
env -u PUBLIC_DATA_SERVICE_KEY node --env-file=.env.local --experimental-strip-types services/api/src/server.ts
```

The probe resolves official city and route IDs before fetching stops and locations. The API uses `cityCode`; former `stdgCd` values are not interchangeable. TAGO has no documented measurement timestamp, so automatic matching remains withheld when freshness is unknown.

Pilot endpoints:

```text
GET  /v1/cities
GET  /v1/routes?cityCode=…&routeNo=365
GET  /v1/stops?routeId=…&cityCode=…
GET  /v1/vehicles?routeId=…&cityCode=…
POST /v1/sessions
GET  /v1/sessions/:id
POST /v1/sessions/:id/confirm
```

Session creation takes `cityCode` in its JSON body. Sessions remain short-lived and in memory.

To run the public product website locally:

```bash
npm install --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
npm run dev --prefix apps/web
```

The site runs with no credentials. In that state `/api/waitlist` answers
`503 unavailable` and the form says so rather than claiming a registration was
stored. Copy `apps/web/.env.example` and read
[WAITLIST_SUPPORT_SETUP.md](docs/WAITLIST_SUPPORT_SETUP.md) to provision it.

## Repository map

- `apps/ios`: SwiftUI app, Live Activity extension, localized resources, and iOS tests.
- `apps/web`: Korean-first responsive product website, plus the waitlist and
  support serverless endpoints in `apps/web/api` and their schema in
  `apps/web/supabase/migrations`.
- `packages/transit-core`: UI-independent Swift domain, matching, progress, and state machine.
- `services/api`: TypeScript official-data normalization, shared route cache, matching, in-memory pilot ride sessions, and future APNs boundary.
- `fixtures/transit`: explicitly synthetic deterministic data.
- `scripts/transit-spike`: credential-gated official API probe.
- `docs`: product, architecture, evidence, risk, device plan, and handoff material.

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DATA_VALIDATION.md](docs/DATA_VALIDATION.md), and [HANDOFF.md](docs/HANDOFF.md) before connecting real data.

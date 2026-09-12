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
| Live-transit orchestration | `IMPLEMENTED` | Route-scoped read-through cache, concurrent-miss coalescing, short-lived ride sessions, ambiguity confirmation, monotonic progress, and bounded missing-data handling are covered by deterministic Node tests |
| Production-shaped transit API | `IMPLEMENTED` | One request handler in `services/api/src/apiRouter.ts` with a local Node transport and a Vercel Functions transport; identifier validation, deny-by-default CORS, per-caller burst limits, CDN cache windows, and structured logging; 68 Node tests plus an end-to-end HTTP run of the credentialed, uncredentialed, and serverless-shaped configurations |
| Transit API deployment | `DEPLOYED_NOT_PROBED` | Live at [tapso-api.vercel.app](https://tapso-api.vercel.app) from the `tapso-api` Vercel project; `TAGO_SERVICE_KEY` is set on Production as a Sensitive variable. No HTTP response has been observed from an agent session — every one has run behind an egress policy denying `*.vercel.app` — so live behaviour is not independently verified; see [PRODUCTION_TRANSIT_API.md](docs/PRODUCTION_TRANSIT_API.md) |
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

To probe official TAGO data, store the new **Decoding** key in ignored `.env.local` as `TAGO_SERVICE_KEY`, with permissions `0600`. Never put it on the command line or in the iOS/web client. See [data validation](docs/DATA_VALIDATION.md).

The retired name `PUBLIC_DATA_SERVICE_KEY` still works locally so an existing `.env.local` keeps running, but it is ignored on Vercel — a `PUBLIC_` prefix is a public framework variable there and cannot hold a Sensitive secret. Rename your local copy.

```bash
mkdir -p work
python3 scripts/tago/probe.py > work/tago-probe.json
env -u TAGO_SERVICE_KEY node --env-file=.env.local --experimental-strip-types services/api/src/server.ts
```

The probe resolves official city and route IDs before fetching stops and locations. The API uses `cityCode`; former `stdgCd` values are not interchangeable. TAGO has no documented measurement timestamp, so automatic matching remains withheld when freshness is unknown.

Endpoints:

```text
GET  /health
GET  /v1/cities
GET  /v1/routes?cityCode=…&routeNo=365
GET  /v1/stops?routeId=…&cityCode=…
GET  /v1/vehicles?routeId=…&cityCode=…
POST /v1/matches
POST /v1/sessions
GET  /v1/sessions/:id
POST /v1/sessions/:id/confirm
```

The canonical production base URL is `https://tapso-api.vercel.app`. The same paths are served locally and in production. Session creation takes `cityCode` in its JSON body; sessions are short-lived and held in one process's memory, so they are disabled by default on serverless deployments and answer `503 SESSIONS_UNAVAILABLE` there. The full contract, configuration, deployment, smoke-test, and rollback procedure is in [PRODUCTION_TRANSIT_API.md](docs/PRODUCTION_TRANSIT_API.md).

```bash
node --experimental-strip-types services/api/scripts/smoke.ts http://127.0.0.1:8787
```

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
- `services/api`: the transit API. Official-data normalization, shared route cache, matching, in-memory ride sessions, and the future APNs boundary, behind one request handler served by a local Node transport and by Vercel Functions in `services/api/api`. Deploys from its own Vercel project rooted at `services/api`.
- `fixtures/transit`: explicitly synthetic deterministic data.
- `scripts/transit-spike`: credential-gated official API probe.
- `docs`: product, architecture, evidence, risk, device plan, and handoff material.

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DATA_VALIDATION.md](docs/DATA_VALIDATION.md), and [HANDOFF.md](docs/HANDOFF.md) before connecting real data.

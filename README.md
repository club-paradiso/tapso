# TAPSO

TAPSO is an iPhone-first Jeju bus ride companion: choose a route and destination, identify the physical bus, close the app, and get a glanceable warning before the destination. The primary surface during a ride is a native ActivityKit Live Activity and Dynamic Island, not a map.

This repository contains a production-shaped first vertical slice. Its deterministic demo runs the Swift core's remaining-stop and journey-state logic and the ActivityKit paths on synthetic fixtures. Vehicle matching is not shared with it: real journey sessions are matched on the server by the TypeScript `directed-route-progress-v1` policy, and the Swift `VehicleMatchingEngine` drives only the demo and is not authoritative (see [VEHICLE_MATCHING.md](docs/VEHICLE_MATCHING.md)).

Public product site: [tapso-nu.vercel.app](https://tapso-nu.vercel.app)

## Current status

| Area | Status | Evidence |
|---|---|---|
| Swift transit core | `VERIFIED` | Swift tests (CI job `transit-core`) cover progress, freshness, journey transitions, debug evidence, and the demo-only `VehicleMatchingEngine` |
| Native iOS app | `VERIFIED` | CI job `ios` builds the committed project (app + WidgetKit extension) and runs its tests on an iPhone simulator on every push |
| Product V2 ride-companion UX | `IMPLEMENTED` on synthetic data | Destination-first setup, one-tap repeat rides, rider-confirmed vehicle check, distinct riding / two-stop / next-stop / arrival / passed layouts, calm delayed / lost / offline / checking states, relaunch recovery, paste intake from map apps, NAVER Map hand-off. One `RideGuidancePolicy` in the Swift core drives the app, Lock Screen and Dynamic Island. Simulator snapshot evidence in Korean and English from CI. See [docs/product](docs/product/) |
| Local demo scenarios | `IMPLEMENTED` | Synthetic scripts (smooth, similar buses, no bus yet, delayed data, bus lost, offline, passed destination) at 1×, 5× or manual steps, applied through `RideSession` |
| Lock Screen / Dynamic Island | `VERIFIED` (simulator) | V2 surfaces rendered for every ride moment by `SnapshotEvidenceTests` in CI (island regions inside a drawn outline); the V1 surfaces were checked on an iOS 26.3 iPhone 17 Pro Simulator on the build host. Physical device `UNVERIFIED` |
| TypeScript API scaffold | `VERIFIED` | Native Node tests cover matching and official-schema normalization |
| Live-transit orchestration | `IMPLEMENTED` | Route-scoped read-through cache, concurrent-miss coalescing, short-lived ride sessions, ambiguity confirmation, monotonic progress, and bounded missing-data handling are covered by deterministic Node tests |
| Production-shaped transit API | `IMPLEMENTED` | One request handler in `services/api/src/apiRouter.ts` with a local Node transport and a Vercel Functions transport; identifier validation, deny-by-default CORS, per-caller burst limits, CDN cache windows, and structured logging; Node tests (CI job `api`) plus an end-to-end HTTP run of the credentialed, uncredentialed, and serverless-shaped configurations |
| Transit API in production | `VERIFIED` | Live at [tapso-api.vercel.app](https://tapso-api.vercel.app) from the `tapso-api` Vercel project, build `b59e9e60b863`. 2026-09-12 production run: `/health` 200 with `credential.source: "canonical"`, live TAGO through `/v1/cities`, all six Route 365 variants, 43 ordered stops on `JEB405136521`, four live vehicles, JSON 404 contract, and sessions `503` by design. No unexpected production error in runtime logs; see [PRODUCTION_TRANSIT_API.md](docs/PRODUCTION_TRANSIT_API.md). Once merged, the scheduled production smoke in `.github/workflows/matcher-evidence.yml` re-checks it, matching posture included |
| Vehicle matcher | `VERIFIED_BY_TEST` | `directed-route-progress-v1` (`services/api/src/matching.ts`) serves journey sessions and `POST /v1/matches`. Before evidence establishes that the rider is aboard, no automatically selected bus may be at or past the boarding stop; `assertDirectedInvariant` checks every result. The legacy `symmetric-stop-distance-v0` survives only for comparison and negative controls, and no serving module reaches it. See [VEHICLE_MATCHING.md](docs/VEHICLE_MATCHING.md) |
| Matcher readiness | `READY_FOR_SHADOW` | Awarded by release gate `matcher-passive-safety-v4` (`services/api/src/matcherSafetyGate.ts`); CI fails if the readiness the code claims (`services/api/src/matchingReadiness.ts`) differs from the committed gate result. Automatic matching is off by default, and the configuration refuses `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true` below `READY_FOR_BOUNDED_AUTOMATION` and says so in `/health`. See [MATCHER_SAFETY_EVIDENCE_V4.md](docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md) |
| Passive Shadow Validation v3 | `VERIFIED_LIVE_PASSIVE` | Rider-free, bounded collection of real route trajectories, turned into blind pseudo-boarding cases and replayed through the production matcher; ground truth is held in a vault opened only after replay. First live run (1 h, 5 route IDs), under the matcher of the time (`symmetric-stop-distance-v0`): 268 wrong commits, all to buses that had already left the rider's stop (finding F1). See [PASSIVE_SHADOW_VALIDATION_V3_RESULTS.md](docs/validation/PASSIVE_SHADOW_VALIDATION_V3_RESULTS.md) |
| Former wrong commits under the directed matcher | `VERIFIED_BY_REPLAY` | All 268 re-decided at their commit instants from the hash-checked ledger: the directed policy selects none, and the legacy policy reproduces all 268. Instant level only. See [FORMER_WRONG_COMMITS_UNDER_DIRECTED_POLICY.md](docs/validation/FORMER_WRONG_COMMITS_UNDER_DIRECTED_POLICY.md) |
| Rider-free evidence path | `MISSING` | Missing until `.github/workflows/matcher-evidence.yml` runs after merge: the full-window replay of the raw v3 streams, counterfactuals on real bases (so far only on synthetic ones: `SIMULATED`), and new passive windows. The workflow replays the evidence of record on the merge commit, copying its raw artifact, which expires on 2026-10-09T06:28:03Z, and collects one bounded passive window a day. CI already runs the property suite, negative controls and the instant re-decision. No readiness level up to `READY_FOR_CONFIRMATION_ASSISTED` needs a bus ride. See [HUMAN_LABOR_ELIMINATION.md](docs/exec-plans/HUMAN_LABOR_ELIMINATION.md) |
| Controlled ride capture tool | `HISTORICAL` | Not required since 2026-09-29: no readiness level the product targets asks for a human ride. `scripts/ride-capture` polls one TAGO direction during a real ride, keeps raw snapshots under ignored `work/rides/`, and emits a pseudonymised progression, cadence, GPS and freshness report that states `INSUFFICIENT_EVIDENCE` rather than guessing; the rider gets the stop list up front and the boarded bus is cross-checked against the live snapshot; Node tests plus a synthetic dry rehearsal of the whole operator flow. No real ride captured yet |
| Mobile ride capture controller | `HISTORICAL` | Not required since 2026-09-29: no readiness level the product targets asks for a human ride. Operator-only page at `tapso-api.vercel.app/ride-capture/` for running a controlled ride on any Jeju route from a phone: bus number in, official variants out, stops picked by name, a per-route compatibility verdict, tap-to-board with masked plates, tap-to-mark physical stops, IndexedDB persistence, wake lock, local history, and lifecycle gaps recorded as the instrument's rather than the provider's. Polls an authenticated uncached snapshot path so the 20-second public cache never contaminates cadence evidence; Node tests plus a rendered-UI sweep at four iPhone viewports in light and dark. Thirteen historical real-ride reports carry capture source `web-controller`, a tag this page, the quick page and the Railway collector all write, so which produced each is not recorded; none kept its raw capture, so all are `REPORT_ONLY_NO_RAW` and contribute no matcher result. See [RIDE_CAPTURE_CONTROLLER.md](docs/RIDE_CAPTURE_CONTROLLER.md) and [DATA_VALIDATION.md](docs/DATA_VALIDATION.md) |
| Marketing website | `IMPLEMENTED` | Marketing Site V3 under `apps/web` (React + Vite, prerendered): one synthetic ride told by the Dynamic Island, from choosing where to get off through the rider's bus confirmation (where the Live Activity starts) to arrival, with a persistent island that follows the story, then map apps, privacy, development status, waitlist, support and FAQ. Every device is a labelled preview on synthetic data; product copy, ride moments and the story's rules are tested against the iOS strings, `RideGuidancePolicy` and `TapsoAppModel`. See [MARKETING_SITE_V3.md](docs/product/MARKETING_SITE_V3.md) |
| Waitlist backend | `IMPLEMENTED` | Vercel Functions in `apps/web/api`; validation, duplicate protection, rate limiting, and confirmation email covered by Node tests (CI job `web`) |
| Waitlist against live Supabase and Resend | `BLOCKED_BY_CREDENTIALS` | No project, key, or verified sending domain; see `docs/WAITLIST_SUPPORT_SETUP.md` |
| Support payment | `NOT ENABLED` | Toss Payments adapter, state machine, and webhook reconciliation are implemented and tested; no merchant account exists |
| Official API contract | `VERIFIED` | TAGO route/location schemas inspected from resources 15098529 and 15098533 |
| Live Jeju response quality | `VERIFIED_WITH_LIMIT` | HTTP 200/00; city 39, six Route 365 variants, real stops, and ten daytime vehicles across both full-length directions verified. TAGO provides no source observation timestamp, so automatic matching remains withheld. See [capture](docs/validation/TAGO_2026-09-11.md). |
| Remote APNs updates | `BLOCKED_BY_CREDENTIALS` | Requires Apple team, bundle, and APNs signing credentials |
| Physical-device validation | `UNVERIFIED` | Requires a signed device build and real Dynamic Island hardware. A device check, not a ride; the release gate needs its Live Activity part (criterion BA-5) only for `READY_FOR_BOUNDED_AUTOMATION` |

## Quick start

Prerequisites: macOS, Xcode 26 or another stable Xcode supporting iOS 17, Swift 6, XcodeGen, and Node 22.18+.

```bash
swift test --package-path packages/transit-core
npm test --prefix services/api
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

Open `apps/ios/Tapso.xcodeproj` and run the `Tapso` scheme. Search for where you get off (or tap **샘플 여정 체험하기**), confirm the proposed bus, then press Home to watch the Dynamic Island and lock the phone for the Lock Screen. The **체험 설정** sheet picks a synthetic scenario and playback speed. Everything the app shows is synthetic: it makes no network request.

After adding or removing a Swift file under `apps/ios`, run `python3 scripts/ios/sync_xcodeproj.py` (or regenerate with XcodeGen) and `python3 scripts/ios/check_localization.py`.

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
DELETE /v1/sessions/:id
POST /v1/sessions/:id/confirm
```

The canonical production base URL is `https://tapso-api.vercel.app`. The same paths are served locally and in production. Session creation takes `cityCode` in its JSON body; sessions are short-lived and, by default, held in one process's memory, so serverless deployments disable them and answer `503 SESSIONS_UNAVAILABLE` unless a durable Upstash store is configured (`TRANSIT_SESSION_STORE=redis`; see [ARCHITECTURE.md](docs/ARCHITECTURE.md)). A production deployment serves sessions only from the `tapso:prod:journey-session:` namespace, and `DELETE` ends a ride. Enabling them in production is four environment variables on the `tapso-api` project ([PRODUCTION_TRANSIT_API.md](docs/PRODUCTION_TRANSIT_API.md) → *Enabling durable sessions in production*). The full contract, configuration, deployment, smoke-test, and rollback procedure is in [PRODUCTION_TRANSIT_API.md](docs/PRODUCTION_TRANSIT_API.md).

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
- `packages/transit-core`: UI-independent Swift domain, progress, state machine, and the demo-only matcher.
- `services/api`: the transit API. Official-data normalization, shared route cache, the directed matcher and its release gate, journey sessions (in memory or an Upstash store), and the future APNs boundary, behind one request handler served by a local Node transport and by Vercel Functions in `services/api/api`. Deploys from its own Vercel project rooted at `services/api`.
- `fixtures/transit`: explicitly synthetic deterministic data, including the language-neutral matcher specification cases.
- `scripts/matcher-evidence`: offline release-gate tooling: the suite with its deep property run (`run-suite.ts`), the re-decision of the former live wrong commits (`redecide-ledger.ts`, rendered by `render-instants.ts`), the counterfactual suite over synthetic bases (`counterfactual-synthetic.ts`, `SIMULATED`), the gate's live inputs from retained raw collections (`live-evidence.ts`), and the gate (`gate.ts`, run with `--check` in CI).
- `scripts/negative-controls`: mutation-based negative controls. Each puts back one leakage path or removes one fail-closed rule in a temporary copy of `services/api`, and the suite must fail.
- `scripts/passive-shadow`: rider-free passive evidence. `collect.ts` makes a bounded, read-only live collection; `evaluate.ts`, `migrate.ts` (legacy versus directed) and `counterfactual.ts` replay a raw collection offline, refuse any network access, and never modify the raw files. Raw collections hold vehicle numbers and stay out of Git.
- `scripts/transit-spike`: credential-gated official API probe.
- `ops`: requests read by workflows. A change to `ops/matcher-evidence/request.json` on `main` runs its request once, and its `collect` section drives the scheduled windows; `ops/matcher-evidence/human-only-mitigations.json` declares the architecture responses the gate reads; `ops/passive-shadow-v3/collection-request.json` drives the Passive Shadow v3 workflow.
- `artifacts`: committed, sanitized evidence: the Passive Shadow v3 summary and wrong-commit ledger (the evidence of record), `matcher-directed-v1/` (suite, negative-control and instant re-decision results, and a counterfactual summary on synthetic bases, labelled `SIMULATED`), and the gate result `matcher-passive-safety-v4/gate-result.json`.
- `docs`: product, architecture, evidence, risk, device plan, and handoff material.

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DATA_VALIDATION.md](docs/DATA_VALIDATION.md), and [HANDOFF.md](docs/HANDOFF.md) before connecting real data.

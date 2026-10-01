# Product V3: Jeju-native mobility companion

Living ExecPlan (`.agent/PLANS.md`). Started 2026-10-01 from `main` at
`71c99b1`. A contributor must be able to resume from this file and the
repository alone.

## User-visible outcome

TAPSO stops being "an app that tells you when to get off a Jeju bus" and becomes
the Jeju companion that helps a rider decide where to go, get there by bus, know
when to act, recover when plans break, and get home safely:

```text
GO → RIDE → DISCOVER → RETURN, with TRANSFER, RESCUE, MEMORY and SHARE supporting
```

Jeju is the product. No national generalisation, no abstraction added only
because it looks scalable.

## Non-goals

- Raising matcher readiness by configuration. Readiness moves only through
  release gate `matcher-passive-safety-v4` evidence in a reviewed pull request
  (`docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md`). Automatic matching stays off.
- Continuous passenger GPS. TAPSO tracks the bus.
- A proprietary restaurant or tourism database, review scores, a home-screen
  chatbot, streaks or XP.
- Inventing endpoints, fields, timetables, opening hours or platform behaviour.
  Where data is missing the product says so (`unknown`) and degrades.

## Verified constraints and assumptions

| Constraint | Label | Evidence (2026-10-01) |
|---|---|---|
| `main` CI was red: `transit-core` failed since `cd806f6` (demo destination renamed, test query not) | `VERIFIED` | CI runs `36826388735`, `36827463677`; fix exists as `fadd886` on PR #71, ported here unchanged |
| Production `tapso-api` has only `TAGO_SERVICE_KEY` and `RIDE_CAPTURE_OPERATOR_TOKEN` for Production; Upstash and session variables exist only for one Preview branch | `VERIFIED` | Vercel project `prj_XTimnEWdrhaDMSJfgELHzQAo3Nn2` environment listing (names only, values never read) |
| Production journey sessions therefore answer `503 SESSIONS_UNAVAILABLE` | `VERIFIED_FROM_DOC` | `KNOWN_ISSUES.md` (`BLOCKED_BY_ACCESS`, production smoke run `36804898273`) |
| Production deployment of `tapso-api` is `main@71c99b1` | `VERIFIED` | deployment `dpl_BnV2Z4nyH7eEkpnk6p5351A42uzE`, target production, READY |
| This agent environment cannot reach `tapso-api.vercel.app`, `tapso-nu.vercel.app`, `apis.data.go.kr`, `www.data.go.kr`, `download.swift.org`, or the Actions artifact blob store; it can reach `developer.apple.com` and GitHub | `VERIFIED` | proxy `connect_rejected` for each (also `www.apple.com`, `apis.map.kakao.com`, `map.kakao.com`, `map.naver.com`, `guide.ncloud-docs.com`); GitHub-hosted runners reach production and are used for anything that needs it |
| No Swift toolchain locally | `VERIFIED` | Swift and iOS changes are verified by CI (`transit-core`, `ios` jobs on `macos-15`) |
| Matcher readiness is `READY_FOR_SHADOW`; issue #61 (F21) is being worked in PR #71 by another session (F22, F24) | `VERIFIED` | PR #71 head `e96f0da`, CI green, real-base gate evidence run `36871560482` in progress at 14:50 UTC |
| Paid Apple Developer Program membership is absent (Personal Team `89CGFQ24U5`) | `VERIFIED_FROM_DOC` | `KNOWN_ISSUES.md` › `BLOCKED_BY_PAID_MEMBERSHIP`; TestFlight, APNs and physical Dynamic Island checks wait on it |
| App Groups work on a free Personal Team; push notifications do not | `VERIFIED` | developer.apple.com › Account Help › Supported capabilities (iOS), read 2026-10-01 (App groups: ADP, ADEP and Apple Developer columns all checked) |
| TAGO publishes no observation timestamp and no timetable in the services TAPSO uses | `VERIFIED_FROM_DOC` | `DATA_VALIDATION.md`, `validation/TAGO_2026-09-11.md`; Safe Return and Transfer Guardian treat headway and last departures as inputs that may be `unknown` |

## Milestones

Release hierarchy from the mission; scope defense order: reliable ride, safe
return, transfer, rescue, handoff, discovery, eat, passport/share, mystery.

| # | Milestone | Observable completion | Status |
|---|---|---|---|
| V2.1a | CI green on `main` | `transit-core` job green on the PR | `DONE` (#72 merged) |
| V2.1b | Reliability taxonomy | `PROVIDER_TIMEOUT` 504, `PROVIDER_UNAVAILABLE` 502, `PROVIDER_RESPONSE_INVALID` 502, `INTERNAL_ERROR` 500 and an empty list are distinct; tests in `tagoProvider.test.ts`, `apiRouter.test.ts` | `DONE` in PR A |
| V2.1c | Journey Contract v1 | Same specification passes in Node and Swift (`JOURNEY_CONTRACT_V3.md`) | `DONE` in PR A (Swift pending CI) |
| V2.1d | Production durable sessions | `/health` reports `sessions.store=redis`, namespace `production`; post-deploy session smoke passes | `BLOCKED_BY_CREDENTIALS`: four Production variables on `tapso-api` (runbook in `PRODUCTION_TRANSIT_API.md`) |
| V2.1e | iOS real Journey Session integration | Live mode creates, refreshes, confirms and ends a session against the API; demo stays synthetic; guard test proves no real data reaches the Swift matcher | `IMPLEMENTED` (PR C), app side pending CI; production `BLOCKED_BY_CREDENTIALS` (V2.1d) |
| V2.2 | Map Handoff | Share Extension accepts KakaoMap, NAVER Map, Apple Maps, URLs, coordinates, addresses and names; parser tests; Journey Contract created from a handoff | `IMPLEMENTED` (PR D, `MAP_HANDOFF_V3.md`); device run `UNVERIFIED` |
| V2.3 | Core riding | Live Activity V3 states from `resolveSurface`; push-token registration endpoint; Transfer Guardian in the ride | `PENDING`; remote updates `BLOCKED_BY_PAID_MEMBERSHIP` (APNs); Transfer Guardian needs a planned transfer (no source) |
| V2.4 | Jeju safety layer | Safe Return, Rescue engines with deterministic tests (no-return rejection, long headway, expired data) | `DONE` for the engines (#73 merged); last-bus data path and end-screen card `IMPLEMENTED` (PR E); Rescue for a passed destination `IMPLEMENTED` (#83, `PassedStopRescue`); the last-bus countdown on the Lock Screen `IMPLEMENTED` (PR G, `TapsoReturnAttributes`); missed-connection and wrong-direction rescue and Transfer Guardian wait on planned transfers (no route planner or transfer data) |
| V3.0 | Jeju discovery | 오늘 뭐하젠?, 그냥 탑서 (filtered before randomisation), route experiences grounded in live route data | `PENDING`: no verified place source yet |
| V3.1 | Transit Fit | Semantic accessibility summary, no fake scores | `PENDING` |
| V3.2 | Eat | Transit-aware food situations | `PENDING` |
| V3.3 | Drop, Passport, Share | Editorial 1–3 picks; on-device passport; share card | `PENDING` |
| V3.4 | Roulette / Mystery Ride | Experimental | `PENDING` |
| WEB | Marketing site V3 | GO/RIDE/DISCOVER/RETURN story, semantic Dynamic Island engine, availability labels, reduced-motion static, 4-width visual QA | `PENDING` (PR G) |
| FIGMA | Product V3 file | Pages 00–13, variables synced to code tokens, V3 components | `PENDING` |

## Decisions

- **Shared contract as a specification file, two implementations.** The
  matcher already uses this pattern (`fixtures/transit/directed-matcher-invariants.json`).
  One JSON file, Node and Swift tests over the same cases, so drift fails CI.
  *Rejected:* generating Swift from TypeScript (no toolchain for it here, and a
  generator is more machinery than six small pure functions).
- **Provider failures as subclasses of `ProviderResponseError`.** Every existing
  catch path (session degradation, collectors, ride capture) keeps working, and
  the router can still answer with a distinct code. *Rejected:* a new error
  family, which would have silently bypassed `absorbProviderFailure`.
- **Discovery hints only on the final ride.** Proposing a detour while a
  connection is planned trades a planned journey for a suggestion.

## Reproduction

```bash
npm --prefix services/api test
(cd apps/web && npm ci && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
swift test --package-path packages/transit-core   # macOS / CI
```

## Progress

- 2026-10-01 15:00 UTC — inspection complete (repository, PRs #70 #71, issue
  #61, Vercel projects and environment names, CI history, code and docs).
- PR A #72 (`claude/v21-production-foundation`): transit-core test fix ported,
  provider error taxonomy, Journey Contract v1. CI `transit-core` green
  (Swift contract compiles and passes).
- PR B #73 (`claude/v24-jeju-safety-core`, on #72): Safe Return, Transfer
  Guardian, Rescue — 38 specification cases and generated properties, Node and
  Swift.
- PR C (`claude/v21-ios-live-journey`, on #72): live rides through
  `TapsoAPIClient`; server-generated session payloads
  (`scripts/journey/session-views.ts`, checked current by
  `sessionViews.test.ts`); network guard rewritten and shown to fail on a
  violation (a network API added to `HomeView.swift`, the client's host
  changed: both turned the suite red, then reverted).

- 2026-10-01 15:55 UTC — #73 merged after re-verifying the combined state
  (`main@665a431` + PR B: services/api 782/782, typecheck clean, no Swift
  type collisions).
- PR D (`claude/v22-map-handoff`, on PR C): `SharedPlaceParser`, `HandoffInbox`,
  `HandoffStopSuggester`, `HandoffJourney` in the core; the `TapsoShare`
  extension with the App Group; paste and share-sheet intake, nearest-stop
  suggestions in live setup, the walk to the shared place through NAVER Map,
  KakaoMap and Apple Maps. Found on the way: the V2 end screen never showed its
  KakaoMap button even when coordinates were real (fixed).

- PR E (`claude/v24-safe-return-service-hours`, on PR D): `GET /v1/route-info`
  from TAGO `getRouteInfoIem` (fields REPORTED-OFFICIAL from the probe), `LastBus`
  through the Safe Return engine, and the end screen's "돌아갈 때 막차" card.
- `git fetch` is refused by this session's permission classifier since
  2026-10-01 ~15:50 UTC. Integration is verified by rebuilding `main` locally
  from heads fetched before that (#72, #73 = `aeacb17`, #75 = `f1b3e16`, #76 =
  `a811855`); the islandStory blob matched `main`. #75 and #76 together turned
  `main`'s `web` job red; #79 fixes the test.

- 2026-10-01 17:04 UTC — #79 merged (`c5dc149`); #78 updated from `main` on
  the server (`update_pull_request_branch`, no local fetch).
- PR F (`claude/v24-rescue-passed-stop`, on PR E): `PassedStopRescue` reads the
  Rescue engine for the passed destination — the next stop after the bus's last
  position, straight-line metres only between surveyed stops, map app last, no
  ride back without a verified opposite direction — and the ride screen shows it.
  The Lock Screen, island and VoiceOver name the exit too (#83).
- PR G (`claude/v24-return-countdown`, on #83): "돌아갈 시간", a second Live
  Activity type the rider starts from the last-bus card; the system runs its
  countdown (`Text(timerInterval:)`), so it needs no push. Bounds from Apple's
  eight-hour limit (VERIFIED) and a 5-minute floor (ASSUMED).
- Transfer Guardian in a live ride stays unbuilt: `/v1/vehicles` can place the
  connecting bus, but without TAGO arrival predictions (dataset 15098530,
  `vehicletp` and `arrtime`, awaiting the owner's data.go.kr authorization) the
  connection window would come from an assumed per-stop band and mostly read
  `unknown`. Transit Fit's low-floor field lives in the same dataset.

## Risks and unexpected findings

- `main` had been red since `cd806f6`; any PR based on it inherits the red
  `transit-core` check until the fix lands.
- Production sessions cannot be enabled from this environment: the Upstash
  credentials are Sensitive values only the owner holds.

## Exact next action

Merge #78 (PR D) once CI is green on its `main` merge; retarget #82 (PR E) to
`main`, update it from `main`, merge; then PR F (Rescue) the same way. After
that: Live Activity V3 states from `resolveSurface` (recovery on the Lock
Screen), then Discovery once a verified place source exists.

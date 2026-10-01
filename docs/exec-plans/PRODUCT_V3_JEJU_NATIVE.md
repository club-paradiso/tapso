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
| This agent environment cannot reach `tapso-api.vercel.app`, `tapso-nu.vercel.app`, `apis.data.go.kr`, `www.data.go.kr`, `download.swift.org`, or the Actions artifact blob store; it can reach `developer.apple.com` and GitHub | `VERIFIED` | proxy `connect_rejected` for each; GitHub-hosted runners reach production and are used for anything that needs it |
| No Swift toolchain locally | `VERIFIED` | Swift and iOS changes are verified by CI (`transit-core`, `ios` jobs on `macos-15`) |
| Matcher readiness is `READY_FOR_SHADOW`; issue #61 (F21) is being worked in PR #71 by another session (F22, F24) | `VERIFIED` | PR #71 head `e96f0da`, CI green, real-base gate evidence run `36871560482` in progress at 14:50 UTC |
| Paid Apple Developer Program membership is absent (Personal Team `89CGFQ24U5`) | `VERIFIED_FROM_DOC` | `KNOWN_ISSUES.md` › `BLOCKED_BY_PAID_MEMBERSHIP`; TestFlight, APNs, App Groups on device and physical Dynamic Island checks wait on it |
| TAGO publishes no observation timestamp and no timetable in the services TAPSO uses | `VERIFIED_FROM_DOC` | `DATA_VALIDATION.md`, `validation/TAGO_2026-09-11.md`; Safe Return and Transfer Guardian treat headway and last departures as inputs that may be `unknown` |

## Milestones

Release hierarchy from the mission; scope defense order: reliable ride, safe
return, transfer, rescue, handoff, discovery, eat, passport/share, mystery.

| # | Milestone | Observable completion | Status |
|---|---|---|---|
| V2.1a | CI green on `main` | `transit-core` job green on the PR | `IN_PROGRESS` (PR A) |
| V2.1b | Reliability taxonomy | `PROVIDER_TIMEOUT` 504, `PROVIDER_UNAVAILABLE` 502, `PROVIDER_RESPONSE_INVALID` 502, `INTERNAL_ERROR` 500 and an empty list are distinct; tests in `tagoProvider.test.ts`, `apiRouter.test.ts` | `DONE` in PR A |
| V2.1c | Journey Contract v1 | Same specification passes in Node and Swift (`JOURNEY_CONTRACT_V3.md`) | `DONE` in PR A (Swift pending CI) |
| V2.1d | Production durable sessions | `/health` reports `sessions.store=redis`, namespace `production`; post-deploy session smoke passes | `BLOCKED_BY_CREDENTIALS`: four Production variables on `tapso-api` (runbook in `PRODUCTION_TRANSIT_API.md`) |
| V2.1e | iOS real Journey Session integration | Live mode creates, refreshes, confirms and ends a session against the API; demo stays synthetic; guard test proves no real data reaches the Swift matcher | `PENDING` (PR C) |
| V2.2 | Map Handoff | Share Extension accepts KakaoMap, NAVER Map, Apple Maps, URLs, coordinates, addresses and names; parser tests; Journey Contract created from a handoff | `PENDING` (PR D) |
| V2.3 | Core riding | Live Activity V3 states from `resolveSurface`; push-token registration endpoint; Transfer Guardian in the ride | `PENDING` (PR E) |
| V2.4 | Jeju safety layer | Safe Return, Rescue engines with deterministic tests (no-return rejection, long headway, expired data) | `PENDING` (PR B) |
| V3.0 | Jeju discovery | 오늘 뭐하젠?, 그냥 탑서 (filtered before randomisation), route experiences grounded in live route data | `PENDING` (PR F) |
| V3.1 | Transit Fit | Semantic accessibility summary, no fake scores | `PENDING` (PR F) |
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
- PR A (`claude/v21-production-foundation`): transit-core test fix ported,
  provider error taxonomy, Journey Contract v1.

## Risks and unexpected findings

- `main` had been red since `cd806f6`; any PR based on it inherits the red
  `transit-core` check until the fix lands.
- Production sessions cannot be enabled from this environment: the Upstash
  credentials are Sensitive values only the owner holds.

## Exact next action

Push PR A, then build the Safe Return / Transfer Guardian / Rescue engines (PR B)
while CI runs.

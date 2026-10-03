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
| V2.1d | Production durable sessions | `/health` reports `sessions.store=redis`, namespace `production`; post-deploy session smoke passes | `DONE` 2026-10-03: post-deploy run `37081618489`, smoke 17/17, lifecycle 8/8 (`PRODUCTION_TRANSIT_API.md`) |
| V2.1e | iOS real Journey Session integration | Live mode creates, refreshes, confirms and ends a session against the API; demo stays synthetic; guard test proves no real data reaches the Swift matcher | `IMPLEMENTED` (PR C). Production sessions on since 2026-10-03 (V2.1d). The app's live flow on a device is `UNVERIFIED` |
| V2.2 | Map Handoff | Share Extension accepts KakaoMap, NAVER Map, Apple Maps, URLs, coordinates, addresses and names; parser tests; Journey Contract created from a handoff | `IMPLEMENTED` (PR D, `MAP_HANDOFF_V3.md`); device run `UNVERIFIED` |
| V2.3 | Core riding | Live Activity V3 states from `resolveSurface`; push-token registration endpoint; Transfer Guardian in the ride | `PENDING`; remote updates `BLOCKED_BY_PAID_MEMBERSHIP` (APNs); Transfer Guardian needs a planned transfer (no source) |
| V2.4 | Jeju safety layer | Safe Return, Rescue engines with deterministic tests (no-return rejection, long headway, expired data) | `DONE` for the engines (#73 merged); last-bus data path and end-screen card `IMPLEMENTED` (PR E); Rescue for a passed destination `IMPLEMENTED` (#83, `PassedStopRescue`); the last-bus countdown on the Lock Screen `IMPLEMENTED` (PR G, `TapsoReturnAttributes`); Jeju last-bus data: TAGO has none (`VERIFIED`), the official timetable files are identified (data.go.kr 3043887, 제한 없음) and wait on a first file from a person; missed-connection and wrong-direction rescue and Transfer Guardian wait on planned transfers (no route planner or transfer data) |
| V3.0 | Jeju discovery | 오늘 뭐하젠?, 그냥 탑서 (filtered before randomisation), route experiences grounded in live route data | `PENDING`: no verified place source yet |
| V3.1 | Transit Fit | Semantic accessibility summary, no fake scores | `PENDING` |
| V3.2 | Eat | Transit-aware food situations | `PENDING` |
| V3.3 | Drop, Passport, Share | Editorial 1–3 picks; on-device passport; share card | `PENDING` |
| V3.4 | Roulette / Mystery Ride | Experimental | `PENDING` |
| WEB | Marketing site V3 | GO/RIDE/DISCOVER/RETURN story, semantic Dynamic Island engine, availability labels, reduced-motion static, 4-width visual QA | `IMPLEMENTED` (#75; status and map sections #86). Four-width QA done 2026-10-01 (see Progress) |
| FIGMA | Product V3 file | Pages 00–13, variables synced to code tokens, V3 components | `IMPLEMENTED`: V3 pages, `02G` components, prototype flows; repository references #85. V3 web frames `IMPLEMENTED` 2026-10-01: the site as built at 1440, 1280, 390 and 360 (`11 Marketing Web` › `218:2`), editable layers bound to the V2 variables; the V2 web board is archived |

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
- 2026-10-01 18:24–18:31 UTC — #82, #83 and #84 merged (`9e46e39`, `93cfad3`,
  `a5ab514`), each with green CI on a head that already contained the one
  before it. GitHub merged `main` into #82 from a single merge base (`156d656`)
  although the histories share two, and from that base both sides added
  `JEJU_SAFETY_LAYER_V3.md`: the file was held at `main`'s text, `main` merged
  in on the server, and the rows restored (`dc76346`, `2b33517`, `67a6955`); the
  resulting tree equals git's recursive merge.
- 2026-10-01 18:24–18:26 UTC — the route-info probe against production:
  production returned HTTP 200 with no first or last departure and no headway
  for every variant it answered: 52 of the 58 variants of routes 102, 202, 282,
  365 and 800 (the first six requests reached production before the endpoint
  was deployed; an earlier version of this entry said 50). #87 added
  `meta.undocumentedFields` to tell "nothing" from "another shape".
- The Figma file now follows the V3 page structure, with `02G iOS Product V3`
  components for the way back and rescue; repository references follow in #85.
  The site's status and map sections follow the app in #86.
- Transfer Guardian in a live ride stays unbuilt: `/v1/vehicles` can place the
  connecting bus, but without TAGO arrival predictions (dataset 15098530,
  `vehicletp` and `arrtime`, awaiting the owner's data.go.kr authorization) the
  connection window would come from an assumed per-stop band and mostly read
  `unknown`. Transit Fit's low-floor field lives in the same dataset.
- 2026-10-01 19:04–19:05 UTC — #87 (`3d516cb`) and #85 (`3aea61a`) merged;
  post-deploy verification green (run 36911628193).
- After #87 deployed (probe runs 36911628211 and 36911886895), all 58 variants
  answered HTTP 200 with no first or last departure and
  `meta.undocumentedFields: {"intervaltime":"0"}`. TAGO has no Jeju service day
  (`VERIFIED`).
- Jeju timetable sources (#89, `scripts/data-sources/jeju-timetable-docs.ts`,
  runs 36910287652 and 36913158370; `DATA_SOURCES.md`). The official timetable
  is data.go.kr file dataset 3043887: per-route XLSX downloads from
  `bus.jeju.go.kr`, licence 제한 없음, "수시 (1회성 데이터)". Neither it nor any
  Jeju Open API on the portal is a timetable API. `bus.jeju.go.kr` omits its
  intermediate certificate; the probe completes the chain only after verifying
  it against the system roots.
- Lock Screen contrast (#90, #92). The coral next-stop secondary line, open in
  `KNOWN_ISSUES.md` since 2026-09-30, read 3.2:1. The same computation found
  three more failures: 70 % ink on the dark coral (4.3:1); the count label at
  80 % (3.7:1 on coral, 4.4:1 for light slate on basalt); and a last-known
  numeral at 55 % (2.8:1). #90 makes all four pass and adds a test over every
  moment in light and dark; #92 marks the `KNOWN_ISSUES.md` item fixed.
- Marketing site, four widths (390, 768, 1024, 1440). Local build of `main` plus
  #86, Chromium, Pretendard served locally:
  - no horizontal overflow at any scroll position;
  - axe-core 4.10 WCAG 2.0/2.1 A+AA, 0 violations at 29–40 positions per width
    under reduced motion. With motion on, contrast hits appear only in the
    middle of cross-fades;
  - reduced motion leaves the hero static, with no running animation;
  - only inline sentence links are under 44 px.
- 2026-10-01 19:30 UTC — #86 (`55c648e`) merged, CI green on its head in both
  runs; #85 and #87, merged after that run, do not touch `apps/web`.
- 2026-10-01 19:58 and 20:02 UTC — #90 (`d7c6ecd`) and #88 (`98c5013`) merged.
  #88 edited the `KNOWN_ISSUES.md` item next to the way-back one, so `main` was
  merged into #89 (`423f9f0`).
- 2026-10-01 20:38 and 21:05 UTC — #92 (`e779a4c`) and #89 (`c73e247`) merged.
- Figma V3 web frames. Figma's upload host is still unreachable from here, so
  the page was rebuilt rather than captured: `apps/web` as of `main@55c648e`
  (the last change under `apps/web/src`), rendered in Chromium with reduced
  motion at 1440, 1280, 390 and 360, read back as boxes, styled text runs and
  inline SVGs, and written into `11 Marketing Web` › `Web / Marketing V3`
  (`218:2`) through the plugin API: four frames, 4,655 layers. Deviations:
  Noto Sans KR instead of Pretendard, so wrapped Korean breaks only between
  words (hard line breaks, as `word-break: keep-all` does) and a few
  paragraphs run one line longer; chapter backgrounds the site paints with a
  box-shadow are `band ·` rectangles; repeating-gradient dashes are dashed
  strokes. Every solid colour is bound to `TAPSO V2 Semantic` or
  `TAPSO Primitives`, which gained `jeju/sand` and `jeju/sand-deep` (`--sand`,
  `--sand-deep` in `tokens.css`). 돌이 is the site's `dori-480.webp` as a 200 px
  palette PNG. The V2 web board (`165:54`) moved to `13 Archive`.

## Risks and unexpected findings

- `main` had been red since `cd806f6`; any PR based on it inherits the red
  `transit-core` check until the fix lands.
- Production sessions cannot be enabled from this environment: the Upstash
  credentials are Sensitive values only the owner holds.
- TAGO's `getRouteInfoIem` gives no service day for Jeju routes (`VERIFIED`
  2026-10-01, all 58 variants; only `intervaltime` "0"). Jeju's official
  timetables come as per-route files with no API. Importing them is a dated
  dataset that can go stale when routes change ("수시" updates), so it needs a
  staleness rule and a visible "as of" date.
- GitHub merges criss-cross histories from one merge base; a branch that merges
  cleanly with local `git merge` can still conflict on the server. Check with
  `git merge-tree --merge-base=<GitHub's base>` before trusting a local merge.
- A squash-merged pull request's own commits are not in `main`'s history (#75
  landed as `47112f5`). #91 was based on one of them, so #92 replaced it, built
  on `main` itself. Edits to adjacent lines conflict in git's merge (#88 and #89
  in `KNOWN_ISSUES.md`): hold one side at the base, merge, then re-apply it.
- The Figma web frames are a rebuild of the code, not a source: they go stale
  when `apps/web` changes and must be regenerated (`FIGMA_IMPLEMENTATION_MAP_V2.md`).

## Exact next action

For the last bus:
1. A person downloads one route's timetable XLSX from `bus.jeju.go.kr`, as
   data.go.kr 3043887 instructs (365 first), and adds it under
   `fixtures/jeju/timetables/` with its download date.
2. Write the parser and a dated dataset behind `/v1/route-info`, with a staleness
   rule.
3. Label it `REPORTED-OFFICIAL` as of that date.

Live Activity V3 states from `resolveSurface` add nothing over the V2 policy
for a single-leg ride: recovery past the stop already names the exit (#83).
They wait for planned transfers. Discovery waits for a verified place source
and for production sessions (mission Section 18).

# TAPSO v1 release closure

> **Scope.** The gap between "the architecture exists" (PR #109 and before) and
> "a rider can trust TAPSO on a real bus with the phone in their pocket".
> This plan does not restate `JEJU_PRODUCTION_V1.md`; that record stands as
> prior evidence. Baseline: main `a8f5940` (2026-10-04 00:04 KST, the #109
> merge), CI green on that commit (`CI`, `Post-deploy verification`, `Jeju
> transit catalog`), no open pull request, no commit after #109.

## 1. User-visible outcome and non-goals

A rider searches a real destination, picks the exact variant and boarding
stop, confirms the physical bus, puts the phone away (music, another app, the
lock screen) and is interrupted only to prepare, to get off next, and to get
off. Upstream trouble degrades to one calm message, never to a wall of
backend words, and never to a server fault the phone cannot see.

Non-goals: rebuilding the catalog, the timetable census, destination search,
the service-day engine, the route-variant model, the screenshot OCR, the
hybrid engine or the journey session system. Each is touched only where a
release-blocking defect is shown.

## 2. Verified baseline (2026-10-04)

| Fact | Evidence |
|---|---|
| Catalog `794f3bcb831d783e`: 989 variants, 4,338 stops, 252 numbers | `/health` `staticData.catalog`; `services/api/data/jeju-transit-catalog.json` (route 3001 has six variants, 13–38 stops) |
| Timetables: bundle `e149eb7a24bd6723`, 231 datasets served; census 235 entries (201 parsed, 30 conflicts, 4 none, 0 refused) | `/health` `staticData.timetables`; `artifacts/timetables/jeju-timetable-census.md` |
| Production API on commit `a8f59400e2f8`, Redis sessions enabled, vehicle cache 20 s, APNs push disabled (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT`, `APNS_PRIVATE_KEY` missing) | `/health` 2026-10-03T19:20Z |
| Matcher `directed-route-progress-v1`, readiness `READY_FOR_SHADOW`, automatic matching off, cadence policy 90 s / 3 samples / 10 s span / 30 s age / 30 s gap, provisional | `/health` `matching`, `freshness` |
| Railway `tapso-ride-collector` / `collector` runs the Live Activity ticker; every tick answers `push_unavailable` (503) because APNs is unconfigured; the ticker then waits 5 min | Railway deploy logs 2026-10-03 03:07Z, 05:34Z, 15:04Z; `services/api/src/liveActivityTicker.ts` |
| Local baseline: Swift core 233/233, API 884/885 (the one failure, "/health reports the beta status from the real collector wiring", reaches the real collector and fails offline), Python TAGO and timetables green | this session's runs on `a8f5940` |
| Hybrid engine behind `-tapsoHybridTracking`; 27 scenario tests; no road geometry; no physical-device evidence | `HYBRID_POSITION.md`, `KNOWN_ISSUES.md`, `scripts/release-gates/jeju-v1.ts:173` |
| Home wordmark is a bare `Text(verbatim: "TAPSŌ")` in `HomeView.swift`; no `BrandWordmark`; `MARKETING_VERSION 0.1.0`, `CURRENT_PROJECT_VERSION 1`, no Git SHA in the build | `apps/ios/project.yml`, `TapsoBuild.swift` |
| Figma `TAPSO — Product / Marketing Design System` (`kkx04GvqOzHje7Dw5ikO9X`): island surfaces on `05 Live Activity · Dynamic Island` (`160:1208`), components on `02F iOS Ride V2`; the `delayed` row still carries the pre-#107 copy "실시간 정보가 잠시 늦고 있어요" | Figma read 2026-10-04 |
| Vercel runtime logs of `tapso-api` are not readable from this machine (connector answers 403; no CLI login) | this session |

Differences from the mission prompt: the physical-phone screenshots named as
primary evidence were not among this session's inputs; the forensic case is
reconstructed from code and reproduced by test, not from logs
(`../validation/RIDE_3001_FALSE_DELAY_2026-10-04.md`).

## 3. Workstreams

Status vocabulary: `DONE`, `ACTIVE`, `BLOCKED`, `NOT_YET_VERIFIED`, `FAILED`.

| Workstream | Current status | Verified evidence | Next action | Blocker | Release gate |
|---|---|---|---|---|---|
| A. Brand integrity / stale-build prevention | ACTIVE | Home renders `TAPSŌ` via a string literal; marketing header/footer `TAPSŌ`; `CFBundleDisplayName` `TAPSO`; no build identity. Figma canonical Home boards `157:15` and `157:73` read `TAPSŌ` (U+014C); the `Dark · 02` (`159:1116`) and `EN · 02` (`163:2418`) Home variants still read `TAPSO` — flagged for the user's review, not overwritten | Land `fix/brand-integrity-gate`: `BrandWordmark`, Debug build identity (version, build, Git SHA, configuration), brand guard in CI, snapshot names | Physical-device check needs the tester's phone | Brand (§64) |
| B. 3001 / 3913 false-delay fix | ACTIVE | Causal chain documented and reproduced by test; fix on `fix/live-ride-reliability-v3` (confirmed-ride progression policy, `reliability` view, one trust word, one message per condition, truthful timeout copy); API 900/902 locally (the two: the offline collector test and none other), Swift core 235/235 | iOS simulator build and test; PR; re-ride on a current build | Production logs unreadable (Vercel 403) | Confirmed-ride reliability (§65) |
| C. Confirmed-ride tracking semantics | ACTIVE | `confirmedRideProgression.ts` with deterministic tests for every rejection case; automatic matcher gate unchanged and tested | Same PR as B | — | Confirmed-ride reliability (§65) |
| D. TAGO fetch resilience / coalescing | NOT_YET_VERIFIED | Code: per-instance 20 s vehicle cache with concurrent-miss coalescing (`ttlCache.readThrough`), TAGO 9 s deadline, one retry; no production latency figures readable | Restore Vercel log access (team token with log scope, or `vercel login`), then measure p50/p95 of `session_read`, timeout rate by route, cache hit ratio, before changing any interval | Vercel log access | Fetch resilience (§83) |
| E. Hybrid Position Engine productionization | NOT_YET_VERIFIED | 27 scenario tests; flag reason documented (no road geometry, no background reconciliation, no field false-passage rate, no Energy Log) | Rollout plan section below; device protocol with `-tapsoHybridTracking` | Physical device; road geometry absent | Hybrid (§66) |
| F. Route geometry / map-matching audit | DONE (classified) | Stop coordinates surveyed for every stop in the catalog; no road polyline: geometry class `APPROXIMATE` (stop chords) for every variant, `AUTHORITATIVE` for none | Keep prediction capped as the engine already does; no v1 feature depends on road geometry | — | Geometry: NOT_REQUIRED_FOR_V1 (§69) |
| G. Dynamic Island Coexistence V3 | ACTIVE | Figma V1 page built this session (see §5); SwiftUI not started | Human Review Gate A | User review | Dynamic Island (§67) |
| H. Lock Screen / ride-screen UX cleanup | ACTIVE | One trust word per moment (`RideTrust`); ride screen shows one notice per root condition | Apply the same to Lock Screen and island after Gate B | Gate B | Lock Screen (§83) |
| I. Background / APNs production completion | BLOCKED | Token route, store, index, scheduler and pusher exist in code; ticker live on Railway and answering 503 every 5 min; APNs variables absent | Owner: paid Apple team, then the five `APNS_*` variables on `tapso-api`; make the ticker skip while `/health.liveActivityPush.enabled` is false (design below) | Apple team / APNs key | Background/APNs (§68) |
| J. Screenshot / map-import regression | NOT_YET_VERIFIED | CI evidence from #102–#105, #109 on simulator; share extension `UNVERIFIED` on device | Re-run `ScreenshotImportFlowTests`, `MapHandoffFlowTests` on the device build | Physical device | Screenshot/map import (§83) |
| K. Offline / cache / recovery validation | NOT_YET_VERIFIED | Catalog ETag cache, schedule provenance, restored-ride path exist and are unit-tested; vehicle cache never serves stale rows (`cachedTransitProvider.ts`) | Device check: airplane mode mid-ride, reconnect | Physical device | Offline/recovery (§70) |
| L. Observability / field diagnostics | NOT_YET_VERIFIED | Structured `transit_api_request` logs with `durationMs`, `cache`, route; `reliability` now on every selected-vehicle view; Debug hybrid diagnostic lines exist only behind the flag | Debug ride trace (build SHA, route, variant, masked vehicle, provider sequence, state, reliability, hybrid, lifecycle, milestone, LA event) in PR C | — | — |
| M. Real-device validation | BLOCKED | None since #100; device `UNVERIFIED` everywhere the README says so | The ride protocol in §7 on a build whose SHA the phone shows | Tester with the phone | Real-device (§83) |
| N. Final v1 release gates | NOT_YET_VERIFIED | #109 gates green on `a8f5940` (`artifacts/release-gates/jeju-v1.md`) | Re-run `scripts/release-gates/jeju-v1.ts --check` on every PR | — | CI (§71) |

## 4. Decisions

- **Matcher freshness is not confirmed-ride progression.** The cadence gate
  stays exactly as it is for automatic selection. A rider-confirmed bus is
  judged by `confirmedRideProgression.ts` (same route, same direction,
  monotonic, plausible distance at 35 m/s over stop chords, receipt inside
  90 s, second sighting before an unseen destination passage). Alternatives
  considered: loosening the cadence thresholds (would also loosen matching),
  trusting everything after confirmation (rejected: identity changes, route
  conflicts and teleports are real).
- **Reliability is published by dimension**, never as one flag:
  `reliability.{provider, observation, position, vehicle, matcherCadence,
  trust}` on every view with a selected bus. The client collapses it to one
  word (`RideTrust`: live / estimated / rechecking / unavailable).
- **Network and server copy must match network and server conditions.** A
  phone-side timeout says the phone waited too long; it does not say the
  server is slow.
- **One root condition, one message.** The ride screen suppresses the
  transient-failure notice when the guidance already carries a rechecking or
  unavailable word.
- **Expected 503 spam.** The ticker should not call the tick route while
  `liveActivityPush.enabled` is false. Design (PR D): the collector reads
  `/health` once per pause interval and skips ticks until push is enabled,
  logging `push_unavailable` once per state change; the API's 503 stays as
  the fail-closed answer for a misconfigured caller.
- **Route geometry is not a v1 blocker.** The hybrid engine already caps
  prediction on approximate geometry and never confirms arrival from it.

## 5. Dynamic Island Coexistence V3 (Figma first)

Page `05B · Dynamic Island Coexistence V3` in the existing file, sections
`00 Evidence` … `11 Implementation Comparison`. Human Review Gate A: the user
inspects Music + Riding, Music + Prepare, Music + Next, Music + Arrival and
Minimal double digit, edits freely, and says so; the next session re-reads
the nodes, writes the edit diff, reconciles V2 and stops at Gate B. SwiftUI
V3: NOT STARTED until Gate B approval.

Ids (file `kkx04GvqOzHje7Dw5ikO9X`): page `275:2`; sections `00` `275:3`, `01`
`275:5`, `02` `275:7`, `03` `275:9`, `04` `275:11`, `05` `275:13`, `06`
`275:15`, `07` `275:17`, `08` `275:19`, `09` `275:21`, `10` `275:23`, `11`
`275:25`. Component sets: `RideStateSymbol / V3` `276:32`,
`RemainingStopsIndicator / V3` `276:41`, `TrustQualifier / V3` `276:57`,
`DynamicIslandMinimal / V3` `276:93`, `DynamicIslandCompactLeading / V3`
`276:164`, `DynamicIslandCompactTrailing / V3` `276:204`,
`DynamicIslandExpanded / V3` `276:490`. Frames to review first: Music +
Riding (8) `278:719`, Music + Riding (12) `278:739`, Music + Prepare (2)
`278:758`, Music + Next (1) `278:777`, Music + Arrival `278:795`, minimal /
riding / 12 `278:282`.

## 6. Hybrid rollout plan (workstream E)

- **Enable criteria:** deterministic simulations green (27 today); Core
  Location sampling verified on a device; denied permission behaves safely;
  GPS noise never advances a milestone; official recovery resumes the count;
  Energy Log over a 40-minute ride acceptable; false destination-passage rate
  measured on at least the five ride classes in §7.
- **Disable / kill switch:** the launch argument today; in production a
  server flag in `/health` (`hybridTracking.enabled`) read at ride start, so
  rollback is a configuration change, not a build.
- **Rollback:** official-only authority (today's default).
- **Owner:** the repository owner; **removal condition:** the flag is deleted
  the release after hybrid has been the default for one full ride-class sweep
  without a safety finding.

## 7. Real-device protocol (workstream M)

Ride classes: ordinary urban (e.g. 365), longer (e.g. 101/102), branch (a
`-1` variant), dense-stop (a 4xx city route), sparse-stop (3001 airport
loop). During one ride: start, confirm the bus, play music, Home, another
app, lock, unlock, manual recheck, normal progression, one provider delay
(real or simulated), recovery, 3 → 2 → 1 → arrival. The build identity
diagnostics must show the commit under test.

## 8. Branch / PR plan

| PR | Branch | Contents | Status |
|---|---|---|---|
| A | `fix/live-ride-reliability-v3` | confirmed-ride policy, reliability view, trust word, dedupe, timeout copy, forensic doc, this plan, tests, fixtures | in progress |
| E | `fix/brand-integrity-gate` | `BrandWordmark`, build identity, brand guard, snapshots | in progress |
| B | `feat/dynamic-island-coexistence-v3` | after Gate B | not started |
| C | `feat/hybrid-production-readiness-v1` | rollout flag, diagnostics trace, device evidence | not started |
| D | `feat/live-activity-background-production-v1` | ticker skip-while-disabled, APNs config, authority handoff | not started |

## 9. Reproduction

```bash
npm --prefix services/api test
node --experimental-strip-types scripts/journey/session-views.ts --check
swift test --package-path packages/transit-core
python3 scripts/ios/check_localization.py && python3 scripts/ios/sync_xcodeproj.py --check
node ~/dev/korean-language-quality/bin/kolint.mjs --genre ux apps/ios/Resources/ko.lproj/Localizable.strings
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

## 10. Progress

- 2026-10-04: baseline verified; forensic chain for 3001 / 3913 established
  and reproduced; PR A implemented locally (API 900/902 with the offline
  collector test as the only other failure, Swift core 235/235); plan created;
  Figma V1 page built; Gate A reached. Exact next action: user review of the
  Figma frames listed in the Gate A report; meanwhile PR A and PR E through CI.

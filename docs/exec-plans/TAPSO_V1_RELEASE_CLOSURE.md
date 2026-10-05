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
| A. Brand integrity / stale-build prevention | NOT_YET_VERIFIED (code DONE, PR #111 merged) | Home renders `TAPSŌ` via a string literal; marketing header/footer `TAPSŌ`; `CFBundleDisplayName` `TAPSO`; no build identity. Figma canonical Home boards `157:15` and `157:73` read `TAPSŌ` (U+014C); the `Dark · 02` (`159:1116`) and `EN · 02` (`163:2418`) Home variants still read `TAPSO` — flagged for the user's review, not overwritten | Install a main build on the test phone, read the identity line in 체험 설정, check Home | Physical-device check needs the tester's phone | Brand (§64) |
| B. 3001 / 3913 false-delay fix | NOT_YET_VERIFIED (code DONE, PR #110 merged, in production since `7b76bc4`) | Causal chain documented and reproduced by test; fix on `fix/live-ride-reliability-v3` (confirmed-ride progression policy, `reliability` view, one trust word, one message per condition, truthful timeout copy); API 900/902 locally (the two: the offline collector test and none other), Swift core 235/235 | Re-ride 3001 on a main build with the Ride trace open; attach the trace | Production logs unreadable (Vercel 403) | Confirmed-ride reliability (§65) |
| C. Confirmed-ride tracking semantics | DONE (PR #110 merged) | `confirmedRideProgression.ts` with deterministic tests for every rejection case; automatic matcher gate unchanged and tested | Keep the policy's tests green; device re-ride under B | — | Confirmed-ride reliability (§65) |
| D. TAGO fetch resilience / coalescing | NOT_YET_VERIFIED | Code: per-instance 20 s vehicle cache with concurrent-miss coalescing (`ttlCache.readThrough`), TAGO 9 s deadline, one retry. Probe from this machine, 2026-10-03 20:24Z (buses not running): first `/v1/vehicles` read 3.2 s, first `/v1/stops` read 2.1 s, cached reads 0.09–0.18 s, `/health` 0.33–0.47 s. Session reads bypass the CDN, so every poll pays the uncached path; the 20 s phone timeout is well above a normal read and is exceeded only by cold function + TAGO retry stacking, which the logs would show | Adaptive foreground polling shipped as `LivePollingPolicy` (15 s far, 10 s at three stops or fewer, 10 s while rechecking for at most 120 s, never faster for a lost bus; background unchanged: no polling). Still to do: restore Vercel log access, then measure p50/p95 of `session_read` and the timeout rate by route from the `journey_session_read` and `transit_api_request` lines | Vercel log access | Fetch resilience (§83) |
| E. Hybrid Position Engine productionization | NOT_YET_VERIFIED | 27 scenario tests; flag reason documented; rollout switch live in production and off (`/health.hybridTracking.enabled: false` on `12470f4`, PR #113) | Device protocol with `-tapsoHybridTracking`; flip the switch only after §6's enable criteria | Physical device; road geometry absent | Hybrid (§66) |
| F. Route geometry / map-matching audit | DONE (classified) | Stop coordinates surveyed for every stop in the catalog; no road polyline: geometry class `APPROXIMATE` (stop chords) for every variant, `AUTHORITATIVE` for none | Keep prediction capped as the engine already does; no v1 feature depends on road geometry | — | Geometry: NOT_REQUIRED_FOR_V1 (§69) |
| G. Dynamic Island Coexistence V3 | NOT_YET_VERIFIED (code DONE, PR #115 merged `1555cb9`) | Figma V1 page built; Gate A/B closed by the owner's delegation on 2026-10-05 (review verdict in §5); SwiftUI V3 implemented on `feat/dynamic-island-coexistence-v3`: minimal = bus glyph + count with ring (prepare), filled disc (next, arrival), `~` for an estimate, dimmed count while rechecking; decision pills filled; one qualifier line (estimated only); VoiceOver reads route + count | Device screenshots into `11 Implementation Comparison`; APP_CONTROLLED fixes | Physical phone with music playing | Dynamic Island (§67) |
| H. Lock Screen / ride-screen UX cleanup | ACTIVE (ride screen DONE in PR #110) | One trust word per moment (`RideTrust`); ride screen shows one notice per root condition | Apply the same to Lock Screen and island after Gate B | Gate B | Lock Screen (§83) |
| I. Background / APNs production completion | BLOCKED | Token route, store, index, scheduler and pusher in code; ticker gated on `/health` and live on Railway deployment `68f0676e` (`12470f4`): first start logged `push_unavailable source=health` and did not call the tick route; APNs variables absent | Owner: paid Apple team, then the five `APNS_*` variables on `tapso-api` (`LIVE_ACTIVITY_PUSH.md` §3b); then the device protocol | Apple team / APNs key | Background/APNs (§68) |
| J. Screenshot / map-import regression | NOT_YET_VERIFIED | CI evidence from #102–#105, #109 on simulator; share extension `UNVERIFIED` on device | Re-run `ScreenshotImportFlowTests`, `MapHandoffFlowTests` on the device build | Physical device | Screenshot/map import (§83) |
| K. Offline / cache / recovery validation | NOT_YET_VERIFIED | Catalog ETag cache, schedule provenance, restored-ride path exist and are unit-tested; vehicle cache never serves stale rows (`cachedTransitProvider.ts`) | Device check: airplane mode mid-ride, reconnect | Physical device | Offline/recovery (§70) |
| L. Observability / field diagnostics | DONE in code (PR #113 merged), NOT_YET_VERIFIED on a device | Structured `transit_api_request` logs with `durationMs`, `cache`, route; `reliability` on every selected-vehicle view (PR #110); Debug `RideTrace` (PR C): every poll, failure, guidance change, milestone, lifecycle change, Live Activity update and hybrid evaluation recorded automatically with build SHA, route, variant, masked plate, provider sequence, session state, server trust, moment, trust, remaining stops, hybrid state, GPS accuracy bucket; exported as text from the ride screen's "Ride trace" sheet; never coordinates, tokens or session ids | Server-side counters (rides entering estimated / rechecking / lost, push success and failure) once Vercel logs are readable | — | — |
| M. Real-device validation | ACTIVE | A Debug build is installed and launched on the paired iPhone 15 Plus from this machine (`xcodebuild -destination 'platform=iOS,id=…' -allowProvisioningUpdates`, `devicectl device install app`); `TapsoGitCommit` in the installed Info.plist proves the commit. No screen evidence yet: iPhone Mirroring access was declined, so the tester reads the phone | The ride protocol in §7 on the installed build; the tester attaches the Ride trace and screenshots | Tester with the phone | Real-device (§83) |
| N. Final v1 release gates | NOT_YET_VERIFIED | #109 gates green on `12470f4`; CI and post-deploy verification green on every merge of 2026-10-04 | Re-run `scripts/release-gates/jeju-v1.ts --check` on every PR | — | CI (§71) |

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
- **Polling cadence follows the decision, not the clock.** Far out the 15 s
  cadence stays (one provider read per poll). At three stops or fewer the
  prepare and next-stop moments can be a whole stop late on a dense route at
  15 s (stops 300–500 m apart, 30–60 s at bus speed), so the read runs at
  10 s. Rechecking reads at 10 s for at most two minutes, then returns to
  15 s so a slow provider is not hammered and a persistent failure still
  surfaces. A lost or offline ride never polls faster. Tests:
  `LivePollingPolicyTests`.
- **Route geometry is not a v1 blocker.** The hybrid engine already caps
  prediction on approximate geometry and never confirms arrival from it.

## 5. Dynamic Island Coexistence V3 (Figma first)

Page `05B · Dynamic Island Coexistence V3` in the existing file, sections
`00 Evidence` … `11 Implementation Comparison`. Human Review Gate A: the user
inspects Music + Riding, Music + Prepare, Music + Next, Music + Arrival and
Minimal double digit, edits freely, and says so; the next session re-reads
the nodes, writes the edit diff, reconciles V2 and stops at Gate B. SwiftUI
V3: NOT STARTED until Gate B approval.

2026-10-05: the owner delegated the Gate A and Gate B review. Verdict against the
mission's criteria: minimal says bus ride + count at 8 / 12 / 18 (3× renders
checked); 2 / 1 / arrival are three objects (amber ring + stand + 2, coral
disc + bell + 1, tangerine disc + walk, no number); TAPSO stays recognisable
beside Now Playing in every state; one qualifier at most; no emoji, no mascot
or destination in minimal. One reconciliation against §20: the expanded and
Lock Screen frames in Figma carry a qualifier line for rechecking and
unavailable beside the headline that already says it; the implementation
keeps the qualifier for `estimated` only. The `10 Approved` section could not
be written from this session (a permission refusal on the Figma write); the
reviewed frames in `03`, `04` and `06` are the implementation reference.

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
- **Disable / kill switch:** `TRANSIT_HYBRID_TRACKING_ENABLED` on the API
  (`/health` → `hybridTracking.enabled`, default false; PR #113). The app reads
  it once when a live ride starts and stores the decision in the ride, so a
  relaunch keeps the same authority and the switch never flips a ride in
  progress. The `-tapsoHybridTracking` launch argument stays as the
  development opt-in. Rollback is deleting the variable, not a build.
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
| A | `fix/live-ride-reliability-v3` | confirmed-ride policy, reliability view, trust word, dedupe, timeout copy, forensic doc, this plan, tests, fixtures | [PR #110](https://github.com/club-paradiso/tapso/pull/110) merged `7b76bc4` |
| E | `fix/brand-integrity-gate` | `BrandWordmark`, build identity, brand guard, snapshots | [PR #111](https://github.com/club-paradiso/tapso/pull/111) merged `45d80fd` |
| B | `feat/dynamic-island-coexistence-v3` | minimal identity + count, filled decision pills, estimated qualifier, VoiceOver, snapshot evidence (minimal 1/2/8/12/18, music coexistence mocks) | [PR #115](https://github.com/club-paradiso/tapso/pull/115) merged `1555cb9` |
| C | `feat/hybrid-production-readiness-v1` | Debug ride trace and the server rollout switch (stacked on #110 and #111); device evidence next | [PR #113](https://github.com/club-paradiso/tapso/pull/113) merged `12470f4` |
| D | `feat/live-activity-background-production-v1` | ticker gated on `/health`, authority by app state, owner APNs steps | [PR #112](https://github.com/club-paradiso/tapso/pull/112) merged `ae7453d`; APNs itself still blocked |

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
- 2026-10-04 (continued): PR #110, #111 and #112 open; Figma page re-read, no user edits yet (Gate A still open). Next: CI on the three PRs; then the Debug ride trace (workstream L) on `feat/hybrid-production-readiness-v1`.
- 2026-10-05: PRs #110–#113 merged by the owner on 2026-10-04 (18:34–18:50 UTC); main `12470f4`; CI and post-deploy verification green on each; production API serves `12470f4` with `hybridTracking.enabled: false` and APNs still off; the Railway collector redeployed and its ticker logged `push_unavailable source=health` once without calling the tick route. The scheduled matcher-evidence run of 07:26 UTC failed only in the production smoke: one `/v1/vehicles` read answered `504 PROVIDER_TIMEOUT` (TAGO), evidence for workstream D. Figma page re-read: no user edits, Gate A still open. Exact next action: the owner's Gate A review, and the device protocol on a `12470f4` build.
- 2026-10-05 (continued): PR #115 merged (`1555cb9`): V3 island shipped in code. Debug builds of `baa849d` and then `1555cb9` installed and launched on the paired iPhone; the phone's screen could not be read from this machine (iPhone Mirroring declined). Vercel runtime logs remain unreadable (connector 403; Chrome extension not connected; the logs page rejects URL filters). Noted on the Vercel dashboard: a failed-payment warning on the Club Paradiso team, which can take the production API down.

# Live ride reliability + Home V3

Living ExecPlan (`.agent/PLANS.md`). Branch `feat/live-ride-reliability-home-v3`, from `main` at
`23d3cca` (PR #130 merge, 2026-10-07). Reality labels as in `docs/DATA_VALIDATION.md`: `VERIFIED`
(checked against code or an official source here), `MEASURED` (a run recorded here), `ASSUMPTION`
(engineering choice awaiting evidence), `MISSING`, `DEVICE_REQUIRED` (needs a rider on a real bus).

## 0. Outcome and non-goals

A rider can put the phone away without wondering whether TAPSO froze: the ride reads at the cadence
the policy says, a return to the app refreshes at once, a dropped network recovers by itself, an old
answer never rolls the count back, and every surface says plainly when it is not current. 돌이 is
visibly alive in the app and moves along the journey rail only when real progress arrives. Home asks
"어디서 내릴까요?" first.

Non-goals: no production Hybrid (stays off), no APNs enablement (blocked on the Apple account), no
"오늘 뭐하젠?" UI, no new locale shipped, no continuous Live Activity animation, no change to
protected transit data.

## 1. Starting state

| Item | Value |
|---|---|
| main | `23d3cca9b6dd4ea3f8d23aab55fd853f067b0480` (PR #130). No newer commit; production `/health` `build.commit` = `23d3cca9b6dd` (MEASURED 2026-10-07 02:27Z). |
| Open PRs | none (`gh pr list`, 2026-10-07) |
| Leftover branch | `origin/pending/crosswalk-json-table` (redundant after #130; cleanup, not deleted here) |
| Device | iPhone 15 (`iPhone15,4`), iOS 26.6.1, paired, Developer Mode on |
| Toolchain | Xcode 26.3 (17C529), Swift 6.2.4, Node 24.14.0, Python 3.14.7, Claude Code 2.1.268 |
| Korean copy tool | `humanize-korean@im-not-ai` 2.3.2 (commit `2f3d943`), installed with `claude plugin install`; not hot-loaded into the running session, so its `SKILL.md` contract was followed directly (`SKILL_CONTRACT_DIRECT`) |

## 2. Audit (before any edit)

### 2.1 Polling and scheduling — client (`TapsoAppModel.swift`)

| # | Finding | Label |
|---|---|---|
| P1 | `beginLivePolling()` is `sleep(interval) → read → sleep(interval)`. The policy interval is the *gap after* a read, so start-to-start is `interval + request duration`: 15 s far + a 1.3 s cold read (MEASURED, §3) ≈ 16.3 s; a 20 s client timeout makes one cycle 35 s. | VERIFIED |
| P2 | One `playbackTask` owns both the demo playback loop and the live polling loop. `speedChanged()` cancels it whenever the ride is not live; any future caller that cancels "playback" stops live tracking. | VERIFIED |
| P3 | `rideSceneChanged(isActive:)` refreshes on return to the foreground **only when Hybrid is on**. With Hybrid off (production) the rider waits out the rest of the old sleep, up to 15 s, looking at the count from before they locked the phone. | VERIFIED |
| P4 | `recheckRidePosition()` returns silently when a read is in flight or the last manual refresh was < 10 s ago. The tap is lost; the only feedback is a haptic. | VERIFIED |
| P5 | `refreshLiveRide` marks the ride `endedByServer` for `sessionsUnavailable` (`SESSION_STORE_UNAVAILABLE`, a session-store hiccup) and `serviceUnavailable`, and polling stops for good. A single transient backend failure ends live tracking. The Hybrid path uses `isTransient` and ends for the same cases. | VERIFIED |
| P6 | Nothing restarts a polling loop that has ended (a `false` from `refreshLiveRide` returns from the loop; the loop is only begun at confirmation and relaunch). | VERIFIED |
| P7 | No watchdog: freshness is re-aged only when a read *fails*. If no read happens (loop gone, app suspended without KeepAlive), the screen keeps the last state with its last freshness. | VERIFIED |
| P8 | Ordering: reads are serialised by `readInFlight`, so two client reads never overlap; nothing compares the evidence time of a new answer with the one on screen. The server already refuses to replace progress with a shared snapshot whose `evidenceAt` is not newer (`journeySession.ts` ~L1074). | VERIFIED |
| P9 | Evidence vs evaluation time: the non-Hybrid path stamps `lastObservedAt = Date()` at receipt (honest: "reached the app"); the Hybrid path stamps `lastObservedAt = result.evaluatedAt`, so re-evaluating old official evidence renews the Live Activity's `updatedAt` and stale date. | VERIFIED |

### 2.2 Backend freshness (`services/api`)

- The ride polls `GET /v1/sessions/:id` → `sessions.refresh(id)` → `ActiveRideSnapshotProvider` on the **uncached** TAGO provider (PR #130). Route-scoped single flight, `shareWindowMs` 5 000 (validated < 10 000), budget 600 upstream reads/min per instance with a ≤ 15 s fallback. Failures are never stored. The 20 s public cache serves only `/v1/vehicles`. `VERIFIED` (code + `/health.activeRideReads`).
- `progress.evidenceAt` is TAPSO's server receipt of the TAGO row, labelled `evidenceAtIs: "tapso_server_receipt"`; TAGO publishes no observation time (`observedAt` = epoch sentinel). `VERIFIED`.
- The session view's top-level `updatedAt` is evaluation time. `planLiveActivityPush` uses it as the Live Activity `updatedAt`/stale base for every state other than tracking/arrived/passed (`liveActivityContent.ts` ~L228). Push is disabled in production, so this has no rider effect today; it is still the wrong clock (§6.4).
- Budget and coalescing state is per warm instance; there is no daily-quota guard (the TAGO daily quota is undocumented, `MISSING`).
- Production runs in Vercel `iad1` (US East) (`/health.runtime.region`, MEASURED). A rider in Jeju crosses the Pacific twice per read (phone → iad1 → TAGO in Korea → iad1 → phone).

### 2.3 Lifecycle and authority

- **RideKeepAlive** (opt-in "앱을 닫아도 계속 알려 주기"): its own `CLLocationManager`, 3 km accuracy, 500 m filter, every fix dropped unread, `allowsBackgroundLocationUpdates`, blue indicator. Started only from the foreground, only for a live ride without a registered push token. While it runs, the polling loop keeps reading in the background (`rideInForeground || rideKeepAlive.isRunning`).
- **RideLocationSampler** (Hybrid): a separate manager, one-shot samples, foreground only (`reconcileRidePosition` returns when not in the foreground). Stopped on background.
- **APNs**: fully coded (client asks for `pushType: .token`, registers via `PUT /v1/sessions/:id/live-activity`, server pusher + Railway ticker) but dead: `Tapso.entitlements` has no `aps-environment`, the team is a free Personal Team, production `/health.liveActivityPush` = disabled with all five `APNS_*` missing. Push is also never asked for when Hybrid is on. `VERIFIED` (code, entitlements, `/health`); no device has ever received a token.
- **Hybrid**: off in production (`TRANSIT_HYBRID_TRACKING_ENABLED` default false); `-tapsoHybridTracking` launch argument for development. When on, the foreground poll is `reconcileRidePosition` (official read + device sample, one engine evaluation).

### 2.4 Live Activity

- Updated from the app on every `rideDidChange()` (each read), alerting only on a first-time milestone.
- `staleDate = trackingValidUntil ?? updatedAt + 120 s` (client) and `+ 120 s` (server). `updatedAt` = `lastObservedAt`.
- 돌이 is drawn still on the Lock Screen and island (22/18/26 pt) and changes only by expression. No continuous animation (correct; ActivityKit allows transitions on update only).
- The journey rail (`JourneyRail`, shared by app and Lock Screen/expanded island) draws the current position as a rounded square with `bus.fill`. Progress = `1 − remaining/total`, the same function on every surface. No transition on change.

### 2.5 돌이 motion

`DolBuddy(… animated: true)` uses `TimelineView(.animation(minimumInterval: 1/30))` and a pure `DolMotion(time:)`. At the ride card's 34 pt:
- breath = 2 % of height ≈ 0.7 pt peak-to-peak;
- `riding` (the state most of a ride is in) keeps the eyes shut except a 1 s peek every 7 s;
- `delayed/vehicleLost/offline` still breathe — a stale ride is drawn as gently alive as a live one.

Hypothesis before measurement: the timeline ticks (A false); the motion is too subtle at 34 pt (D) and the riding state is mostly still by design (E). Checked with a simulator screen recording (§7).

### 2.6 Home

Hard-coded `VStack`. Returning rider order: header → **최근 여정 card + 자동 시작 row** → 어디서 내릴까요? + search + recent-destination chips → favourites → other ways (bus number, map import) → privacy line. Destination search is the third block. Taps: new destination 1 (search field); repeat 1 (다시 타기) + bus confirmation.

### 2.7 Localization

`ko.lproj` / `en.lproj` `Localizable.strings`, 502 keys each, shared by app, Live Activity and share extension. `check_localization.py` checks key parity, used keys, duplicates and the *number* of `%` signs (not their types). Gaps: no `InfoPlist.strings` (the location prompts are Korean only, shown to English users); the share extension concatenates `number + "번"` in every language; Siri phrases are literals.

### 2.8 Copy that does not match the implementation

- `home.privacy` "탑서는 버스를 따라가요. 내 위치 권한은 필요 없어요." — false since the app asks for location for KeepAlive, the Hybrid sampler and the stop nudge. Basic tracking needs none; the claim must say that and no more.
- `ride.keepAlive.on` "…탑서는 위치를 쓰지도 보내지도 않아요" — true of KeepAlive itself (fixes dropped), but the rider may also have the Hybrid sampler or stop nudge on. Scoped to KeepAlive.

## 3. Measured baseline (2026-10-07, before changes)

| Quantity | Value | How |
|---|---|---|
| TAGO content-change interval | min 10.0 s, median 27.5 s, max 83.1 s | existing bounded probe, `docs/JEJU_365_LIVE_VALIDATION_2026-09-10.md` (not re-run: no new reason) |
| API read, upstream miss | 1.28 s total (TTFB 1.28 s) | `curl -w` from this Mac to production `/v1/vehicles`, 1 sample |
| API read, served from cache | 0.08–0.30 s (5 samples) | same |
| `/health` TTFB | 0.50 s | same |
| Client cadence | `interval + request` (P1), structurally | code |
| Physical stop → provider → app → island | `DEVICE_REQUIRED` | needs a rider on a bus with the Debug ground-truth mark (§9) |

What this baseline already says: the provider dominates. TAGO changes a row every ~28 s (median), so even a perfect client shows a stop passage on average ~14 s late plus up to one poll gap. TAPSO's own avoidable additions are the sleep-after-read drift (P1), the foreground wait (P3), lost manual refreshes (P4) and rides killed by transient failures (P5).

## 4. Authority matrix (who moves the ride forward)

| Mode | Owner | Notes |
|---|---|---|
| Foreground, Hybrid off | client live polling loop (`livePollingTask`) | one loop, one read at a time |
| Foreground, Hybrid on | same loop, read via `reconcileRidePosition` | engine evaluates official + device |
| Background, KeepAlive running, Hybrid off | same loop | KeepAlive only keeps the process alive |
| Background, KeepAlive running, Hybrid on | same loop, official read only (no device sample in background) | `reconcileRidePosition` → foreground only; the loop falls back to the plain read |
| Background/suspended, APNs registered | server (pusher on read + ticker) | `DEVICE_REQUIRED`/blocked: never observed; KeepAlive stops when a token registers |
| Suspended, no APNs, no KeepAlive | **nobody** — by design the Live Activity goes stale at `staleDate` and says so | not a silent freeze: stale is shown; return to app refreshes at once |
| Relaunch | restore + immediate read, then the loop | Hybrid: old activity ended, engine rebuilt |
| Force quit | nobody; activity goes stale; iOS does not relaunch | copy must not promise otherwise |

Zero owner occurs only in "suspended without KeepAlive or APNs", which is surfaced by `staleDate` and the product watchdog. Two writers never apply ride state at once: every model write is on the main actor through one read gate.

## 5. Plan (milestones)

1. Reliability core: `RideReadScheduler` in transit-core (start-to-start cadence, one read at a time, one pending refresh, immediate foreground/network-restored refresh), separate task ownership, evidence ordering guard, mid-ride failure policy (bounded retry for store hiccups), watchdog, loop restart on foreground.
2. Evidence time: Hybrid path stamps evidence time, not evaluation time; server Live Activity clock uses evidence time when progress exists.
3. RideTrace timing events + Debug ground-truth mark.
4. 돌이 motion tuning; stale states still.
5. 돌이 rail marker with update-driven transition.
6. Home: destination-first order, compact repeat row, typed sections.
7. Localization: `InfoPlist.strings`, share-extension format key, placeholder-type parity check, language roadmap.
8. Korean copy review (kolint + humanize-korean contract), privacy/background copy made accurate.
9. Red team, tests, device install, PR.

## 6. Reliability changes (milestone 1, `8fa7f72`, `7668530`)

### 6.1 Scheduling — `RideReadScheduler` (transit-core)

- The `LivePollingPolicy` interval is now **request start to request start**. Measured deterministically: 15 s policy + 3 s read → reads at 0, 15, 30, 45 s (was 0, 18, 36, 54). A read longer than the interval is followed at once, never overlapped.
- One read at a time. `request(_:)` returns `scheduled` (nothing in flight), `queued` (runs right after the read in flight) or `coalesced` (joins a refresh already waiting). Twenty taps during one read cost one extra read.
- An asked-for read (`foreground`, `manual`, `networkRestored`, `resume`) runs at once but never closer than 2 s (`minimumGap`) to the previous start, so active/inactive flapping cannot burst. The server shares route reads within 5 s, so the gap costs no extra upstream request.
- Monotonic clock (`ContinuousClock`), so a wall-clock change cannot stretch a wait.
- The loop sleeps on `RidePollWaker`, which a refresh request wakes early.

### 6.2 Ownership

`demoPlaybackTask` (demo script only) and `livePollingTask` (the ride's one loop) are separate. A refresh request restarts the loop if it has ended while the ride is still tracked (P6). `finishRide`/`cancelRide` stop the loop, the network monitor and answer any waiting refresh.

### 6.3 Foreground, manual refresh, network

- Return to the app → `requestRideRefresh(.foreground)`, Hybrid on **or off** (P3).
- `recheckRidePosition()` is never dropped (P4). It returns when a read that *began after the tap* has ended, so the pull-to-refresh spinner means what it shows.
- `RideNetworkMonitor` (`NWPathMonitor`) is context only: it labels failures in the trace and asks for one read when the path comes back. A satisfied path is never taken as proof that tracking works.

### 6.4 Ordering and evidence time

- `RideEvidenceOrder`: an answer is applied only if its read began no earlier than the one on screen **and** its evidence is not older. A late, older answer is dropped and traced as `poll_out_of_order`.
- `RideEvidenceClock`: evidence time = phone receipt − (server `updatedAt` − server `progress.evidenceAt`). Both server stamps share one clock, so phone clock skew neither ages fresh data nor freshens old data. `lastObservedAt` now means "when the bus was last observed", in both paths. The Hybrid path no longer stamps evaluation time (P9); a failed or out-of-order Hybrid read leaves it unchanged.
- A retained row keeps its age on screen: a successful read of 40 s old evidence shows `aging`, not `fresh`.
- Server: a Live Activity push is still *ordered* by when its state became true (ActivityKit drops a push whose `timestamp` is not newer), but its `staleDateMs` now counts from the evidence time (`liveActivityContent.ts`).

### 6.5 Failures (`RideReadFailurePolicy`)

| Failure mid-ride | Before | After |
|---|---|---|
| `sessionNotFound`, `sessionExpired`, `rejected` | ride ended | ride ended (unchanged) |
| `sessionsUnavailable` (`SESSION_STORE_UNAVAILABLE`), `serviceUnavailable` | **ride ended on the first one** | retried; ended after 5 consecutive (≈ 1 min at the recovery cadence). Shown as the passing "잠시 후 다시 확인할게요" notice, not as setup copy |
| offline, timeouts, provider errors, rate limit, 5xx | retried | retried (unchanged); offline also sets `isOffline` |

### 6.6 Watchdog

Each loop wake ages a ride whose last evidence is older than `FreshnessPolicy.conservativeDefault` (30 s fresh / 120 s aging): a ride is never drawn as current just because no read has failed. Thresholds: TAGO changes a row every ~28 s median, the client reads every 10–15 s, and a read takes ≤ 1.3 s cold (§3), so a healthy ride's evidence is ≤ ~20 s old; 30 s means at least one read has been missed. The Live Activity's `staleDate` stays evidence + 120 s: the Lock Screen cannot be corrected by an app that is not running, so it waits longer before saying "stale".

User-facing states stay simple: live → 확인 중 (rechecking) → 위치 확인 필요 (unavailable), with offline separate.

### 6.7 Authority after the change

| Mode | Owner | Changed |
|---|---|---|
| Foreground, Hybrid off/on | `livePollingTask` | foreground return now reads at once for both |
| Background + KeepAlive, Hybrid off | `livePollingTask` | — |
| Background + KeepAlive, Hybrid on | `livePollingTask` via `reconcileRidePosition`, official evidence only (no background location sample) | **was zero owner**: `reconcileRidePosition` returned when not in the foreground, so nothing read |
| Suspended, no KeepAlive/APNs | none by design; stale date + immediate read on return | — |

Every model write goes through the one loop on the main actor; APNs updates the Live Activity directly and never writes the app's ride state.

## 7. 돌이 diagnosis and tuning (`b214423`, `a517c64`)

Evidence (simulator, iPhone 16, Debug, Reduce Motion **off** — `defaults read com.apple.Accessibility ReduceMotionEnabled` = 0):

- Hosted test (`DolLivenessTests.testTheRideScreensDolIsRedrawnOverTime`): the real `RideView` in a window, riding state, two captures 1.7 s apart differ → the timeline ticks (cause **A rejected** in the test host).
- Live app, restored delayed ride: 10 screenshots ~1 s apart, the 돌이 crop differed in **all 10** → the timeline ticks in the running app, and a *stale* ride's 돌이 was breathing.
- Live app, a fresh riding ride: one run of 16 screenshots showed an identical crop throughout. Not reproduced; recorded as an open observation, `DEVICE_REQUIRED` (screen recording on the iPhone).
- From the code: riding breath was 0.7 pt peak-to-peak at 34 pt and the eyes are shut except a 1 s peek every 7 s → causes **D (too subtle) and E (rare by design)**.

Tuning: breath 4.5 % (~1.5 pt), peek 1.4 s, 24 fps on the small view only; delayed/lost/offline/ended completely still. Tests: `DolMotionTests.testRidingBreathIsVisibleAtRideCardSize`, stale states equal `.still` at every sampled instant.

Live Activity: no continuous motion. A new moment swaps the pose by identity (`dolPoseTransition`: scale 0.8 + fade); unchanged content keeps its identity and does not animate. Counts keep `.contentTransition(.numericText())`.

## 8. Journey rail marker

- `DolRailMarker` replaces the bus tile on `JourneyRail` (app ride card, Lock Screen, expanded island). Compact face: pebble, role rim, two bold eyes (squint when degraded), tangerine pin; sheen, pores and cheeks dropped below 20 pt.
- Position = `JourneyRail.progress(remaining:total:)`, the one function every surface uses. It changes only when an answer changes the count; the move is a 0.7 s smooth slide (none under Reduce Motion; within ActivityKit's 2 s). 12 → 10 is one slide to exactly the 10-stops position; no 11 is ever shown or stored.
- An unknown count (`-1`) is now progress 0, never the destination. (No surface showed this: an unknown count is the `checking` moment, which hides the rail. Defence in depth.)
- A scalar `railProgress` on the wire was not added: only stop-level evidence exists in production (Hybrid off, no road geometry), so a finer scalar would have no honest source.
- Tests: `testTheRailMarkerIsDolNotABus` (rendered centre pixel is basalt), `testTheMarkerAdvancesOnlyWithEvidenceAndJumpsWithoutInventedStops`.

## 9. Physical-device validation kit

Debug only: ride menu → **Bus passed a stop now** records `ground_truth_stop` with the count on screen. With `poll_start`, `read_timing` (request duration in 250 ms buckets, evidence age in 5 s buckets, network context), `poll`, `guidance`, `live_activity` and `lifecycle`, the exported trace separates:

physical stop (tap) → provider row (`evidenceAge`) → server answer (`read_timing.request`) → app state (`guidance`) → Live Activity update request (`live_activity`).

What it cannot measure: when iOS actually redraws the Lock Screen or island (no API reports it) — that needs a screen recording.

## 10. Home (`07585ae`)

| | Before | After |
|---|---|---|
| Returning rider, top | 최근 여정 card (big, primary button) | 어디서 내릴까요? + search + recent stops |
| Repeat ride | card button | compact `RideAgainRow`, last ride first (tag 최근), favourites below in the same list |
| Taps: new destination | 1 | 1 |
| Taps: repeat last ride | 1 to bus check | 1 to bus check |
| Structure | hard-coded `VStack` branches | `HomeSection` + `HomeLayout.sections` (pure, tested) |

No new modules, feeds or stats. `HomeLayoutTests`: first ride, returning rider (destination first, ride-again before other ways, no sample), 12 favourites do not push the search down, one-tap repeat.

## 11. Localization and Korean copy

### 11.1 Infrastructure

- Locales: `ko`, `en` (`Localizable.strings`, now 502 keys each) plus new `InfoPlist.strings` for the three permission prompts, which were Korean-only for English users. Same tables for the app, Live Activity and share extension.
- `check_localization.py` now compares **placeholder types in argument order** (`%@` vs `%ld`, positional `%1$@` allowed to reorder), checks `InfoPlist.strings` parity and rejects empty values. It previously counted `%` signs only.
- Share extension: `number + "번"` concatenated the Korean unit into every language → `share.screenshot.busNumber` (`%@번` / `%@`) and a locale list format.
- No format migration (`.xcstrings`): the `.strings` tables work, the check covers them, and a migration would touch every key for no rider benefit.

### 11.2 Language roadmap

| Locale | State | Before it may ship |
|---|---|---|
| ko | TRANSLATION_REVIEWED_READY_TO_SHIP | — |
| en | TRANSLATION_REVIEWED_READY_TO_SHIP (developer-reviewed) | native review recommended |
| zh-Hans | INFRASTRUCTURE_READY, **NOT_READY_TO_SHIP** | full key coverage, placeholder parity (checked), terminology review by a fluent reviewer, layout QA (Home, ride card, Lock Screen, island), VoiceOver QA |
| ja | INFRASTRUCTURE_READY, **NOT_READY_TO_SHIP** | same |
| id | INFRASTRUCTURE_READY, **NOT_READY_TO_SHIP** | same |

No locale is added because a model can translate it. Stop, route, direction and service names (`제원아파트[동]`, `제주시청(광양방면)`, `교통약자승차예약`) are provider data and are shown as published; there is no official translation feed, so they stay in Korean in every locale.

### 11.3 Korean copy review

Tools: `kolint --genre ux` over all 505 Korean units (via `--stdin`, because the file reader does not parse `.strings`): **0 findings** — the rules do fire (a probe with a double passive was caught), but they did not catch "~하는 것이 가능합니다" or emoji cuteness, so a clean run is narrow evidence. `humanize-korean` 2.3.2 shim on the rewritten strings: risk band **low**, route **light**; one outlier (sentence-ending comma rate, z = 12) against an `essay` baseline because no `ux` baseline exists — taken as a pointer, and it did point at a three-clause "~하고, ~하고" chain in the location prompt, which was split into a noun list.

| Key | Before | After | Why |
|---|---|---|---|
| `home.privacy` | 탑서는 버스를 따라가요. 내 위치 권한은 필요 없어요. | 버스를 따라가는 데는 위치가 필요 없어요. 위치를 허용해도 iPhone 안에서만 써요. | was false: KeepAlive, the stop nudge and Hybrid ask for location |
| `ride.keepAlive.title` | 앱을 닫아도 계속 알려 주기 | 앱을 나가도 계속 알려 주기 | "닫아도" promised survival of a swipe-up force quit, which stops it |
| `ride.keepAlive.on` | 앱을 닫아도 내릴 때까지 …갱신해요. 그동안 iPhone 위치 서비스가 켜져 있지만, 탑서는 위치를 쓰지도 보내지도 않아요. | 다른 앱을 쓰거나 화면을 꺼도 내릴 때까지 …갱신해요. 앱 전환 화면에서 탑서를 위로 밀어 닫으면 멈춰요. 이 기능을 쓰는 동안 위치 서비스 표시가 보이지만, 위치를 쓰지도 보내지도 않아요. | names what stops it; scopes "쓰지도 보내지도" to this feature |
| `ride.closeApp.live` | TAPSO를 열어 두는 동안 … 앱을 닫으면 … | 탑서를 열어 두는 동안 … 앱을 나가면 … | Korean prose uses 탑서; same "나가다" as the toggle |
| `live.ride.ended.body` | 서버가 이 여정을 더는 따라가지 않아요. … | 탑서가 이 여정을 더는 따라갈 수 없어요. … | engineering word ("서버") in a rider moment |
| Location prompts (`InfoPlist.strings`, `project.yml`) | …사용합니다. 위치는 탑서 서버로 보내지 않습니다. (ko only) | 버스를 따라가는 데는 위치가 필요 없어요. 허용하면 승차 중 위치 확인, 정류장 알림, ‘앱을 나가도 계속 알려 주기’에만 iPhone 안에서 써요. 위치는 탑서 서버로 보내지 않아요. (+ en) | 해요체 like the app; accurate; English users no longer get Korean |

Checked and kept: the ride moments (riding/prepare/next/arrived, plain and calm), the uncertainty states ("현재 위치를 정확히 확인하기 어려워요" — serious, no 돌이 voice), the 교통약자승차예약 card (names 제주버스 as the service, says TAPSO opens it, claims no outcome), error copy. "확인해주세요"/"확인해 주세요" spacing varies; both are permitted (보조용언 붙여쓰기) and changing them is churn, not a fix. Every "never sent to TAPSO's server" claim was checked against `TapsoAPIClient`, the only network client: no request carries a coordinate.

Terminology kept deliberately: 정류장 (rider) vs 정류소 (never used); 내릴 곳 in setup, 목적지 in ride states; 버스 to riders, 차량 only in the trust badge (`차량 확인됨`).

## 12. Discovery seam ("오늘 뭐하젠?")

Not implemented, and nothing is shown. The seam is two existing pieces:

1. **Home**: a future entry is one `HomeSection` case and one rule in `HomeLayout.sections` (e.g. after `.destination`, only when a feature flag and a real engine exist).
2. **Handoff**: a recommended place enters the existing destination-first flow as a `SharedPlace` — the same path a map-app place takes (nearest valid stop → route → exact boarding pole → rider-confirmed bus → live ride). No second ride engine.

Deliberately absent: the intent picker (바다/숲/카페/…), any recommendation logic, opening hours, last-bus/Safe Return coupling.

## 13. ActivityKit update frequency

Apple's documentation (fetched 2026-10-12): `NSSupportsLiveActivitiesFrequentUpdates` "enable[s] your Live Activities to receive frequent updates with **remote push notifications**"; push updates have an hourly budget, priority 5 does not count against it. It does not govern updates made by the running app. TAPSO updates locally (push is disabled), so the key is not added; reconsider with APNs, where priority 5 for unchanged-progress refreshes and 10 for milestones is the documented pattern.

## 14. Red team (fixed in this branch)

- **Generation reset on loop restart** (found reviewing my own change): a new `RideReadScheduler` restarted at generation 0, so after any mid-ride loop restart every answer looked older than the one on screen and was dropped — a silent freeze. Generations now continue (`RideReadScheduler(continuingFrom:)`, test `testARestartedLoopKeepsOrderingAnswers`).
- **Double loop at launch**: the scene's first `active` and `resumeIfNeeded` each started a loop; the second cancelled the first mid-read. Relaunch now joins the running loop.
- **Mid-ride setup copy**: a retried store hiccup would have shown "실시간 승차는 준비 중이에요 … 다시 시도해 주세요".
- **Rail at an unknown count** drew 돌이 at the destination (unreachable today; fixed).
- **Stale 돌이 breathing** (observed live in the simulator).
- Checked and unchanged: network loss during a read (retry, last progress kept, offline flag), foreground during a read (queued), refresh spam (coalesced), stale answer last (dropped), repeated identical observation (server cadence → `unchanged`; client keeps evidence age), 12 → 10 (one slide), Reduce Motion (no motion anywhere), long English strings and AX3 Home (snapshots), many favourites (search stays first), no recent journeys (first-ride layout).
- Not attacked here, `DEVICE_REQUIRED`: push-token rotation and APNs (blocked), GPS multipath and loops (Hybrid off), Low Power Mode, permission changed mid-ride on a real ride, force quit.

## 15. Physical-device matrix

Device: iPhone 15, iOS 26.6.1. This session had no rider on a bus and no view of the phone's screen (iPhone Mirroring was declined earlier), so every ride row is `NOT_TESTED`. Nothing below is inferred from tests.

| # | Case | Result |
|---|---|---|
| — | Debug build `9c4d4c7`+ installs and launches on the iPhone | see §16 |
| A–E | cellular ride; screen on; locked; background; foreground return | NOT_TESTED |
| F–G | airplane mode; reconnect | NOT_TESTED |
| H–I | refresh spam; refresh during a read | NOT_TESTED (deterministic tests pass) |
| J–K | repeated identical observation; 12 → 10 | NOT_TESTED |
| L | 4 → 3 → 2 → 1 → 0 | NOT_TESTED |
| M–N | Precise Location off; location denied | NOT_TESTED |
| O–P | Reduce Motion; Low Power Mode | NOT_TESTED |
| Q–R | island compact; expanded | NOT_TESTED (snapshots only) |
| S–U | lock/unlock; relaunch; force quit | NOT_TESTED |
| V–W | 돌이 app motion; rail progression | NOT_TESTED on device (simulator + hosted tests) |
| X–Y | reservation handoff; opposite-side stop | NOT_TESTED (unchanged from #130) |
| Z | Hybrid with a far confirmed bus | NOT_TESTED |

How to run it: Debug build, start a live ride, tap **Bus passed a stop now** at each physical stop passage, lock/unlock and toggle airplane mode as the matrix says, then export the trace (ride menu → Ride trace) and screen-record the Lock Screen for the visible-update times.

## 16. Energy

Not measured (no device session with Xcode Energy Log). By construction: 돌이 redraws only its own ≤ 34 pt view at 24 fps (was 30) and not at all in stale states; the rail animates only on a count change; polling cadence is unchanged except that it no longer drifts longer (start-to-start), which slightly *raises* the read count — by at most one read per ~6 at 15 s with a 3 s read; foreground/network-restored reads are bounded by the 2 s gap and shared by the server within 5 s. KeepAlive and the sampler are unchanged.

## 17. Release gates and recommendation

Green CI is not enough (§15 is all `NOT_TESTED`). Required before release: physical evidence for foreground progression, foreground return, disconnect/reconnect, background with KeepAlive, lock/unlock, island, 돌이 motion, rail marker, 3 → 2 → 1 → 0, reservation handoff, approximate and denied location.

Recommendation: **READY_FOR_MORE_DEVICE_TESTING**. `HYBRID_TRACKING: KEEP_OFF` — no Hybrid field sample exists, so the zero-false-early gate has no evidence.

## 18. Rollback

Each milestone is its own commit; revert in reverse order. The server change is one line of stale-date arithmetic (`liveActivityContent.ts`) with no stored state. No schema, data or protected-file change; `JejuStopCrosswalk` untouched; no feature flag changed.

## 18a. Server region (2026-10-12)

Measured from Korea against production on `iad1`, server time only (first byte − request sent), median of 10:

| Request | iad1 |
|---|---|
| `/health` (no I/O) | 264 ms |
| `GET /v1/sessions/<unknown>` (one Upstash read) | 455 ms → one Redis call ≈ 190 ms |
| `/v1/vehicles` (edge-cached) | 63 ms |

A Redis call costing ~190 ms from iad1 means the Upstash database is not in US East; every live read paid the Pacific twice for the client and again for Redis. `services/api/vercel.json` now pins `regions: ["icn1"]`.

**After the move: PENDING.** Not yet measured; this PR is unmerged and production still runs on iad1. Once it deploys, the same probe (server time = first byte − request sent, median of 10, same three requests) is run against `icn1` and the numbers are recorded here. If the session read is slower than 455 ms, the move is reverted.

## 18b. Figma (2026-10-13)

File `kkx04GvqOzHje7Dw5ikO9X`:
- 02F: `RideAgainRow / V3` (`295:6024`), `돌이 RailMarker / V3` (`295:1109`, live/degraded), swapped into all `JourneyRail / V2` variants with the rail's role colour on the rim; `RecentJourneyCard / V2` described as retired.
- 03 GO: `V3 / 02 Home · returning rider` light (`296:527`), dark (`297:598`), EN (`297:656`). V2 boards kept as history.
- New page `06 Roadmap · Future Workspaces`: scope order 1–9 with status, how to start a feature, kit `Workspace / StatusChip · GateRow · Slot · FlowStep`.
- Workspaces beside the existing status notes: 07 Discover (`306:2`), 08 Eat (`307:87`), 10 Passport / Share (`307:182`). Wireframe level only; the "don't draw until the data exists" rule stands. The operating-session gate is READY (production `/health`).

## 18c. Hybrid decision (2026-10-13)

`HYBRID_TRACKING` stays **OFF** in production. No field ride has been measured, so the zero-false-early gate has no evidence; turning it on would put an unmeasured GPS path between the rider and the stop count. Revisit after the first physical rides with the Debug trace.

## 19. Progress log

- 2026-10-07: audit, baseline, reliability core (`8fa7f72`), server stale date + ground-truth mark (`7668530`), 돌이 (`b214423`, `a517c64`), Home (`07585ae`).
- 2026-10-07: disk ran out mid-test (0 bytes; even the shell's output file failed). The owner approved deleting the Codex cache, Playwright browsers and simulator data (7.6 GB freed).
- 2026-10-12: localization infrastructure, Korean copy, docs.

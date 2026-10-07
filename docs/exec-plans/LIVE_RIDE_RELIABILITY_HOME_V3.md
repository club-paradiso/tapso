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

## 6. Progress log

(Filled in as milestones land.)

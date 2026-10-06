# Boarding anchor + ride position V2

Living ExecPlan (`.agent/PLANS.md`). Branch `feat/boarding-anchor-position-v2`, from `main` at `b93f35c`. Reality labels as in `docs/DATA_VALIDATION.md`: `VERIFIED` (checked against code or an official source in this work), `MEASURED` (numbers from a run recorded here), `ASSUMPTION` (engineering choice awaiting evidence), `MISSING` (not available), `DEVICE_REQUIRED`.

## 0. Outcome and non-goals

TAPSO moves from "the rider picked a route" to "TAPSO knows the exact boarding pole, the exact variant and the confirmed vehicle, and combines official progress with on-device evidence only where that is safe". Late is acceptable; early is not.

Non-goals: no continuous or background precise GPS, no Always permission, no runtime dependency on any undocumented 제주버스정보시스템 (BIS) endpoint, no production enablement of hybrid tracking, no claim of device validation.

## 1. Audit findings (main `b93f35c`, 2026-10-06)

| # | Brief assumption | Finding | Label |
|---|---|---|---|
| A1 | Active sessions read vehicles through the 20 s cache | **Disproved.** `apiRuntime.ts` builds `JourneySessionCoordinator` on the *uncached* TAGO provider on purpose (cadence evidence needs genuinely consecutive receipts). Every session refresh was one TAGO request; N riders on a route cost N requests per poll; a rider pulling to refresh cost one per pull; no budget. The 20 s cache (and CDN `s-maxage=20`) serves only `/v1/vehicles`, which the app uses only for the pre-ride saved-stop nudge. | VERIFIED |
| A2 | Sampler asks 100 m while the engine rejects > 50 m | **Confirmed.** `RideLocationSampler` used `kCLLocationAccuracyHundredMeters` for non-urgent samples (urgent only when manual, ≤ 3 stops left, or the hybrid state was not `live`) and `requestLocation()`, which Apple documents as reporting one fix and, when the requested accuracy takes too long, delivering "a less accurate location value rather than reporting an error". `HybridPositionEngine` drops fixes worse than 50 m. "내 근처" shared the ride sampler's 60 s throttle. | VERIFIED |
| A3 | `TripOption` keeps the exact boarding pole | **Confirmed**: `boardingStopID`, `boardingSequence`, `boardingName`, `route.routeId`. The engine never received it. | VERIFIED |
| A4 | Reduced accuracy is handled | **Not handled.** No use of `accuracyAuthorization` anywhere; an approximate fix (kilometres wide) silently became `nil` evidence and "내 근처" could rank stops by it. | VERIFIED |
| A5 | Geometry is `verifiedRoadShape: Bool` | Confirmed; the app never passed geometry, so `.fused` was unreachable. No route anywhere has road geometry (`JEJU_PRODUCTION_V1.md`: `NOT AVAILABLE`). | VERIFIED |
| A6 | `RideKeepAlive` discards fixes | Confirmed: separate `CLLocationManager`, 3 km accuracy, every fix dropped unread, only during a live ride without push. | VERIFIED |
| A7 | (new) Engine compared a waiting rider's phone with the bus's position | A rider at the pole whose confirmed bus is > 1.5 km away (and its neighbours > 1.5 km) got `official_device_conflict` → `lost`. The phone was describing the rider, not the bus. | VERIFIED (test `testRiderWaitingAtPoleIsNotAConflictWithADistantConfirmedBus` reproduces V1) |
| A8 | (new) Fusion could hold a 2/1/0 milestone | With an authoritative shape, `fused` was returned before the destination guard, so device fusion could present 2/1 stops left without fresh official evidence. Unreachable today (no shape), fixed before it can be. | VERIFIED |
| A9 | (new) Official recovery below a device estimate | An official count below a *device-derived* count produced `official_backward_conflict` and stayed `lost` until TAGO caught up. TAGO's sequence can trail the bus; the official count should win (late, never early). | VERIFIED |

No open PR overlapped this work (checked 2026-10-06).

## 2. Official accessibility boarding handoff (교통약자 승차예약)

- The card appears on the vehicle-check screen (the rider is at the exact pole, on the exact variant, before the bus arrives) **only** when `JejuStopCrosswalk.shipped` has a `VERIFIED_EXACT` row for that pole whose name and coordinates still match the current stop. Otherwise nothing is shown.
- It opens `https://bus.jeju.go.kr/mobile/station/detailStation/<station>?type=station&mode=ridebooking`. `VERIFIED` (probe run 1): this is the form the official page's own `goStationPage()` navigates to.
- The page needs a 제주버스 login and offers 장애인 · 임산부 · 노약자 · 영유아동반 · 어린이 · 일반 (`VERIFIED`, probe run 1). The reservation itself is the site's `reservationTrafficWeak` request after login: TAPSO never calls it, never records an outcome and never claims success. Copy: "교통약자 승차예약 — 제주버스 공식 서비스에서 기사님께 탑승 지원을 요청할 수 있어요. 제주버스 로그인이 필요하고, 예약과 결과 확인은 제주버스에서 해요." CTA "제주버스에서 예약하기", hint "제주버스 웹사이트가 열려요".
- Station ids are `JejuBISStationID`: nine digits starting 405/406 only, so no path or query fragment can reach the URL.

## 3. Boarding anchor

`BoardingAnchor` (transit-core) = TAGO stop id, variant, provider sequence, provider name (direction marker kept), coordinate (only when surveyed), verified BIS station (or `nil`), provenance (`catalog` / `liveStopList`). It is derived each time from the catalog (`TripOption.boardingAnchor(in:crosswalk:)`) or the live stop list, never stored beside them. Users: ride setup (draft), the handoff, the engine (`boardingSequence:`; the coordinate is read from the same route), diagnostics (`diagnosticSummary`, no identifiers).

## 4. Active-ride freshness (server)

Three separate quantities, never conflated:

| Quantity | Before | After |
|---|---|---|
| Poll interval (phone) | 15 s far, 10 s near/recovery (`LivePollingPolicy`) | unchanged |
| Provider content-change cadence | median 27.52 s, max 83.10 s (`DATA_VALIDATION.md`, 2026-09-11 probe) | unchanged: polling cannot make TAGO change faster |
| Server receipt age of what a session evaluates | ≈ upstream latency (uncached) | ≤ 5 s + upstream latency, and the true receipt time travels with every row |
| TAGO requests, N riders on one route, one 10 s poll each | N | ≤ 2 (one per 5 s share window per warm instance) |
| TAGO requests, one rider pulling to refresh 10× in 10 s | 10 | 2 |
| Upstream budget | none | 600 reads/min per instance (`ASSUMPTION`: a fan-out guard, not a quota; TAGO's quota for this key is `MISSING`) |

`ActiveRideSnapshotProvider` (`services/api/src/activeRideSnapshot.ts`): route-keyed single flight; a snapshot answers further reads for < 5 s (half the fastest foreground poll, enforced < 10 s by the constructor, so one rider polling normally always gets a new read); failures are never stored; over budget a snapshot ≤ 15 s old may answer with its true receipt time, else the read fails as `PROVIDER_UNAVAILABLE` and the session degrades like any provider failure. Cadence is safe because rows keep their original `receivedAt` and `appendCadenceObservation` records a receipt at most once (`VERIFIED` by the two-session test). The public `/v1/vehicles` 20 s cache is untouched. `/health.activeRideReads` exposes the policy and outcome counters only. Per warm serverless instance: sharing across instances is not claimed.

## 5. Location sampling policy

`LocationSamplingPolicy` + `LocationFixSelector` + `LocationSampleThrottle` (transit-core, unit tested without Core Location); `RideLocationSampler` only forwards fixes. Standard updates run for a bounded window, the best acceptable fix is kept, the window ends early on a good-enough fix, updates always stop. All numbers `ASSUMPTION`.

| Mode | When | Request | Good enough | Acceptable | Window | Max fix age | Min spacing |
|---|---|---|---|---|---|---|---|
| nearbyStops | "내 근처" | 10 m | 30 m | 150 m | 5 s | 30 s | none (user-initiated, own clock) |
| normal | live, > 3 stops, bus past the pole | 10 m | 20 m | 50 m | 4 s | 10 s | 30 s |
| boarding | bus not yet past the rider's pole | 10 m | 15 m | 50 m | 6 s | 10 s | 20 s (red team: the phone only checks the anchor while waiting) |
| destinationNear | ≤ 3 stops | 10 m | 15 m | 50 m | 6 s | 10 s | 10 s |
| recovery | not live, manual recheck, or nothing evaluated yet | 10 m | 20 m | 50 m | 6 s | 10 s | 10 s |

Ride modes share one spacing clock (switching mode cannot double the rate). Acceptable ≤ `HybridPositionEngine.maximumDeviceAccuracy` (50 m) and max age ≤ `maximumDeviceAge` (20 s) are enforced by tests. Foreground only: sampling runs inside `reconcileRidePosition`, which requires the ride scene to be active.

Permissions (Apple APIs only): `notDetermined` (asks When In Use once per ride), `denied`, `restricted`, `reducedAccuracy` (`accuracyAuthorization == .reducedAccuracy`: no ride evidence at all, retained fixes are dropped, the ride shows "정확한 위치가 꺼져 있어 버스 정보로만 안내해요."; "내 근처" says it cannot tell poles apart), `fullAccuracy`. A denied or approximate permission never blocks a ride: official progress is unaffected. `requestTemporaryFullAccuracyAuthorization` is deliberately not used (it needs a new Info.plist purpose string and a prompt mid-ride; revisit with device evidence).

## 6. Hybrid V2 safety invariants

Preserved from V1 and enforced by tests: GPS never establishes or changes vehicle identity; identity stays rider-confirmed and server-authoritative; no elapsed-time-only advancement; backward and implausible official jumps fail closed; loop ambiguity fails closed; a device estimate never silently overrides contradictory official evidence.

New in V2:
1. **Boarding anchor.** Until official progress reaches the rider's pole the phone describes the rider, not the bus: it seeds no continuity, produces no estimate (`boarding_needs_official`), and a phone > 1 km from the pole is flagged (`boarding_anchor_mismatch`) without overturning fresh official progress. Fixes A7.
2. **Reconciliation.** Official progress below a device-derived count is adopted (`official_reconciled_estimate`); below an official count it still fails closed. Fixes A9.
3. **Near destination.** No device evidence on any geometry holds a 2/1/0 milestone (`destination_needs_confirmation`). Fixes A8.
4. **Geometry quality.** `RouteGeometryQuality { stopChords, derivedVehicleTrace, authoritative }` replaces the Bool. Only `authoritative` may fuse; prediction confidence 0.45 / 0.5 / 0.6, always below `fused`. Every Jeju variant is `stopChords` today.

Derived corridors (`services/api/src/derivedCorridor.ts`, schema + builder + tests only): ≥ 12 traversals, ≥ 3 distinct pseudonymised vehicles, ≥ 5 traversals per 25 m bin, ≥ 90 % coverage, stop-sequence monotonicity, speed and corridor outlier rejection, keyed-hash vehicle pseudonyms that are counted and never output, day-level provenance, label `DERIVED_VEHICLE_TRACE`, never authoritative. No corridor has been built or is served. An authoritative Jeju road shape was looked for: none is published under usable terms in the sources the repository tracks (`DATA_SOURCES.md`); `MISSING`.

## 7. Stop identifier crosswalk

See `docs/validation/JEJU_BIS_TAGO_STOP_CROSSWALK.md` (method, evidence, results) and `artifacts/jeju-stop-crosswalk/summary.json`.

## 8. Jeju BIS as validation oracle

The station page's arrival list is filled by the site's own `/data/search/getNewArriveScheduleByStationId` request, whose rows carry fields such as `currStationNm` and `routeId` (`VERIFIED` from the page script, probe run 1). That request is undocumented: it is never a runtime input. `services/api/src/positionComparison.ts` and `scripts/validation/compare-jeju-bis-position.ts` compute disagreement distributions from paired series; the tool contains no BIS reader. Collecting a BIS reference series needs owner approval as research use, a reader reviewed against probe evidence, ≤ 1 request/s, a bounded per-run budget and a dated label.

## 9. Background tracking

`RideKeepAlive` (separate manager, 3 km accuracy, fixes dropped unread, only while a live ride has no push) and `RideLocationSampler` (foreground, bounded windows, fixes in memory only) stay separate on purpose: one manager per responsibility keeps "keep the app alive" from ever becoming "track the rider". Precise hybrid sampling stays foreground-only; no Always authorization, no `allowsBackgroundLocationUpdates` on the sampler. A shared coordinator is possible later (one manager, two clients with different accuracy/consumers) but adds coupling without a measured benefit; proposed, not done.

## 10. Measurement plan

Primary safety metric: **false early stop passage / false early arrival** (`positionComparison.ts`: `early`, `falseEarlyArrival`). Any non-zero count blocks release. Also: displayed stop error (histogram, mean absolute), provider-to-display latency (transition latency median/p90), late advancement, time in estimated / rechecking / lost (RideTrace), GPS acceptance rate and accuracy distribution (trace buckets: sample outcome, 10 m accuracy), battery (Xcode Energy Log per ride, foreground minutes), API/TAGO request volume (`/health.activeRideReads.outcomes`, `providerHealth`).

## 11. Release gates and rollback

Gate (all required before enabling `TRANSIT_HYBRID_TRACKING_ENABLED` for anyone): macOS CI green; ≥ 10 real-device rides covering §12 with zero early stop passage and zero false early arrival; GPS acceptance and Energy Log reviewed; owner sign-off. The reservation card additionally needs a classified crosswalk (`VERIFIED_EXACT` rows reviewed by a person) and one device tap-through per test pole.

Rollback: hybrid stays behind `-tapsoHybridTracking` / `TRANSIT_HYBRID_TRACKING_ENABLED` (off). The reservation card disappears with an empty `JejuStopCrosswalk.shipped` (regenerate without evidence). The active-ride read path is one constructor in `apiRuntime.ts`; passing `upstream` again restores V1 exactly.

## 12. Real-device protocol (`DEVICE_REQUIRED`, not done)

Signed build from this branch (or main after merge), launch argument `-tapsoHybridTracking`, Debug `RideTrace` on. For each ride record route, variant, boarding pole, destination, confirmed plate, and write down every stop announcement with a wall-clock time (ground truth). Cases: (1) normal urban route; (2) long straight segment; (3) dense stops; (4) turn/curve; (5) loop or repeating variant; (6) provider freeze (watch for `rechecking`/`predicted`); (7) lock then resume; (8) Precise Location off; (9) location denied; (10) destination approach 3→2→1→0. Also: wait at a pole while the confirmed bus is ≥ 2 km away (A7); pull to refresh twice quickly; relaunch mid-ride. Export the trace, compare with `compare-jeju-bis-position.ts --displayed/--reference`; report early/late transitions, false arrival, time per trust state, sample outcomes and accuracy buckets. Never commit raw coordinates.

## 13. Known unknowns

TAGO quota (`MISSING`); TAGO observation lag (unmeasurable without a provider timestamp); real GPS acceptance under the new policy on Jeju buses (multipath, in-bus attenuation); battery cost; whether the BIS station page id equals the stripped TAGO id island-wide (§7); BIS page markup stability; authoritative road geometry (`MISSING`).

## 14. Progress

- 2026-10-06: audit (§1); API active-ride path + tests; crosswalk classifier, offline audit, probe workflow; transit-core anchor/crosswalk/handoff/sampling/V2 engine + tests (macOS `swift test` green on first push); derived corridor + metrics; iOS sampler, model, card, copy. Probe runs 1–2 in `JEJU_BIS_TAGO_STOP_CROSSWALK.md`.
- Next: classify the crosswalk from official evidence (§7), then device validation (§12). Do not enable hybrid in production.

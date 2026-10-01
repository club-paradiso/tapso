# Jeju safety layer V3: Safe Return, Transfer Guardian, Rescue

Three decisions that make TAPSO useful exactly where a Jeju bus trip goes
wrong: the way back, the connection, and the mistake. All three are pure,
deterministic functions over facts another system established; none of them
invents a timetable, an arrival time or a walking distance.

| | Server | Swift core | Specification |
|---|---|---|---|
| Safe Return | `evaluateSafeReturn` | `SafeReturn.evaluate` | `fixtures/journey/safe-return-v1.json` (14 cases) |
| Transfer Guardian | `assessTransfer` | `TransferGuardian.assess` | `fixtures/journey/transfer-guardian-v1.json` (12 cases) |
| Rescue | `planRescue` | `Rescue.plan` | `fixtures/journey/rescue-v1.json` (12 cases) |

Implementations: `services/api/src/journeySafety.ts`,
`packages/transit-core/Sources/TapsoTransit/JourneySafety.swift`. Tests run
every case in both languages plus generated properties
(`journeySafety.test.ts`, `JourneySafetyTests.swift`). Each specification
records its policy constants, and both test files fail if an implementation's
constants drift from it.

Times are minutes on one clock where the caller's "now" is 0. A range
(`{min, max}`) is what the evidence allows, never a single guessed instant.

## Reality labels

| Input | Where it comes from today | Label |
|---|---|---|
| Return departures (a full list) | **No verified source.** TAGO publishes no timetable in the services TAPSO uses (`DATA_VALIDATION.md`). Jeju's official timetables (data.go.kr 3043887, per-route files from the bus information system) are identified, not imported (`DATA_SOURCES.md`) | `MISSING` → evaluates to `unknown` |
| Last departure of a route variant | TAGO `getRouteInfoIem` through `GET /v1/route-info`: first and last departure (`HHMM`) from the route's **starting stop**, and average headways (data.go.kr dataset 15098529) | Shape `REPORTED-OFFICIAL`. Live, `VERIFIED` 2026-10-01: for all 58 variants of routes 102, 202, 282, 365 and 800, TAGO sends no first or last departure and only a weekday headway of `"0"` (`meta.undocumentedFields`, unused), so every Jeju variant evaluates to `unknown`; Jeju's last buses need its own timetables (`DATA_SOURCES.md`). Used as one conservative departure (`LastBus`): a bus passes later stops after it leaves the starting stop |
| Feeder arrival range | Remaining stops on the live route × an assumed per-stop band, until an arrival-prediction source is verified | `ASSUMED` band, labelled as an estimate |
| Connecting bus range | Same as above for a live connecting bus | `ASSUMED` band |
| Walking metres | Haversine between surveyed stop coordinates (TAGO `gpslati`/`gpslong`) | `VERIFIED` coordinates, straight-line distance (a lower bound) |
| Where the bus is after the destination | The journey session's `progress.currentStopSequence`: TAGO's stop sequence, or the near-stop estimate (`progress.source`) | As the session labels it. Rescue's exit is the stop *after* it, because TAGO says where the bus is, not whether its doors are open |
| A bus back the other way through both stops | **No verified source.** Route variants are separate TAGO routes and TAPSO does not yet pair their stops | `MISSING` → Rescue never offers a ride back; the map app does that search |
| Policy constants | Product choices | `ASSUMED` |

So in live use today Safe Return honestly answers `unknown` for most places,
with one exception since V2.4b: after a live ride the end screen shows each
variant's last departure where TAGO publishes one (for Jeju routes it publishes
none, `VERIFIED` 2026-10-01) (`ReturnTripCard`), evaluated with `departures: [last]`,
`arrival: 0`, `minimumStay: 0`, so the rider sees "be at the stop by" the last
departure minus the 10-minute margin, never a time the bus passes their stop.
That is the intended behaviour, not a gap to paper over: `unknown` is never
shown as safe, and Discover never presents an `unknown` return as "다녀오기 좋아요".

Since V2.4d the rider can put one variant's "be at the stop by" on the Lock Screen
and in the Dynamic Island as a countdown the system runs (`TapsoReturnAttributes`,
`LIVE_ACTIVITY_SPEC.md`): the leave-by warning of "I'm going home", with no push
and no location.

Rescue is in the ride since V2.4c for one situation, the passed destination
(`PassedStopRescue`, below). Missed connections and wrong direction wait for a
ride with a planned transfer and for a verified opposite-direction pairing.

## Safe Return

"Can I get back from there?" The reusable status every recommendation surface
reads (Discover, Eat, route discovery, next-stop discovery, Mystery Ride, TAPSO
Drop). A recommendation whose level is `notRecommended` is never shown.

Policy (`ASSUMED`): be at the stop 10 min before the last practical bus;
90 min of slack beyond a useful visit is comfortable; under 20 min is tight; a
gap of 40 min or more between catchable buses is said out loud; estimates
derived from live data expire after 15 min.

Rules, in order:

1. No return data (`quality: unknown` or no list) → `unknown` (`returnUnknown`).
2. An `estimated` list older than 15 min, or of unknown age → `unknown` (`dataExpired`).
3. Unknown arrival → `unknown` (`arrivalUnknown`).
4. Catchable departures: at or after arrival + walk, and no later than the last
   *practical* departure when one is given (a later bus that does not get the
   rider home does not count). None → `notRecommended` (`noReturnService`).
5. `leaveBy = last − walk − 10`. If arrival + minimum stay is after `leaveBy` →
   `notRecommended` (`noTimeForVisit`).
6. Slack = `leaveBy − (arrival + minimum stay)`: ≥ 90 `comfortable`, ≥ 20
   `leaveBy`, else `tight`.
7. The longest gap between catchable buses after a useful visit ≥ 40 →
   `longWait`, and `comfortable` becomes `leaveBy`.
8. A relevant disruption → `disruption`, one level lower (never below `tight`;
   whether the visit fits was decided in step 5).
9. `estimated` data → `estimatedTimes` (surfaces say "약").

| Level | Korean (surface) |
|---|---|
| `comfortable` | 오늘 다녀오기 좋아요 |
| `leaveBy` | {leaveBy} 전에는 돌아오는 게 좋아요 |
| `tight` | 짧게 다녀올 수 있어요 · {leaveBy}까지 정류장으로 |
| `notRecommended` | 지금은 다른 곳이 나아요 |
| `unknown` | 돌아오는 버스 시간을 아직 확인하지 못했어요 |
| reason `longWait` | 그 뒤로는 다음 버스까지 {longestWait}분 기다릴 수 있어요 |

## Transfer Guardian

"Is this transfer still realistically achievable?" — not "8분 후 환승".

Policy (`ASSUMED`): a worst-case margin of 4 min or more is `safe`; a wait of
30 min or more for the following connection is said out loud.

- Ready window = feeder arrival range + walk between stops.
- Worst margin = connection's earliest departure − latest readiness; best
  margin = connection's latest departure − earliest readiness.
- best < 0 → `missed`; worst ≥ 4 → `safe`; worst ≥ 0 → `tight`; otherwise
  `atRisk` (makeable only if things go well).
- No feeder or connection estimate → `unknown`; an invalid range or negative
  walk → `unknown` (`invalidInput`). A Rescue plan in force → `recovering`.
- `waitIfMissed` = following connection − earliest readiness, only when that
  bus leaves after the rider could be ready.

`unknown` never produces urgency (`JOURNEY_CONTRACT_V3.md`: it renders as
`riding`). `tight` stays inside the transfer detail; only `atRisk` and `missed`
take the Lock Screen and the island.

| Risk | Korean |
|---|---|
| `safe` | 환승 여유 있어요 |
| `tight` | 환승이 빠듯해요 · 내리면 바로 {stop}으로 |
| `atRisk` | 환승을 놓칠 수 있어요 |
| `missed` | 이번 환승은 어려워요 |
| `recovering` | 다른 길로 안내하고 있어요 |
| `unknown` | (no urgency; the ride view shows the transfer stop only) |

## Rescue

"한 정거장 지나쳤어요." answered with what to do, never only an error. The first
option is the recommendation; a map-app hand-off is always last, because a
map app can search routes TAPSO cannot (`MAP_APP_HANDOFF_V2.md`).

Policy (`ASSUMED`): walking 70 m/min (about 4.2 km/h); no walk back over
1 200 m; a walk of 15 min or less is preferred over waiting; a wait of 30 min or
more is marked long.

| Situation | Options, in order |
|---|---|
| Passed the destination | Walk back from the next stop when measured and ≤ 1 200 m (preferred when ≤ 15 min, when there is no bus back, or when it is no longer than the known wait); ride back on the opposite direction of the same route; map app |
| Missed connection | Wait for the next connection when it is under 30 min; otherwise known alternative routes first and the long wait after them, marked long; map app |
| Wrong direction | Get off at the next stop and ride back the other way when the route runs both ways; map app |

Every option says what it knows: a walk in whole minutes rounded up, a wait in
minutes or nothing when unknown.

### In the ride: the passed destination (V2.4c)

When the bus is placed beyond the rider's stop, the ride screen answers
"목적지를 지났어요" with `PassedStopRescue.advice` (Swift core):

- **Exit:** the first stop after both the destination and the stop the session
  last placed the bus at, by provider sequence (stop ids repeat round a loop).
  At the end of the line it is the bus's own stop. Unknown position → no stop is
  named and the generic "다음 정류장에서 내려 돌아가세요" stays.
- **Walk back:** straight-line metres from the exit to the destination stop,
  rounded to 10 m, only when every stop's coordinates are surveyed (never the
  demo's synthetic ones). The engine offers it up to 1 200 m; the screen shows
  the distance and says the real walk is longer, never minutes. A measured walk
  beyond the limit is said once ("직선으로도 … m라 걸어가기엔 멀어요").
- **Ride back:** never offered (`oppositeDirection` stays unknown, see the
  labels above).
- **Map app:** always last. NAVER Map and, with a real coordinate, KakaoMap open
  a walking route to the shared place when the ride started from one, otherwise
  to the destination stop.
- **Every surface says the same exit:** the Live Activity's `nextStopName`
  carries it, and the Lock Screen, the expanded island and the VoiceOver
  announcement read it through `RideText.detail` (`LIVE_ACTIVITY_SPEC.md`).

Tests: `PassedStopRescueTests` (core), `MapHandoffFlowTests` (demo: next stop
named, nothing measured; the way back to a shared place) and
`TapsoAPIClientTests` (a live session reporting `passed_destination` at stop 11
of 12: exit 12, 580 m, walk then map app). Snapshots `17-ride-passed` and
`30-ride-passed-walk-back`.

## What this does not do

- It does not pick a bus or a stop sequence; that stays with the matcher and
  the rider.
- It does not fetch anything. Inputs are assembled by the journey session (server)
  or the app, from data whose label is recorded above.
- It does not turn `unknown` into a number. A surface that cannot say something
  true says less.

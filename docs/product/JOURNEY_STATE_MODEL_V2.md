# Journey state model V2

One model, every surface. `RideGuidancePolicy` (`packages/transit-core/Sources/TapsoTransit/RideGuidance.swift`) turns a `RideSignal` — journey phase, remaining stops, freshness, whether the destination was passed, whether the phone is offline — into a `RideGuidance`: the moment, both trust signals, milestone, haptic, colour role, symbol, recovery action, copy keys, relevance and how the count may be shown. The app hero, Lock Screen, every Dynamic Island region, alerts, haptics and VoiceOver all read that one value. The app's `ActiveRide.signal` and the Live Activity's `ContentState.signal` build the same `RideSignal`, so the surfaces cannot disagree (`RidePresentationTests.testContentStateCarriesTheSameGuidanceAsTheApp`).

It changes no journey semantics: `JourneyStateMachine`, `RideSession` and `DestinationProgressEngine` are untouched, and the matcher is not involved. Pre-ride stages come from `SetupStep` (app) and `VehicleCheckStage` (core).

## Mapping to the requested states

| Requested state | Code | Surfaces |
|---|---|---|
| SETUP | `SetupStep.search` / Home | App |
| ROUTE_SELECTED | `SetupStep.routes` → `.boarding` | App |
| BOARDING_CONTEXT_READY | `RideDraft` set, `SetupStep.vehicleCheck` | App |
| MATCHING | `VehicleCheckStage.searching`, `.notFoundYet` | App |
| MULTIPLE_CANDIDATES | `VehicleCheckStage.similarBuses` | App |
| CONFIRMATION_REQUIRED | `VehicleCheckStage.proposed` | App |
| ACTIVE | `RideMoment.riding` | App, Lock Screen, Island |
| TWO_STOPS | `RideMoment.prepare` | all |
| NEXT_STOP | `RideMoment.nextStop` | all |
| ARRIVED | `RideMoment.arrived` | all |
| DEGRADED_DATA | `RideMoment.delayed` | all |
| VEHICLE_TEMPORARILY_LOST | `RideMoment.vehicleLost` | all |
| OFFLINE | `RideMoment.offline` | all |
| PASSED_DESTINATION | `RideMoment.passedDestination` | all |
| (signals disagree) | `RideMoment.checking` | all |
| ENDED | `RideMoment.ended`, `RideOutcome` | App end screen; activity ends |

Live Activities start only after the rider confirms the bus, so pre-ride stages have no Lock Screen or island surface.

## Precedence (fail closed)

```text
completed/cancelled      → ended
remaining < 0            → checking
offline                  → offline
vehicleTemporarilyLost   → vehicleLost
stale or dataStale       → delayed
unknown or recovering    → checking
aging or dataAging       → delayed
destination passed       → passedDestination   (only with phase arrived and 0 left; else checking)
(approaching, 2)         → prepare
(nextStopIsDestination, 1) → nextStop
(arrived, 0)             → arrived
(active, ≥3)             → riding
anything else            → checking
```

A milestone exists only for `prepare`, `nextStop`, `arrived`. `RideGuidanceTests.testMilestonesRequireExactFreshOnlineAgreementForEveryInput` checks every phase × count −2…10 × freshness × passed × offline. The Live Activity additionally treats a system-stale activity as stale data (`guidanceAccountingForStaleness`).

## Ride moments

Colour roles map to `TapsoColor.journey(_:)`; Figma `color/journey/*`. Copy keys are `ride.<moment>.headline|detail|eyebrow|compact`. Haptics play only while the app runs — iOS offers no custom vibration for a Live Activity (research, `MAP_APP_HANDOFF_V2.md` sources). A milestone's Live Activity alert (screen, default sound, expanded island) is sent by the running app: this build has no remote updates (`pushType: nil`, APNs `BLOCKED_BY_CREDENTIALS`), so while the app is suspended nothing advances and every surface turns to "delayed" at the stale date. Each milestone buzzes and alerts at most once per ride; the set of signalled milestones is persisted with the ride (`ActiveRide.alertedMilestones`), so a relaunch or a delayed/lost/offline interruption does not repeat one.

### riding — ACTIVE
- **Question:** How is my ride going?
- **Primary:** remaining stops (live). **Secondary:** destination, "내릴 때 알려드릴게요 · 지금은 편하게 가셔도 돼요".
- **CTA:** none (여정 끝내기 at the bottom). **Colour:** `journeyActive` mint. **Symbol:** `bus.fill`. **Motion:** numeric count transition. **Haptic:** none. **Alert:** none, relevance 50.
- **App:** big count + "정거장 남았어요" + "…까지", rail, trust badges, stop ladder. **Lock Screen:** basalt, headline, count, rail, 돌이. **Compact:** 돌이 + route · count + 정거장. **Minimal:** count. **Expanded:** route · 타고 가는 중 · count; headline, destination, rail, both trust badges.
- **VoiceOver:** "365번, 제주출입국·외국인청까지 6정거장 남음. 내릴 때 알려드릴게요. 지금은 편하게 가셔도 돼요."
- **Recovery:** none needed.

### prepare — TWO_STOPS
- **Question:** Should I start preparing?
- **Primary:** "2정거장 남았어요". **Secondary:** "내릴 준비를 해주세요", next stop name.
- **CTA:** none. **Colour:** `journeyPrepare` amber (ink text). **Symbol:** `figure.stand`. **Haptic:** `.preparation` (soft impact). **Alert:** once, "2정거장 남았어요 / 내릴 준비를 해주세요", relevance 85.
- **App:** amber hero with the fixed two, next stop. **Lock Screen:** basalt, amber accent, count 2, rail. **Compact:** pill "준비 2". **Minimal:** 2. **Expanded:** 내릴 준비, count, rail.
- **VoiceOver:** "…2정거장 남음. 2정거장 남았어요. 내릴 준비를 해주세요."

### nextStop — NEXT_STOP
- **Question:** Do I get off next?
- **Primary:** "다음에 내려요" and the destination name. **Secondary:** "다음 정류장이 목적지예요. 하차벨을 눌러주세요".
- **CTA:** none (the action is the stop button on the bus). **Colour:** `journeyNext` coral. **Symbol:** `bell.fill` (bounce once). **Haptic:** `.nextStop` (warning notification — strong). **Alert:** once, relevance 95.
- **App:** full coral hero. **Lock Screen:** the whole surface turns coral (`activityBackgroundTint`), count 1, no rail. **Compact:** pill "다음 하차". **Minimal:** 1. **Expanded:** 다음 정류장, headline, destination.
- **VoiceOver:** "…1정거장 남음. 다음에 내려요. 다음 정류장이 목적지예요. 하차벨을 눌러주세요." Marked `updatesFrequently`.

### arrived — ARRIVED
- **Question:** Is this where I leave?
- **Primary:** "여기서 내려요" and the destination. **Secondary:** "목적지에 도착했어요".
- **CTA:** **내렸어요** (ends the ride). **Colour:** `journeyArrival` tangerine — the destination colour fills the surface. **Symbol:** `figure.walk`. **Haptic:** `.arrival` (success). **Alert:** once, relevance 100; no stale date.
- **Lock Screen:** tangerine surface, walk symbol. **Compact:** pill "내려요". **Minimal:** walk symbol. **Expanded:** 도착, headline, detail.
- **Recovery:** finish ride → End screen with the walking hand-off.

### passedDestination — PASSED_DESTINATION
- **Question:** Did I miss it — what now?
- **Primary:** "목적지를 지났어요". **Secondary:** "다음 정류장에서 내려 돌아가세요", "내릴 곳: …".
- **CTA:** **네이버 지도에서 목적지 찾기**; **여정 끝내기**. **Colour:** `journeyNext` outline. **Symbol:** `arrow.uturn.backward`. **Haptic:** `.attention` once (in app). **Alert:** none — never the arrival alert. Relevance 95.
- **Determinable when:** the tracked bus is observed beyond the destination (`DestinationProgressPhase.passedDestination`) on fresh data; on stale data it stays `delayed`.

### delayed — DEGRADED_DATA
- **Question:** Is something wrong?
- **Primary:** banner "실시간 정보가 잠시 늦고 있어요". **Secondary:** "추적은 계속하고 있어요. 차내 안내도 함께 확인해주세요"; last-known count dimmed, labelled "마지막 확인".
- **Colour:** `journeyDegraded` slate; data badge "업데이트 지연" amber. **Symbol:** `clock.arrow.circlepath`. **Haptic/alert:** none. Relevance 75. **Recovery:** check the bus's own stop display; resumes on the next fresh observation.

### vehicleLost — VEHICLE_TEMPORARILY_LOST
- Banner "버스를 잠시 찾지 못했어요 · 추적은 유지하고 있어요. 다시 보이면 바로 이어서 알려드릴게요"; vehicle badge "버스 찾는 중"; last-known count; slate; `magnifyingglass`; no haptic or alert. Never switches to another bus silently (server rule; the app never rematches).

### offline — OFFLINE
- Banner "인터넷 연결이 끊겼어요 · 연결되면 바로 이어서 추적해요"; data badge "오프라인"; vehicle badge stays "차량 확인됨"; last-known count; slate; `wifi.slash`; no haptic or alert. Outranks every ride state except `ended` and an impossible count (`remaining < 0` → checking), as in the precedence table.

### checking
- Blue banner "버스 위치를 다시 확인하고 있어요 · 확실해질 때까지 하차 알림은 보내지 않아요"; count hidden; `arrow.triangle.2.circlepath`. Produced by any phase/count disagreement, unknown freshness or recovery.

### ended — ENDED
- The activity ends with the final state (one-minute dismissal after a completed ride, immediate after cancel). App shows `RideEndView`.

## Pre-ride stages (app only)

| Stage | Headline / detail | Colour | Action |
|---|---|---|---|
| searching | 버스를 찾고 있어요 / 정류장으로 오는 %@번을 확인하고 있어요 | checking blue, pulsing symbol (stops under Reduce Motion) | Cancel |
| proposed | 이 버스로 보여요 / 탈 때 번호판 끝자리를 확인해주세요 | vehicle needs-confirmation blue → confirmed mint | 맞아요, 이 버스를 탔어요 · 다른 버스예요 |
| similarBuses | 비슷한 버스가 있어요 / 탑승한 버스를 골라주세요 | blue | tap a bus · 둘 다 아니에요 |
| notFoundYet | 아직 오는 버스가 안 보여요 / %@번 버스가 보이면 바로 알려드릴게요 | blue | Cancel |
| confirmed | 버스를 확인했어요 / 체험판은 앱을 켜 두면 끝까지 진행돼요 | mint | — |

Two or more proposals are always a question, never a pick (`RideSetupTests.testTwoBusesAreAlwaysARiderQuestionNeverAPick`). No percentage or confidence value is ever shown.

## Two trust signals

| Vehicle identity (`VehicleIdentityStatus`) | Data (`DataLinkStatus`) |
|---|---|
| `confirmed` 차량 확인됨 ••0001 | `live` 실시간 |
| `rechecking` 차량 확인 중 | `delayed` 업데이트 지연 |
| `lost` 버스 찾는 중 | `offline` 오프라인 |
| | `checking` 연결 확인 중 |

They are computed independently, so "the right bus, late data" and "live data, bus missing" are both expressible.

## Count presentation

`live` for riding, prepare, nextStop; `lastKnown` (dimmed, "마지막 확인") for delayed, vehicleLost, offline; `hidden` (symbol instead) for arrived, passedDestination, checking, ended.

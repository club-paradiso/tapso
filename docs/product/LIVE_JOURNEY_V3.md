# Live journey V3 (beta)

The app's first real data path: a rider takes an actual Jeju bus with TAPSO,
on the server's journey sessions, with the bus confirmed by the rider. The demo
keeps its synthetic catalogue and scripts, labelled as before.

## Flow

```text
Home › 버스 번호로 타기 (실시간 · 베타)
  GET  /v1/routes?cityCode=39&routeNo=202      every official variant (direction, branch)
  GET  /v1/stops?routeId=…&cityCode=39          the variant's real stop list, in provider order
  rider picks boarding, then destination (by provider sequence)
  POST /v1/sessions {routeId, cityCode, boardingStopSequence, destinationStopSequence, riderState: waiting_at_stop}
  GET  /v1/sessions/:id                         every 10 s while waiting
  rider taps the bus whose plate they can see
  POST /v1/sessions/:id/confirm {vehicleId}
  GET  /v1/sessions/:id                         every 15 s while riding (app running)
  DELETE /v1/sessions/:id                       when the rider finishes or cancels
```

| Piece | Where |
|---|---|
| The one network client | `apps/ios/TapsoApp/TapsoAPIClient.swift` |
| Wire types, failure taxonomy | `packages/transit-core/.../TransitAPIModels.swift` |
| Session → surfaces | `packages/transit-core/.../LiveSessionInterpreter.swift` |
| Flow and polling | `TapsoAppModel` (Live rides section) |
| Screens | `LiveRideSetupViews.swift`, `VehicleCheckView`, `RideView` |

## Who decides

- **The server ranks in shadow, the rider identifies.** Matching runs in shadow
  mode on the server (`directed-route-progress-v1`, readiness
  `READY_FOR_SHADOW`). At that readiness riders see nothing from the matcher
  (issue #80): every pre-selection session carries `vehicleChoice`
  (`presentation: "rider_identifies"`), the buses of the route variant that the
  latest provider read places where they can still be boarded, nearest the stop
  by stop count. No score, cadence verdict, passage memory or approach window
  shapes it, and a bus seven stops out is listed as plainly as one at the stop.
  The app shows them as `choose` ("타는 버스를 골라주세요"), even when there is
  one: never "이 버스로 보여요", never preselected. A bus two or more stops past
  the stop is never shown to a waiting rider
  (`LiveSessionInterpreterTests.testADepartedBusIsNeverProposed`). Only
  `presentation: "matcher_suggestion"`, which the server sends from
  `READY_FOR_CONFIRMATION_ASSISTED` up, lets the app present the matcher's
  `confirmation_required` candidates as a suggestion; a tap still commits. A
  server that does not say gets the rider-identifies reading.
- **Freshness comes from the server's state.** `tracking` means the selected bus
  had fresh server-observed cadence on that poll; `degraded` shows the last known
  count, dimmed, with no alert; `lost` shows the bus as missing. The app never
  re-reads freshness from a timestamp: TAGO publishes no observation time and
  `evidenceAt` is TAPSO's receipt time.
- **Silence only ages data.** If a read fails, the ride turns `delayed` after
  30 s without an answer and never becomes fresher than the server last said.
- **Nothing reaches the Swift matcher.** `crossLanguageAuthority.test.ts`
  keeps every network API in the client, the client on `tapso-api.vercel.app`
  and documented endpoints, and Swift matcher types out of it.

## Failures, said plainly

Each failure keeps its meaning from server to screen (`TransitAPIFailure`,
`live.error.*` copy):

| Situation | Code | What the rider sees | Polling |
|---|---|---|---|
| No connection | URLError | 인터넷 연결이 끊겼어요 | continues |
| Bus feed slow | `PROVIDER_TIMEOUT` (504) | 버스 정보가 늦게 와요 | continues |
| Bus feed unreachable | `PROVIDER_UNAVAILABLE` (502) | 버스 정보를 못 받았어요 | continues |
| Bus feed malformed | `PROVIDER_RESPONSE_INVALID` (502) | 버스 위치를 잠시 확인할 수 없어요 | continues |
| Live rides off on the server | `SESSIONS_UNAVAILABLE` (503) | 실시간 승차는 준비 중이에요 | stops |
| Session expired / unknown | 410 / 404 | 여정 시간이 지났어요 / 여정을 찾을 수 없어요 | stops; setup starts a new session |
| TAPSO failed | `INTERNAL_ERROR` (500) | 탑서 서버에 문제가 생겼어요 | continues |

No failure produces a proposal or a get-off alert.

## Production state

Production journey sessions answer `503 SESSIONS_UNAVAILABLE` until the four
variables in `PRODUCTION_TRANSIT_API.md` (*Enabling durable sessions in
production*) are set on the `tapso-api` project. Until then a live ride ends at
the vehicle check with the "준비 중" notice; route and stop reads work.

## Limitations

- **Route number first.** TAPSO's API has no stop-name search, and inventing
  one from a stale list would send riders to the wrong stop. Destination-first
  search remains demo-only until a server search exists.
- **App running only.** Without APNs (`BLOCKED_BY_PAID_MEMBERSHIP`), a live ride
  advances while the app runs; the Live Activity turns `delayed` at its stale
  date otherwise.
- **Quota.** Each session read is one uncached TAGO request on the server.
  Polling is 10 s while waiting and 15 s while riding, and stops when the ride
  ends, the server ends the session, or the rider leaves setup.
- **Loops.** A session needs the destination after the boarding stop in
  provider order, so a ride across a loop's seam is not offered.

## Evidence

- `services/api/test/sessionViews.test.ts`: the payloads the Swift core is
  tested on (`fixtures/journey/session-views-v1.json`, 14 scenarios) are
  regenerated from the server's coordinator and must match the committed file.
- `LiveSessionInterpreterTests` (Swift core): proposals, moments and failure
  classification over those payloads.
- `TapsoAPIClientTests` (app): requests, bodies and every failure class against
  a stubbed transport, and the whole live flow from route search to `DELETE`.
- `crossLanguageAuthority.test.ts`: the network guard, checked to fail when a
  network API appears in another file or the client's host changes.

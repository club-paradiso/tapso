# Jeju Route 365 live-transit validation — 2026-09-10

Status: `AUTHENTICATED_B551982_JEJU_ROUTE_MASTER_EMPTY`

This report intentionally contains no service key, request URL containing a key, or raw vehicle identifiers from a live capture.

## Verified official metadata

- Public Data Portal resource `15157601` is described by the portal as nationwide ultra-precision realtime bus information.
- TAPSO's current provider base URL is `https://apis.data.go.kr/B551982/rte`.
- The inspected contract exposes `/mst_info`, `/ps_info`, and `/rtm_loc_info`.
- The portal describes route master, route-stop, and realtime vehicle-position data in JSON/XML.
- Development traffic allowance is 5,000 calls/day.
- Jeju's official passenger interface currently lists Route 365, so a zero-result route-master response must not be interpreted as proof that Route 365 itself does not exist.

## Authenticated live finding

On 2026-09-10 the operator loaded the newly issued service key in a local shell without exposing it and successfully reached the B551982 route-master endpoint through TAPSO's provider. The request did not fail with a credential error. Instead, the provider returned zero route-master records for every tested Jeju-oriented `stdgCd` candidate:

| Tested `stdgCd` | `/mst_info` normalized route count | 365 candidate |
|---|---:|---|
| `50110` | 0 | none |
| `5011000000` | 0 | none |
| `50` | 0 | none |
| `5000000000` | 0 | none |

Therefore:

- the newly issued key is accepted by resource 15157601;
- the failure is no longer `BLOCKED_BY_CREDENTIALS`;
- TAPSO has no evidence that B551982 currently exposes Jeju Route 365 through the tested `stdgCd` forms;
- the third-party value `6522` remains untrusted for B551982 because `/mst_info` did not confirm it;
- it would be incorrect to tune runtime tracking thresholds from B551982 before obtaining actual Jeju vehicle observations.

This does **not** prove that resource 15157601 contains no Jeju data under every possible code or internal mapping. It proves only that the official endpoint returned no route-master rows for the four tested Jeju-oriented values, despite valid authentication.

## Fallback source selected for next validation

The next official source to validate is the Ministry of Land, Infrastructure and Transport TAGO bus family:

- resource `15098529`: `국토교통부_(TAGO)_버스노선정보`
  - service base: `https://apis.data.go.kr/1613000/BusRouteInfoInqireService`
  - portal describes nationwide, realtime route information and provides a city-code lookup operation;
  - route numbers and route IDs can be resolved before requesting route details / route stops.
- resource `15098533`: `국토교통부_(TAGO)_버스위치정보`
  - service base: `https://apis.data.go.kr/1613000/BusLcInfoInqireService`
  - `getRouteAcctoBusLcList` returns live bus positions for a `cityCode + routeId` pair;
  - documented output includes route number, WGS84 coordinates, stop order/name/ID, route type, and vehicle number.

Both TAGO services have a development allowance of 10,000 calls/day according to the current portal pages. They require their own approved API access; possession of a B551982 key permission must not be assumed to grant TAGO permission.

## Remaining questions

| Question | Result |
|---|---|
| Newly issued key accepted by resource 15157601 | `VERIFIED` |
| B551982 `/mst_info` returns Route 365 for tested Jeju codes | `NO` |
| Official B551982 route ID for 365 | `UNRESOLVED` |
| B551982 Jeju stop list / realtime vehicles | `NOT_TESTED_WITH_CONFIRMED_ROUTE_ID` |
| TAGO Jeju city code | `PENDING_TAGO_ACCESS` |
| TAGO official Route 365 ID | `PENDING_TAGO_ACCESS` |
| Realtime provider refresh cadence | `UNVERIFIED` |
| Vehicle identifier continuity | `UNVERIFIED` |
| Active vehicle count stability | `UNVERIFIED` |
| Coordinate continuity | `UNVERIFIED` |
| Direction / route-variant semantics | `UNVERIFIED` |
| Realtime stop-sequence availability | `UNVERIFIED` |
| Event-code behavior | `UNVERIFIED / TAGO_LOCATION_CONTRACT_DOES_NOT_DOCUMENT_AN_EVENT_CODE` |
| Temporary disappearance / reappearance | `UNVERIFIED` |

## Repository implications

1. Do not continue guessing B551982 `stdgCd` values in production code.
2. Keep the B551982 provider as a potentially useful nationwide/ultra-precision source, but treat Jeju coverage as empirically unconfirmed.
3. Add a TAGO provider behind the same transit-provider boundary rather than baking TAGO DTOs into journey-session logic.
4. Resolve TAGO's official Jeju `cityCode` through its city-code lookup operation, then resolve Route 365 via the official route list. Do not hard-code a third-party route ID.
5. TAGO's documented bus-location response does not expose a provider collection timestamp comparable to B551982 `gthrDt`; cadence analysis must therefore distinguish polling time from actual snapshot-content changes rather than pretending the polling timestamp is a provider timestamp.
6. Only after Route 365 produces live snapshots should TAPSO tune cache TTL, missing-vehicle grace, matcher freshness, or proximity radius.

## Exact next action

Approve/add the two TAGO APIs (`15098529` and `15098533`) to the public-data project/key used for TAPSO. Then use the official city-code lookup, route-number lookup, and location endpoint to determine Jeju's TAGO city code and Route 365 ID before running the repeated spike.

Raw live captures should remain local. Commit only sanitized aggregate findings and representative fixtures that do not unnecessarily retain vehicle identifiers.

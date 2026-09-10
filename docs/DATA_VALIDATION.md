# Transit data validation

## Current evidence

| Question | Result |
|---|---|
| Official B551982 resource 15157601 provides route, route-stop, and realtime position data by contract | `VERIFIED_FROM_OFFICIAL_METADATA` |
| B551982 base URL and route/stop/realtime paths | `VERIFIED_FROM_SWAGGER` |
| B551982 development traffic allowance is 5,000 calls/day | `VERIFIED_FROM_OFFICIAL_METADATA` |
| API rejects a missing service key | `VERIFIED` |
| Newly issued key is accepted by B551982 | `VERIFIED_FROM_AUTHENTICATED_CALL` |
| B551982 `/mst_info` returns Jeju Route 365 for tested Jeju-oriented codes | `NO`; zero route-master rows for `50110`, `5011000000`, `50`, and `5000000000` |
| Route 365 is currently listed in the Jeju passenger bus system | `VERIFIED_FROM_PUBLIC_PASSENGER_INTERFACE` |
| TAGO Jeju city code | `39`; `VERIFIED_FROM_AUTHENTICATED_OFFICIAL_RESPONSE` |
| TAGO Route 365 official route IDs | `VERIFIED`; six variants returned by official TAGO route lookup |
| TAGO Route 365 full-length directions | `LIKELY` `JEB405136521` (제주대→한라대) and `JEB405136522` (한라대→제주대); topology/live validation pending |
| TAGO realtime vehicle positions for Route 365 | `PENDING` |
| Vehicle ID stable across observations | `UNVERIFIED` |
| Stop ordering and opposite direction distinguishable | `UNVERIFIED` |
| TAGO live payload includes usable stop order | `PENDING_LIVE_SCHEMA_CAPTURE` |
| Branch/variant semantics | `PARTIALLY_VERIFIED`; six route IDs with distinct endpoints |
| Real polling/snapshot-change cadence and dropout distribution | `UNVERIFIED` |
| Enough evidence for automatic vehicle matching | `UNVERIFIED` |

## Verified TAGO Route 365 variants

Official TAGO route lookup (`cityCode=39`, `routeNo=365`) returned:

- `JEB405136521`: 제주대학교 → 제주한라대학교(종점)
- `JEB405136522`: 제주한라대학교 → 제주대학교
- `JEB405136523`: 영주고등학교 → 제주한라대학교(종점)
- `JEB405136524`: 제주한라대학교 → 영주고등학교
- `JEB405136525`: 월성마을/선사유적지 → 제주대학교
- `JEB405136530`: 제주대학교병원 → 제주한라대학교(종점)

All six rows reported `routetp=급행버스`; do not use that field alone as product truth. Preserve `routeid` and endpoint/stop topology for variant identity.

## Phase 1 conservative behavior

- Route-scoped caching shares successful snapshots across sessions and never caches provider failures.
- Vehicle cache defaults to 20 seconds and route stops to six hours until live cadence is measured.
- Vehicle matching can use boarding-stop proximity when realtime payloads lack stop sequence.
- Session progress uses provider stop sequence only when present and route-valid. Otherwise it estimates a stop only within 120 m of a known route stop and labels that source as an estimate.
- Once selected, a vehicle is never silently replaced because another candidate becomes more convenient.
- Backward or duplicate progress is ignored. Temporary disappearance retains last progress only inside a bounded grace window, after which tracking becomes `lost`.

## Next TAGO live-position probe

Use official TAGO bus location endpoint `BusLcInfoInqireService/getRouteAcctoBusLcList` with `cityCode=39` and each official Route 365 `routeId`. Begin with `JEB405136521` and `JEB405136522`, then confirm the four partial variants. Capture only enough raw local output to determine the live response field names and whether vehicle number, coordinates, stop order/name/ID, and route metadata are present. Do not commit raw vehicle numbers.

After schema confirmation, build repeated bounded polling that measures snapshot-content change cadence rather than assuming polling time equals provider update time. TAGO's public location contract does not expose a B551982-style provider observation timestamp such as `gthrDt`.

## Threshold tuning gate

Do not change these defaults from intuition alone:

- `TRANSIT_VEHICLE_CACHE_TTL_MS` / 20-second vehicle cache
- 75-second missing-vehicle grace
- 120 m near-stop estimate radius
- 90-second matcher freshness limit

Use measured snapshot-change intervals, observed dropout distribution, duplicate rate, and coordinate/stop-order coverage. A safe cache TTL should avoid needless upstream calls while not concealing meaningful provider updates. Missing grace must be longer than ordinary observed gaps but shorter than a genuinely lost tracking window.

## Acceptance gate for real mode

Do not enable automatic matching for passengers until at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Any unknown route variant or unsupported field semantics must fail closed.

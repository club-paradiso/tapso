# Transit data validation

## Current evidence

| Question | Result |
|---|---|
| B551982 resource 15157601 contract exposes route, route-stop, and realtime position APIs | `VERIFIED_FROM_OFFICIAL_METADATA` |
| Newly issued key is accepted by B551982 | `VERIFIED_FROM_AUTHENTICATED_CALL` |
| B551982 `/mst_info` returns Jeju Route 365 for tested Jeju-oriented codes | `NO`; zero rows for `50110`, `5011000000`, `50`, `5000000000` |
| TAGO Jeju city code | `39`; `VERIFIED_FROM_AUTHENTICATED_OFFICIAL_RESPONSE` |
| TAGO Route 365 official route IDs | `VERIFIED`; six variants |
| TAGO realtime vehicle positions for Route 365 | `VERIFIED` |
| TAGO live vehicle schema | `VERIFIED`; `gpslati`, `gpslong`, `nodeid`, `nodenm`, `nodeord`, `routenm`, `routetp`, `vehicleno` |
| Vehicle ID continuity | `VERIFIED_IN_BOUNDED_PROBE`; all 10 full-length vehicles present in `24/24` samples |
| Active vehicle count stability | `VERIFIED_IN_BOUNDED_PROBE`; 5/5/5 per full-length direction |
| Live stop order available | `YES`; `nodeord` present on every inspected live record |
| Direction / variant behavior | `PARTIALLY_VERIFIED`; route ID distinguishes six endpoint variants |
| Provider observation timestamp | `NO`; TAGO location payload exposes no B551982-style timestamp |
| Event code | `NO_FIELD_OBSERVED` |
| Snapshot-content cadence | median `27.52 s`; min `10.01 s`; max observed `83.10 s` / `53.07 s` by direction |
| Temporary vehicle disappearance/reappearance | none observed in the two-minute bounded probe |
| Enough evidence for automatic passenger matching | `NO`; real boarding acceptance gate remains |

## Verified TAGO Route 365 variants

Official TAGO route lookup (`cityCode=39`, `routeNo=365`) returned:

- `JEB405136521`: 제주대학교 → 제주한라대학교(종점)
- `JEB405136522`: 제주한라대학교 → 제주대학교
- `JEB405136523`: 영주고등학교 → 제주한라대학교(종점)
- `JEB405136524`: 제주한라대학교 → 영주고등학교
- `JEB405136525`: 월성마을/선사유적지 → 제주대학교
- `JEB405136530`: 제주대학교병원 → 제주한라대학교(종점)

Do not collapse these IDs into one `365` identifier. Preserve route ID plus endpoint/stop topology. All six TAGO route rows reported `routetp=급행버스`; that field is not authoritative product classification for the Jeju pilot.

## Live cadence evidence

The two continuously active full-length directions were sampled 24 times each at a five-second target interval:

- `JEB405136521`: five vehicles stable across all 24 samples; snapshot-change interval median `27.52 s`, max `83.10 s`.
- `JEB405136522`: five vehicles stable across all 24 samples; snapshot-change interval median `27.52 s`, max `53.07 s`.
- Most five-second transitions were unchanged (`94/115` and `90/115`).
- No vehicle disappearance occurred during the probe, so no dropout distribution can yet be estimated.

## Phase 1 conservative behavior after live evidence

- Route-scoped caching still shares successful snapshots and never caches provider failures.
- Keep the default vehicle cache at **20 seconds**. It is shorter than the measured 27.52-second median content-change interval and avoids wasteful five-second upstream polling.
- Keep route stops cached for six hours pending change-frequency evidence.
- Keep the 75-second missing-vehicle grace unchanged because the bounded probe observed no disappearance event.
- Keep the 120 m near-stop fallback unchanged; TAGO `nodeord` should be preferred whenever it maps to a verified route stop.
- Keep the 90-second matcher freshness limit unchanged pending actual boarding tests. TAGO `observedAt` represents TAPSO snapshot acquisition time, not a provider-generated timestamp.
- Once selected, a vehicle is never silently replaced by another candidate.
- Backward progress remains fail-closed.

## Provider architecture

Jeju's verified live path is TAGO, not the unconfirmed B551982 mapping. The runtime therefore supports two adapters behind `TransitProvider`:

- `TRANSIT_PROVIDER=b551982` — existing nationwide ultra-precision candidate and default for compatibility.
- `TRANSIT_PROVIDER=tago` — verified Jeju pilot path.

For TAGO, `RouteRequest.standardRegionCode` currently carries the official TAGO `cityCode` to avoid a breaking domain rename during this pilot. API query parsing also accepts `cityCode` and `regionCode` aliases.

TAGO live responses do not expose a provider timestamp. `TagoTransitProvider` therefore stamps the acquisition time and sets `receiveType=TAGO_SNAPSHOT`; cadence analysis must continue to use snapshot-content changes rather than interpreting acquisition time as upstream update time.

## Next validation gate

Before a real ride:

1. Verify complete route-stop topology from `getRouteAcctoThrghSttnList` for `JEB405136521` and `JEB405136522`.
2. Confirm every live `nodeord` maps to a valid route stop sequence.
3. Run the API with `TRANSIT_PROVIDER=tago` and `cityCode=39`.
4. Perform a controlled Route 365 ride and verify selected-vehicle correctness, monotonic stop progression, arrival detection, and missing/stale behavior.

## Acceptance gate for broad real mode

Do not enable automatic matching for passengers until at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Unknown route variants or unsupported semantics must fail closed.

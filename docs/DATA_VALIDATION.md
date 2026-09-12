# TAGO transit data validation

## Current status

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
| Full-length stop topology | `VERIFIED`; 521=`43` contiguous stops, 522=`41` contiguous stops, 100% coordinate coverage |
| TAPSO HTTP route-stop path | `VERIFIED_END_TO_END`; live TAGO 521 returned through `/v1/stops` with all 43 stops |
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
- City and route-number discovery reads now use the same read-through cache with a six-hour window; they previously reached TAGO on every request.
- Successful responses also carry a CDN `s-maxage` equal to the in-process TTL, because each serverless instance holds its own memory. No `stale-while-revalidate` window is granted, so a stale snapshot is never served deliberately.
- Keep the 75-second missing-vehicle grace unchanged because the bounded probe observed no disappearance event.
- Keep the 120 m near-stop fallback unchanged; TAGO `nodeord` should be preferred whenever it maps to a verified route stop.
- TAGO observations set `timestampSource=unavailable`, keep receipt time in `receivedAt`, and use the epoch sentinel in `observedAt`. Matching and journey progress therefore fail closed instead of treating network receipt time as provider freshness.
- Once selected, a vehicle is never silently replaced by another candidate.
- Backward progress remains fail-closed.

## Provider architecture

Jeju's verified live path is TAGO. The service constructs `TagoTransitProvider` directly and exposes `transitProvider=tago` in health output. B551982 is retained only as validation history in documentation.

One handler in `services/api/src/apiRouter.ts` serves both the local Node server and the production Vercel Functions, so the freshness rules below hold identically in development and in production. `/v1/vehicles` states them in its response `meta`: `providerObservationTimestamp: "unavailable"`, `freshnessPolicy: "fail_closed"`, `automaticMatching: "withheld_pending_source_freshness_rule"`. See `PRODUCTION_TRANSIT_API.md`.

`RouteRequest.cityCode` carries the official TAGO identifier. API query parsing accepts only `cityCode`, so former B551982 `stdgCd` values cannot be reused accidentally.

TAGO live responses do not expose a provider timestamp. `TagoTransitProvider` stores TAPSO acquisition time in `receivedAt`, marks `timestampSource=unavailable`, and sets `receiveType=TAGO_SNAPSHOT`; cadence analysis must continue to use snapshot-content changes.

## Next validation gate

The API-data and HTTP integration gates are complete for the full-length Route 365 directions. The next validation gate is a controlled real ride:

1. Run the API locally with the private service key and resolve `cityCode` through `/v1/cities`. A deployed API is not required; the capture tool drives `TagoTransitProvider` directly.
2. Choose explicit boarding and destination stop sequences from the verified direction-specific topology.
3. During the ride, run `scripts/ride-capture/capture.ts` (see `exec-plans/RIDE_CAPTURE.md`). It prints the stop list for the chosen segment before its first poll, stores bounded TAGO snapshots only under ignored `work/rides/`, records the boarded vehicle from the `b` command after cross-checking what was typed against the vehicles the route is currently reporting, and accepts `p <stop-seq>` markers for physically passed stops. Aim for eight to ten `p` markers placed only where the bus certainly stopped.
4. Run `scripts/ride-capture/analyze.ts` on the capture. The sanitized report compares the tracked vehicle's `nodeord` progression, content-change cadence, coordinate movement, gaps, marker lag, and arrival against the rider markers, using per-run pseudonyms instead of vehicle numbers, and reports `INSUFFICIENT_EVIDENCE` rather than publishing a distribution it does not have the samples for.
5. Define and test a TAGO freshness rule from `freshnessEvidence` and `tracked.markerComparisons` before enabling journey-session matching or progress. That decision belongs to Task C: the ride produces observed distributions, not a threshold.

Status: `READY_FOR_RIDE` as of 2026-09-12. Steps 1 and 2 are reproducible today; steps 3 to 5 wait on one physical ride. No real ride has been captured, so nothing in this document is real-ride evidence.

## Acceptance gate for broad real mode

Do not enable automatic matching for passengers until a source-freshness rule exists and at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Unknown route variants or unsupported semantics must fail closed.

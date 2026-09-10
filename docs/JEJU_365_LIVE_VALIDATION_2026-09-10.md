# Jeju Route 365 live-transit validation — 2026-09-10

Status: `TAGO_LIVE_SCHEMA_AND_CADENCE_VERIFIED`

This report intentionally contains no service key, request URL containing a key, or raw vehicle identifiers from a live capture.

## B551982 finding

The newly issued service key was accepted by resource `15157601`, but authenticated `/mst_info` calls returned zero route-master rows for the tested Jeju-oriented `stdgCd` values `50110`, `5011000000`, `50`, and `5000000000`. TAPSO therefore has no confirmed B551982 mapping for Jeju Route 365 and should not keep guessing region codes.

## Official TAGO route discovery

Authenticated TAGO route lookup returned `resultCode=00 / NORMAL SERVICE.` for `cityCode=39`, `routeNo=365` and verified six route IDs:

- `JEB405136521`: 제주대학교 → 제주한라대학교(종점)
- `JEB405136522`: 제주한라대학교 → 제주대학교
- `JEB405136523`: 영주고등학교 → 제주한라대학교(종점)
- `JEB405136524`: 제주한라대학교 → 영주고등학교
- `JEB405136525`: 월성마을/선사유적지 → 제주대학교
- `JEB405136530`: 제주대학교병원 → 제주한라대학교(종점)

Displayed route number `365` is therefore a route family, not one unique provider ID. The two continuously active full-length directions observed in this probe were `JEB405136521` and `JEB405136522`. The other IDs are endpoint-specific variants and must remain distinct.

All six route records reported `routetp=급행버스`. That field is not accepted as authoritative product classification for Jeju; route identity must use the official route ID plus endpoint/stop topology.

## Verified TAGO live schema

Official `BusLcInfoInqireService/getRouteAcctoBusLcList` calls succeeded for all six Route 365 IDs with `cityCode=39`.

Observed live fields were exactly:

- `gpslati`
- `gpslong`
- `nodeid`
- `nodenm`
- `nodeord`
- `routenm`
- `routetp`
- `vehicleno`

The live payload does **not** expose a B551982-style provider observation timestamp such as `gthrDt`, and no event-code field was observed.

Snapshot at schema-probe time:

| Route ID | Direction / variant | Active vehicles |
|---|---|---:|
| `JEB405136521` | 제주대 → 한라대 | 5 |
| `JEB405136522` | 한라대 → 제주대 | 5 |
| `JEB405136523` | 영주고 → 한라대 | 1 |
| `JEB405136524` | 한라대 → 영주고 | 0 |
| `JEB405136525` | 월성마을 → 제주대 | 0 |
| `JEB405136530` | 제주대병원 → 한라대 | 0 |

`nodeord` is present in the live location payload and is usable as provider stop-order evidence. Full route topology still needs the TAGO route-stop endpoint during the actual ride-path validation.

## Bounded cadence and continuity probe

A two-minute bounded probe sampled the two active full-length directions 24 times each at a target five-second interval. This consumed 48 location calls, far below the TAGO development quota. Raw vehicle numbers were never printed or stored; per-run pseudonyms were used only for continuity analysis.

### `JEB405136521` — 제주대 → 한라대

- active vehicles: min `5`, median `5`, max `5`
- unique vehicles observed: `5`
- all five vehicles appeared in `24/24` samples (`100%` sample coverage)
- observed snapshot-change interval: min `10.01 s`, median `27.52 s`, max `83.10 s`
- coordinate-change transitions: `21`
- stop-order/node transitions: `7`
- unchanged transitions: `94 / 115`
- temporary disappearance/reappearance: none observed during this two-minute window

### `JEB405136522` — 한라대 → 제주대

- active vehicles: min `5`, median `5`, max `5`
- unique vehicles observed: `5`
- all five vehicles appeared in `24/24` samples (`100%` sample coverage)
- observed snapshot-change interval: min `10.01 s`, median `27.52 s`, max `53.07 s`
- coordinate-change transitions: `25`
- stop-order/node transitions: `5`
- unchanged transitions: `90 / 115`
- temporary disappearance/reappearance: none observed during this two-minute window

## Conclusions

- The public-data service key works for the official TAGO services used in the Jeju pilot.
- TAGO Jeju `cityCode=39` is verified from an authenticated official response.
- Route 365 has six official provider route IDs; it must not be modeled as one scalar route ID.
- `vehicleno` was perfectly continuous across the 24-sample bounded probe for all ten full-length-direction vehicles.
- Active vehicle count was completely stable at five per full-length direction during the probe.
- Coordinates and `nodeord` both changed over time and are usable for tracking progress.
- `nodeord` is available in the live vehicle payload.
- No event code was present in the observed TAGO schema.
- No provider observation timestamp is available; TAPSO must distinguish snapshot acquisition time from actual snapshot-content change time.
- Five-second upstream polling is wasteful for steady-state product use: most transitions were unchanged and the measured median content-change interval was `27.52 s`.
- The existing 20-second vehicle-cache default is retained. It is shorter than the measured median update interval while suppressing redundant upstream calls.
- The 75-second missing-vehicle grace is **not** changed from this probe because no disappearance event occurred. A maximum content-change interval is not the same thing as a dropout duration.
- The 90-second matcher freshness and 120 m near-stop estimate radius are also unchanged pending real boarding observations.

## Repository implementation

This branch now adds a `TagoTransitProvider` behind the existing `TransitProvider` boundary. It maps:

- route stops from `getRouteAcctoThrghSttnList`
- live vehicles from `getRouteAcctoBusLcList`
- TAGO `cityCode` through the existing `RouteRequest.standardRegionCode` field for compatibility
- `nodeord` to `VehicleObservation.stopSequence`
- `gpslati/gpslong` to coordinates
- `vehicleno` to the internal vehicle identity
- snapshot acquisition time to `observedAt`, with `receiveType=TAGO_SNAPSHOT` to avoid pretending it is a provider-generated timestamp

The server keeps B551982 as the default provider and enables the verified Jeju path explicitly with `TRANSIT_PROVIDER=tago`.

## Exact next step toward a real TAPSO ride test

1. Run the TAGO route-stop endpoint for `JEB405136521` and `JEB405136522` and verify complete `nodeord` topology against the live vehicle `nodeord` values.
2. Start the API locally with `TRANSIT_PROVIDER=tago` and the service key loaded from Keychain.
3. Perform a controlled ride on one full-length Route 365 direction with an explicitly chosen boarding and destination stop.
4. Record only sanitized aggregate outcomes: selected vehicle correctness, stop-progress monotonicity, stale/missing behavior, arrival detection, and whether any variant transition occurs.
5. Do not enable automatic passenger matching broadly until the existing acceptance gate of at least 30 observed boardings across multiple routes is met.

# Data sources

## B551982 nationwide ultra-precision bus API

Public Data Portal resource `15157601` remains a supported candidate source. Its contract exposes:

- host `https://apis.data.go.kr/B551982/rte`
- `GET /mst_info` — route master
- `GET /ps_info` — route stops
- `GET /rtm_loc_info` — realtime vehicle locations

The authenticated Jeju validation on 2026-09-10 accepted the newly issued key but returned zero `/mst_info` rows for tested Jeju-oriented `stdgCd` values `50110`, `5011000000`, `50`, and `5000000000`. Do not keep guessing B551982 Jeju mappings in product code.

B551982 remains the runtime default for compatibility until broader provider coverage is decided, but it is **not** the verified Jeju Route 365 source.

## TAGO bus route and location APIs

The verified Jeju pilot source is the Ministry of Land, Infrastructure and Transport TAGO family:

- Route service: `https://apis.data.go.kr/1613000/BusRouteInfoInqireService`
  - `getRouteNoList` resolves route-number families to official route IDs.
  - `getRouteAcctoThrghSttnList` provides ordered route stops.
- Location service: `https://apis.data.go.kr/1613000/BusLcInfoInqireService`
  - `getRouteAcctoBusLcList` provides route-scoped live vehicle snapshots.

Authenticated official responses verified:

- Jeju `cityCode=39`.
- Route number `365` maps to six distinct official route IDs.
- Live location fields for Jeju Route 365 are `gpslati`, `gpslong`, `nodeid`, `nodenm`, `nodeord`, `routenm`, `routetp`, and `vehicleno`.
- The live location payload does not expose a provider observation timestamp or event-code field.
- `nodeord` is present and usable as stop-order evidence.
- All ten vehicles on the two full-length directions retained the same vehicle identity across a 24-sample bounded probe.

TAGO route records reported `routetp=급행버스` for all six 365 variants. Do not use that field alone as authoritative Jeju product classification; preserve route ID and endpoint/stop topology.

## Jeju BIS

[Jeju Bus Information System](https://bus.jeju.go.kr/) remains the official passenger-facing corroboration source for route existence, schedule, endpoint, and local classification. No undocumented Jeju BIS endpoint is treated as a supported TAPSO product API.

## Runtime selection

Government-specific DTOs stop inside provider adapters:

- `services/api/src/publicDataProvider.ts` — B551982
- `services/api/src/tagoProvider.ts` — TAGO

Select with:

- `TRANSIT_PROVIDER=b551982` — compatibility default
- `TRANSIT_PROVIDER=tago` — verified Jeju pilot

For the TAGO pilot, `RouteRequest.standardRegionCode` carries TAGO `cityCode` until a broader domain rename is justified.

## Evidence and retention rules

- Fixture files are synthetic and say so in-band.
- Never commit service keys.
- Raw vehicle identifiers from live probes remain local; commit only sanitized aggregates or deliberately minimized representative fixtures.
- Capture request parameters, collection time, provider identity, and schema assumptions for live validation.
- TAGO snapshot acquisition time is not the same as provider update time. Measure cadence from content changes.

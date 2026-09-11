# Data sources

## B551982 validation history

Public Data Portal resource `15157601` remains a supported candidate source. Its contract exposes:

- host `https://apis.data.go.kr/B551982/rte`
- `GET /mst_info` — route master
- `GET /ps_info` — route stops
- `GET /rtm_loc_info` — realtime vehicle locations

The authenticated Jeju validation on 2026-09-10 accepted the newly issued key but returned zero `/mst_info` rows for tested Jeju-oriented `stdgCd` values `50110`, `5011000000`, `50`, and `5000000000`. Do not keep guessing B551982 Jeju mappings in product code.

Because the authenticated route master returned no Jeju data, B551982 is no longer a TAPSO runtime provider. The old adapter and its environment overrides were removed so a missing selector cannot silently send Jeju requests to the wrong API.

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

Requests use `serviceKey`, `_type=json`, and where applicable `cityCode`, `routeId`, `pageNo`, `numOfRows`. The city code is a TAGO identifier, not the former B551982 `stdgCd`. Do not infer one from the other. Resolve IDs from official live responses; no production city/route ID is hardcoded.

[Jeju Bus Information System](https://bus.jeju.go.kr/) remains the official passenger-facing corroboration source for route existence, schedule, endpoint, and local classification. No undocumented Jeju BIS endpoint is treated as a supported TAPSO product API.

## Runtime provider

Government-specific DTOs stop inside the TAGO provider adapter:

- `services/api/src/tagoProvider.ts` — TAGO

The API always uses TAGO. `RouteRequest.cityCode` carries the official TAGO city identifier; request parsing deliberately rejects the old `stdgCd` and `regionCode` aliases.

## Evidence and retention rules

- Fixture files are synthetic and say so in-band.
- Never commit service keys.
- Raw vehicle identifiers from live probes remain local; commit only sanitized aggregates or deliberately minimized representative fixtures.
- Capture request parameters, collection time, provider identity, and schema assumptions for live validation.
- TAGO snapshot acquisition time is not the same as provider update time. Measure cadence from content changes.

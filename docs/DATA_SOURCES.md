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

## Passive collection paths

The rider-free passive collector (`scripts/passive-shadow/collect.ts`) reads through one of two paths and records which one as `providerPath` on the manifest and on every stream:

- `tago-direct`: TAGO through the one `TagoTransitProvider`, with `TAGO_SERVICE_KEY` from the environment.
- `tapso-public-api`: `TapsoPublicApiProvider` (`services/api/src/tapsoPublicApiProvider.ts`), a read-only adapter for TAPSO's own public `/v1/stops`, `/v1/vehicles` and `/v1/routes`. It is not a TAGO client and needs no credential; the deployment it reads reaches TAGO through `TagoTransitProvider`. `/v1/vehicles` is served through a 20 s shared cache, so receipts on this path do not have session cadence. A stream counts as live only when read from the production origin; any other base is recorded as `synthetic`.

The Passive Shadow v3 evidence of record (collection run `36098610702`) came through `tapso-public-api`.

## Evidence and retention rules

- Fixture files are synthetic and say so in-band.
- Never commit service keys.
- Raw vehicle identifiers stay out of Git; commit only sanitized, pseudonymised aggregates or deliberately minimized representative fixtures. Corrected 2026-09-29: raw evidence does not only stay local. Where the code and workflows keep it:
  - Command-line collectors and ride-capture tools write under ignored `work/` by default.
  - GitHub-hosted passive collection keeps raw streams only in the draft release `passive-evidence-vault`; draft assets are restricted to push-capable identities and an asset already stored is never replaced. TAPSO is public, so raw vehicle streams are never retained as Actions artifacts. On 2026-09-30 the evidence-of-record collection `pv3-20260925T052712Z-f096de91` was checksum-verified into the vault and the two plaintext raw Actions artifacts (`passive-shadow-v3-raw` and `matcher-evidence-raw-replayed`) were deleted after vault coverage was verified.
  - Field-validation and beta ride captures submitted through the Railway collector are stored raw (gzip + base64, chunked) with their sanitized report in Upstash Redis under `tapso:field-validation:v1:` (`services/api/src/fieldValidation.ts`). A beta ride in progress is journaled in the same database under `tapso:beta-tester:v1:` (`services/api/src/captureJournal.ts`).
- Capture request parameters, collection time, provider identity, and schema assumptions for live validation.
- TAGO snapshot acquisition time is not the same as provider update time. Measure cadence from content changes.

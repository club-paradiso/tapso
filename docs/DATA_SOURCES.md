# Data sources

## Active provider: official TAGO

The runtime uses [bus route information, resource 15098529](https://www.data.go.kr/data/15098529/openapi.do) and [bus location information, resource 15098533](https://www.data.go.kr/data/15098533/openapi.do). Official portal schemas were inspected on 2026-09-10. Both development applications were approved that day (expiry 2028-09-10); portal displays 10,000 calls per operation/day.

All calls use HTTPS at `https://apis.data.go.kr/1613000/`:

| Service | Operation | Purpose |
|---|---|---|
| BusRouteInfoInqireService | getCtyCodeList | Discover official citycode/cityname |
| BusRouteInfoInqireService | getRouteNoList | Search routeNo within cityCode; returns routeid/routeno |
| BusRouteInfoInqireService | getRouteAcctoThrghSttnList | Route stops with nodeid, nodenm, nodeord, gpslati, gpslong, updowncd |
| BusLcInfoInqireService | getRouteAcctoBusLcList | Vehicles with vehicleno, gpslati, gpslong, nodeord, nodeid, nodenm |

Requests use `serviceKey`, `_type=json`, and where applicable `cityCode`, `routeId`, `pageNo`, `numOfRows`. The city code is a TAGO identifier, not the former B551982 `stdgCd`. Do not infer one from the other. Resolve IDs from official live responses; no production city/route ID is hardcoded.

Keep the portal **Decoding** key in the ignored `.env.local` file, permissions `0600`, as `PUBLIC_DATA_SERVICE_KEY`. Python `urllib.parse.urlencode()` and TypeScript `URLSearchParams` encode this original value exactly once. Never use a `VITE_` variable, put credentials on command lines, or commit key files. The adapter rejects Encoding keys and sends credentials only to fixed official HTTPS endpoints, with redirects disabled. It replaces upstream exceptions with safe errors so URLs and response bodies cannot leak the key.

TAGO's documented vehicle schema does **not** contain a source measurement timestamp, direction code, speed, heading, or arrival/departure event. `receivedAt` records server receipt separately. `timestampSource=unavailable` and an epoch `observedAt` preserve the existing matcher/session fail-closed freshness behavior: returned locations can be inspected, but are not asserted to be fresh enough for automatic matching or journey progress. Do not claim end-to-end live passenger tracking from a successful location query alone.

## Previous provider (historical)

B551982 was previously integrated at resource 15157601. The user has already measured that its route master contains no Jeju data. It is no longer used at runtime; old investigation plans are historical evidence. No B551982 fallback or implicit region-code conversion is implemented.

## Jeju BIS and evidence rules

[Jeju Bus Information System](https://bus.jeju.go.kr/) is useful corroboration of public passenger information; undocumented website endpoints are not product APIs. Keep government DTO conversion within the provider. Synthetic tests explicitly label identifiers synthetic. Store credential-free live evidence privately under ignored `work/`; publish only necessary summaries with capture time and provenance, not raw vehicle inventories.

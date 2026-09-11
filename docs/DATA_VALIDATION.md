# TAGO transit data validation

## Current status

Both TAGO development applications were approved on 2026-09-10. On 2026-09-11 at 02:19 KST, the registered Decoding key passed HTTP 200/resultCode 00/NORMAL SERVICE. Official responses confirmed city 39, all six Route 365 variants and their stops; all location queries succeeded with zero vehicles. See [credentialed capture](validation/TAGO_2026-09-11.md). Actual vehicle fields and source freshness were not verified by this overnight capture.

## Local setup and discovery

Keep the new **Decoding** key as `PUBLIC_DATA_SERVICE_KEY` in the project `.env.local` (Git-ignored, mode `0600`). Do not put it in shell history or GitHub. Revoke/rotate the previously exposed key through the portal and update any other applications that shared it.

```bash
python3 scripts/tago/probe.py > work/tago-probe.json
```

The Python probe reads `.env.local` before an inherited shell key and uses `urllib.parse.urlencode()`. It calls the official city-code endpoint, requires HTTP 200/resultCode 00, discovers 제주/서귀포 by the returned names, searches routeNo 365, and uses only returned IDs to query stops and vehicles. All route variants returned by the official search remain visible. Output contains no key or request URL. Failures print only controlled messages.

Start the local API from the repository root with the local key file loaded:

```bash
env -u PUBLIC_DATA_SERVICE_KEY node --env-file=.env.local --experimental-strip-types services/api/src/server.ts
```

Discovery endpoints are `/v1/cities` and `/v1/routes?cityCode=<official-city-code>&routeNo=365`. `/v1/stops` and `/v1/vehicles` take `cityCode` and `routeId`. Session creation takes `cityCode` in its JSON body. The old `stdgCd`/`standardRegionCode` contract is removed intentionally; B551982 IDs cannot be silently reused.

For bounded repeated sampling, use verified IDs from discovery:

```bash
TRANSIT_SPIKE_SAMPLES=12 TRANSIT_SPIKE_INTERVAL_MS=5000 \
env -u PUBLIC_DATA_SERVICE_KEY node --env-file=.env.local --experimental-strip-types scripts/transit-spike/run.ts \
  '<official-route-id>' '<official-city-code>' > work/route365-spike.json
```

## Freshness and passenger acceptance gate

TAGO locations provide `nodeord`, but no documented source measurement timestamp. Receipt time is not provider freshness. The adapter records `receivedAt` independently and sets `timestampSource=unavailable`; the existing matcher and session engine reject the unknown-age observation. Provider update cadence cannot be calculated from receipt timestamps. Inspect coordinate/sequence changes and validate against the official passenger interface and actual rides before defining a separate policy.

Keep the existing conservative cache and matching thresholds until measured evidence supports changes. Do not enable automatic passenger matching until at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Route variants, timestamp absence, and real vehicle coverage remain explicit verification gates even if authentication succeeds.

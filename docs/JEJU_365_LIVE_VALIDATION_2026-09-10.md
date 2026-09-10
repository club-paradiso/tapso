# Jeju Route 365 live-transit validation — 2026-09-10

Status: `BLOCKED_AT_AUTHENTICATED_LIVE_CALL`

This report intentionally contains no service key, request URL containing a key, or raw vehicle identifiers from a live capture.

## Verified preflight

- Public Data Portal resource: `15157601`, nationwide ultra-precision bus realtime information.
- Official product base URL already used by TAPSO: `https://apis.data.go.kr/B551982/rte`.
- Contract paths previously inspected from the portal Swagger: `/mst_info`, `/ps_info`, `/rtm_loc_info`.
- The portal currently describes route master, route-stop, and realtime vehicle-position data in JSON/XML.
- Development traffic allowance: 5,000 calls/day.
- Jeju passenger information currently lists Route 365 between Jeju Halla University and Jeju National University via the airport/city-hall corridor.
- A third-party TAGO-derived index currently labels Jeju Route 365 with ID `6522`, but this is **not accepted as TAPSO's official route ID** until the official `/mst_info` response returns the same value.

## Credential boundary

The operator reports that a newly issued public-data key is configured locally. The execution environment used to prepare this repository change does not receive that local shell environment, and a presence-only check found no `PUBLIC_DATA_SERVICE_KEY` here. The key value was not requested, printed, logged, committed, or uploaded.

Because an authenticated call cannot be made from this environment, the following must remain unverified in this report:

| Question | Result |
|---|---|
| Newly issued key accepted by resource 15157601 | `UNVERIFIED_IN_THIS_EXECUTION_ENVIRONMENT` |
| Official `/mst_info` route ID for 365 | `UNVERIFIED` |
| `stdgCd=50110` accepted by live provider | `UNVERIFIED` |
| Route 365 stop list returned | `UNVERIFIED` |
| Realtime vehicles returned | `UNVERIFIED` |
| Provider refresh cadence | `UNVERIFIED` |
| Vehicle identifier continuity | `UNVERIFIED` |
| Active vehicle count stability | `UNVERIFIED` |
| Coordinate continuity | `UNVERIFIED` |
| Direction / route-variant semantics | `UNVERIFIED` |
| Realtime stop-sequence availability | `UNVERIFIED` |
| Event-code behavior | `UNVERIFIED` |
| Temporary disappearance / reappearance | `UNVERIFIED` |

No measured cadence, route ID, or schema conclusion is fabricated from public passenger pages or third-party indexes.

## Repository changes made to unblock the authenticated run

1. `PublicDataUltraPrecisionProvider.routeMasters(stdgCd)` now queries official `/mst_info` without guessing an `rteId`.
2. `scripts/transit-spike/resolve-route.ts` resolves a displayed route number through the official route-master response.
3. Route-number resolution requires an exact match and exits on zero or multiple matches, so a direction/variant ambiguity cannot silently select the wrong route.
4. Deterministic provider tests cover the route-master request shape and normalized route-master fields.
5. `docs/DATA_VALIDATION.md` now uses official route resolution before the existing repeated Route 365 spike.

## Exact authenticated next action

Run from a shell where `PUBLIC_DATA_SERVICE_KEY` is already set:

```bash
ROUTE_ID="$(node --experimental-strip-types scripts/transit-spike/resolve-route.ts 365 50110)"

TRANSIT_SPIKE_SAMPLES=12 \
TRANSIT_SPIKE_INTERVAL_MS=5000 \
node --experimental-strip-types scripts/transit-spike/run.ts "$ROUTE_ID" 50110 \
  > route365-spike.json
```

If the one-minute probe succeeds, inspect the generated `report` before extending sampling. Do not change cache TTL, matching freshness, missing-vehicle grace, or near-stop radius until measured median/p95 provider cadence and dropout behavior are available.

After the short probe, update this report with only sanitized aggregate findings. Keep raw captures private unless there is a specific reason and permission to retain representative records.

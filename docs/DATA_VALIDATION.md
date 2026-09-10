# Transit data validation

## Current evidence

| Question | Result |
|---|---|
| Official resource 15157601 provides route, route-stop, and realtime position data | `VERIFIED_FROM_OFFICIAL_METADATA` |
| Official base URL and route/stop/realtime paths | `VERIFIED_FROM_SWAGGER` |
| Development traffic allowance is 5,000 calls/day | `VERIFIED_FROM_OFFICIAL_METADATA` |
| API rejects a missing service key | `VERIFIED` |
| Route 365 is currently listed in the Jeju passenger bus system | `VERIFIED_FROM_PUBLIC_PASSENGER_INTERFACE` |
| Official internal route ID for Route 365 | `UNVERIFIED`; resolve from `/mst_info`, do not substitute third-party IDs |
| Jeju standard region code accepted in live calls | `UNVERIFIED` |
| Jeju routes and stops returned | `BLOCKED_BY_CREDENTIALS` |
| Vehicle ID stable across observations | `UNVERIFIED` |
| Stop ordering and opposite direction distinguishable | `UNVERIFIED` |
| Realtime payload includes a usable stop sequence | `UNVERIFIED`; public metadata does not promise one |
| Branch/variant semantics | `UNVERIFIED` |
| Real polling cadence and dropout distribution | `UNVERIFIED` |
| Enough evidence for automatic vehicle matching | `UNVERIFIED` |

## Phase 1 conservative behavior

- Route-scoped caching shares successful snapshots across sessions and never caches provider failures.
- Vehicle cache defaults to 20 seconds and route stops to six hours until live cadence is measured.
- Vehicle matching can use boarding-stop proximity when realtime payloads lack stop sequence.
- Session progress uses provider stop sequence only when present and route-valid. Otherwise it estimates a stop only within 120 m of a known route stop and labels that source as an estimate.
- Once selected, a vehicle is never silently replaced because another candidate becomes more convenient.
- Backward or duplicate progress is ignored. Temporary disappearance retains last progress only inside a bounded grace window, after which tracking becomes `lost`.

## Route 365 credentialed spike

The repository contains a repeated-sampling validator rather than a one-shot payload dump. It records collection time independently from provider observation time and summarizes provider cadence, duplicate observations, out-of-order timestamps, optional-field coverage, and per-vehicle continuity.

1. Obtain an approved key for resource 15157601 and keep it only in the shell/server environment as `PUBLIC_DATA_SERVICE_KEY`.
2. Resolve Route 365's official API `rteId` from the official `/mst_info` response. The resolver requires an exact route-number match and fails closed if the official endpoint returns zero or multiple matches:

```bash
ROUTE_ID="$(node --experimental-strip-types scripts/transit-spike/resolve-route.ts 365 50110)"
printf 'resolved route id: %s\n' "$ROUTE_ID"
```

Do not copy `JEB...`, `6522`, or another third-party identifier into production code unless `/mst_info` itself returns that value.

3. Start with a bounded one-minute probe using the resolved official identifier:

```bash
TRANSIT_SPIKE_SAMPLES=12 \
TRANSIT_SPIKE_INTERVAL_MS=5000 \
node --experimental-strip-types scripts/transit-spike/run.ts "$ROUTE_ID" 50110 \
  > route365-spike.json
```

4. Inspect `report.providerUpdateIntervalSeconds`, `duplicateObservationCount`, `outOfOrderObservationCount`, `stopSequenceCoverage`, `directionCoverage`, `eventCodeCoverage`, and `vehicleContinuity` before changing any runtime thresholds.
5. If the short probe is healthy, extend the same command to cover a complete ride while respecting the 5,000-call development quota. A 5-second interval consumes 720 realtime calls/hour plus the initial route-stop request and route-master lookup.
6. Record raw collection time separately from provider `gthrDt`; preserve raw output privately and commit only redacted, legally permitted representative fixtures.
7. Corroborate route order and direction against the official Jeju passenger interface and an actual ride.
8. Repeat on at least two additional route shapes before treating Route 365 behavior as general Jeju semantics.

## Threshold tuning gate

Do not change these defaults from intuition alone:

- `TRANSIT_VEHICLE_CACHE_TTL_MS` / 20-second vehicle cache
- 75-second missing-vehicle grace
- 120 m near-stop estimate radius
- 90-second matcher freshness limit

Use the measured median and p95 provider update intervals, observed dropout distribution, duplicate rate, and coordinate/stop-sequence coverage. A safe cache TTL should avoid needless upstream calls while not concealing meaningful provider updates. Missing grace must be longer than ordinary observed gaps but shorter than a genuinely lost tracking window.

## Acceptance gate for real mode

Do not enable automatic matching for passengers until at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Any unknown event code or route variant must fail closed.

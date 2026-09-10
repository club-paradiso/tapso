# Transit data validation

## Current evidence

| Question | Result |
|---|---|
| Official resource 15157601 provides route, route-stop, and realtime position data | `VERIFIED_FROM_OFFICIAL_METADATA` |
| Official base URL and route/stop/realtime paths | `VERIFIED_FROM_SWAGGER` |
| Development traffic allowance is 5,000 calls/day | `VERIFIED_FROM_OFFICIAL_METADATA` |
| API rejects a missing service key | `VERIFIED` |
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

## Credentialed spike procedure

1. Obtain an approved key for resource 15157601 and keep it only in the environment.
2. Choose at least three Jeju routes: simple bidirectional, high-frequency, and a branch/variant if one exists. Route 365 is the first narrow pilot candidate.
3. Run `scripts/transit-spike/run.ts` at a deliberately bounded cadence for at least a complete trip while respecting the 5,000-call development quota.
4. Record raw collection time separately from provider `gthrDt`.
5. Measure identifier continuity, position monotonicity, stop sequence presence, direction, heading, event codes, receive type, timestamp skew, cadence, duplicates, and missing intervals.
6. Corroborate route order against the official Jeju passenger interface and an actual ride.
7. Redact and add only representative, legally permitted fixtures; label provenance accurately.

## Acceptance gate for real mode

Do not enable automatic matching for passengers until at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Any unknown event code or route variant must fail closed.

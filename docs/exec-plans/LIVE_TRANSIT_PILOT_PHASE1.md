# Live Transit Pilot Phase 1

## User-visible outcome

TAPSO gains a server-side live-transit pilot boundary that can share upstream route polling across riders, create short-lived ride sessions, withhold ambiguous vehicle matches, accept explicit vehicle confirmation, and advance conservative stop progress without silently switching buses.

Non-goals: claiming a real passenger boarding was observed, choosing durable hosting, APNs delivery, or changing the iOS UI.

## Verified constraints and reality labels

- `VERIFIED_FROM_AUTHENTICATED_CALL`: the approved TAGO Decoding key returns HTTP 200, result code `00`, and `NORMAL SERVICE`.
- `VERIFIED_FROM_AUTHENTICATED_CALL`: TAGO resolves 제주도 to `cityCode=39` and Route 365 to six official route variants.
- `VERIFIED_FROM_AUTHENTICATED_CALL`: daytime live rows include vehicle number, coordinates, `nodeord`, `nodenm`, and `nodeid`.
- `VERIFIED_IN_BOUNDED_PROBE`: both full-length directions retained vehicle identity across 24 samples and had a median content-change interval of 27.52 seconds.
- `VERIFIED_ABSENT`: TAGO location rows expose no provider observation timestamp, so receipt time cannot establish source freshness.

## Milestones

1. `DONE_IN_CODE`: add a route-scoped cache that coalesces concurrent misses and caches only successful upstream calls.
2. `DONE_IN_CODE`: add an in-memory journey-session coordinator with automatic match, explicit confirmation, monotonic progress, bounded missing-data grace, and no silent rematch.
3. `DONE_IN_CODE`: expose cached stops/vehicles plus create/refresh/confirm session endpoints on the Node pilot server.
4. `DONE_IN_CODE`: add deterministic tests for cache coalescing, cache TTL, ambiguity, explicit confirmation, regression rejection, and disappearance.
5. `DONE`: validate the approved credential, discover official Jeju identifiers, measure a bounded Route 365 sample, and verify the local HTTP path.
6. `DONE`: replace the B551982 runtime with TAGO and fail closed when provider source freshness is unavailable.
7. `NEXT`: run a controlled physical boarding test before changing automatic passenger-matching policy.

## Decisions

- Polling is request-driven for the pilot. There is no background timer when no ride asks for a snapshot.
- Vehicle cache defaults to 20 seconds and can be overridden with `TRANSIT_VEHICLE_TTL_MS`.
- Route stops default to a six-hour cache because route topology is much less volatile than vehicle position.
- Failed provider calls are never cached.
- Once a vehicle is selected, disappearance or contradictory evidence degrades or loses the session; it never switches to another vehicle automatically.
- If realtime data lacks a stop sequence, a stop is estimated only when the vehicle is within 120 m of a known route stop. Estimated progress is explicitly labeled and must not be confused with validated provider semantics.
- Session state is in memory for this pilot. Durable storage and scheduled APNs workers remain deferred until live cadence and hosting needs are measured.

## Reproduction

```bash
npm test --prefix services/api
python3 -m unittest discover -s scripts/tago -p 'test_*.py'
env -u PUBLIC_DATA_SERVICE_KEY node --env-file=.env.local --experimental-strip-types services/api/src/server.ts
```

With the Node API running, pilot endpoints are:

```text
GET  /v1/cities
GET  /v1/routes?cityCode=…&routeNo=365
GET  /v1/stops?routeId=…&cityCode=…
GET  /v1/vehicles?routeId=…&cityCode=…
POST /v1/sessions
GET  /v1/sessions/:id
POST /v1/sessions/:id/confirm
```

## Risks and exact next action

The largest remaining product risk is the missing provider observation timestamp. Keep automatic matching withheld, then run a controlled Route 365 ride with an explicitly selected route variant and boarding/destination stops. Record whether the physical vehicle identity, `nodeord` progression, missing-data behavior, and arrival detection agree with the ride. Use that evidence to decide whether snapshot-content continuity can support a documented TAGO freshness policy.

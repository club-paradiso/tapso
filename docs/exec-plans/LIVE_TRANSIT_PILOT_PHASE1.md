# Live Transit Pilot Phase 1

## User-visible outcome

TAPSO gains a server-side live-transit pilot boundary that can share upstream route polling across riders, create short-lived ride sessions, withhold ambiguous vehicle matches, accept explicit vehicle confirmation, and advance conservative stop progress without silently switching buses.

Non-goals: enabling production credentials, claiming a real Jeju ride was observed, choosing durable hosting, APNs delivery, or changing the iOS UI.

## Verified constraints and reality labels

- `VERIFIED_FROM_OFFICIAL_METADATA`: public-data resource 15157601 provides route basics, route stops, and realtime bus positions nationwide and is available from March 2026.
- `VERIFIED_FROM_OFFICIAL_METADATA`: development traffic allowance is 5,000 calls/day; operating traffic can be increased after registering a use case.
- `VERIFIED_FROM_REPOSITORY_SWAGGER_AUDIT`: TAPSO's adapter paths are `/ps_info` and `/rtm_loc_info` under `https://apis.data.go.kr/B551982/rte`.
- `BLOCKED_BY_CREDENTIALS`: no approved service key is available in this execution environment, so Jeju response quality and cadence remain unverified.
- `UNVERIFIED`: realtime stop-sequence semantics. The public dataset description promises coordinates, heading, speed, event, and receive type but does not promise a stop sequence for each realtime item.

## Milestones

1. `DONE_IN_CODE`: add a route-scoped cache that coalesces concurrent misses and caches only successful upstream calls.
2. `DONE_IN_CODE`: add an in-memory journey-session coordinator with automatic match, explicit confirmation, monotonic progress, bounded missing-data grace, and no silent rematch.
3. `DONE_IN_CODE`: expose cached stops/vehicles plus create/refresh/confirm session endpoints on the Node pilot server.
4. `DONE_IN_CODE`: add deterministic tests for cache coalescing, cache TTL, ambiguity, explicit confirmation, regression rejection, and disappearance.
5. `PENDING_CREDENTIALS`: run the credentialed spike on real Jeju routes and replace conservative assumptions with measured cadence and field semantics.

## Decisions

- Polling is request-driven for the pilot. There is no background timer when no ride asks for a snapshot.
- Vehicle cache defaults to 20 seconds. This is deliberately conservative before provider cadence is measured and can be overridden with `PUBLIC_DATA_VEHICLE_TTL_MS`.
- Route stops default to a six-hour cache because route topology is much less volatile than vehicle position.
- Failed provider calls are never cached.
- Once a vehicle is selected, disappearance or contradictory evidence degrades or loses the session; it never switches to another vehicle automatically.
- If realtime data lacks a stop sequence, a stop is estimated only when the vehicle is within 120 m of a known route stop. Estimated progress is explicitly labeled and must not be confused with validated provider semantics.
- Session state is in memory for this pilot. Durable storage and scheduled APNs workers remain deferred until live cadence and hosting needs are measured.

## Reproduction

```bash
npm test --prefix services/api
PUBLIC_DATA_SERVICE_KEY='…' node --experimental-strip-types scripts/transit-spike/run.ts '<official-route-id>' 50110
```

With the Node API running, pilot endpoints are:

```text
GET  /v1/stops?routeId=…&stdgCd=…
GET  /v1/vehicles?routeId=…&stdgCd=…
POST /v1/sessions
GET  /v1/sessions/:id
POST /v1/sessions/:id/confirm
```

## Risks and exact next action

The largest product risk is not code but unverified live semantics: identifier continuity, direction/variant behavior, provider cadence, event codes, and whether stop sequence is ever present in realtime payloads. The exact next action after CI is green is to obtain an approved key and record a bounded Route 365 spike while respecting the 5,000-call development quota.

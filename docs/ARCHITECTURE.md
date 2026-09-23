# Architecture

## Boundaries

```text
Official transit API → TypeScript provider adapter → route-scoped cache → normalized snapshots
                                                                  ↓
Ride intent → vehicle matcher → in-memory pilot RideSession / progress → ContentState
                                                                  ↓
                                             SwiftUI app + ActivityKit local updates
                                                                  ↓
                                            future APNs Live Activity push gateway
```

`TapsoTransit` is framework-independent Swift. It owns route/stop identity, Haversine and bearing helpers, freshness, matching evidence, destination progress, and journey transitions. It imports neither SwiftUI nor ActivityKit.

The iOS app owns presentation, demo scheduling, haptics, and the ActivityKit lifecycle. `TapsoActivityAttributes` is intentionally small and `Sendable`; the app and extension share it.

The API service owns external DTO normalization and secrets. `TransitProvider` prevents government fields from leaking through the product. `CachedTransitProvider` adds route-scoped read-through caching and concurrent-miss coalescing without caching failures. The service exposes `/health`, `/v1/cities`, `/v1/routes`, `/v1/stops`, `/v1/vehicles`, `/v1/matches`, and `/v1/sessions` create/refresh/confirm.

`src/apiRouter.ts` holds that surface once, over Web `Request`/`Response`. Two transports bind to it: `src/server.ts` for the local Node process and the Vercel Functions in `services/api/api/` for production. Routing, validation, cache headers, CORS, abuse limits, error shape, and logging therefore cannot drift between them. The API deploys from its own Vercel project rooted at `services/api`, separate from the marketing site's project rooted at `apps/web`. See `PRODUCTION_TRANSIT_API.md`.

## Runtime strategy

The practical MVP target is shared route polling with short-lived cache and fan-out to active rides. One upstream request per user per second would waste quota and amplify failures. Phase 1 implements request-driven shared snapshots: vehicle results default to a 20-second TTL and route stops to six hours, both overrideable after live cadence is measured. No background timer runs when no ride asks for a snapshot.

The session coordinator is intentionally in-memory. It automatically selects only when the match margin is sufficient; ambiguous candidates require explicit confirmation. After selection, a contradictory or missing snapshot never silently switches to another vehicle. Duplicate or backward progress is ignored, and a bounded grace window retains the last accepted progress before the session becomes `lost`.

One process's memory is the wrong store for a horizontally scaled runtime, so the session endpoints fail closed there rather than losing state silently: `TRANSIT_SESSIONS_ENABLED` defaults to `false` whenever `VERCEL` is set and the three routes answer `503 SESSIONS_UNAVAILABLE`.

Reachability and authority are separate axes, and each has its own flag. `TRANSIT_SESSIONS_ENABLED` decides whether the ride endpoints answer. `TRANSIT_AUTOMATIC_MATCHING_ENABLED` — `false` by default on every platform, including the local Node server — decides whether the server may select a passenger's vehicle at all. With it false the coordinator runs in shadow mode: it ranks candidates and publishes server-observed cadence evidence, and assigns `selectedVehicleId` only when a rider explicitly confirms. Enabling sessions therefore cannot enable automatic matching, which is asserted end to end in `services/api/test/apiRouter.test.ts`.

Sessions are held behind a `JourneySessionStore` (`services/api/src/sessionStore.ts`) with two implementations: the in-process default, and an Upstash Redis database reached over its REST API. `TRANSIT_SESSION_STORE` names which, and naming `redis` without usable credentials throws at wiring time rather than falling back to memory — a silent fallback would leave a deployment that believed it had durable sessions running on the failure mode it was trying to leave. Every key lives under `TRANSIT_SESSION_KEY_PREFIX` (default `tapso:journey-session:`), validated at boot by `sessionKeyPrefix.ts`, so one database can hold several environments and unrelated data without any of them reaching another's keys.

The store contract is a compare-and-set, not a put, and that is the whole point of it. `JourneySessionCoordinator` refuses to move a rider backward along a route, a guarantee that holds inside one process because one object is the only copy. Across instances it becomes two readers of the same session, both deriving progress from what they read, and the slower write winning — the rider's stop sequence goes backward through a code path that explicitly forbids it. So every load carries a version, every save states the version it read, and a stale save loses and returns the winner's stored state instead of overwriting it. `services/api/test/journeySession.test.ts` holds two coordinators in that overlap and asserts the rider does not reverse.

Durable storage is not what withholds automatic passenger tracking; the open field-validation gate in `DATA_VALIDATION.md` is. The two are separate axes and each has its own flag.

Realtime stop sequence is not assumed. If the provider supplies one and it maps to the selected route, it is used. Otherwise a stop is estimated only when the vehicle coordinate is within a conservative 120 m radius of a known route stop; that progress is labeled as an estimate until credentialed live validation proves the semantics.

Because each serverless instance holds its own cache, successful reads also carry a CDN `s-maxage` equal to the in-process TTL. That shared layer, not process memory, is what actually bounds upstream fan-out in production. No `stale-while-revalidate` window is granted to vehicle data.

A production ride feature will still need a durable session store and a queue or scheduled worker for APNs. Neither is built yet, and neither is required by the read endpoints iOS needs first.

## Failure posture

- Wrong identity evidence: reject.
- Close candidates: request confirmation.
- Duplicate or out-of-order update: ignore.
- Temporarily missing update: retain the last state within a bounded grace period.
- Stale stream: show degraded state; never issue a confident arrival.
- Extended disappearance: mark tracking lost; never silently rematch.
- Provider schema missing required route-stop identity: fail closed instead of inventing IDs.

## Dependency choices

The core has no third-party dependencies. The iOS project is generated by XcodeGen but is also checked in as a real Xcode project. The API uses Node built-ins so the scaffold can run without an install step.

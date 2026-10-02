# Production transit API

The TAPSO transit API is the server-side boundary between TAPSO clients and the
official TAGO bus route and location services. This document is the contract,
the deployment procedure, and the honest list of what it does and does not yet
guarantee.

Reality labels follow the convention this document started with: `VERIFIED`
means executed and observed, `IMPLEMENTED` means written and covered by tests,
`UNVERIFIED` means neither. In the evidence labels of
`exec-plans/HUMAN_LABOR_ELIMINATION.md` (2026-09-29), `VERIFIED` against a live
deployment is `VERIFIED_LIVE_INFRASTRUCTURE`, `IMPLEMENTED` is
`VERIFIED_BY_TEST`, and a run against a synthetic upstream is `SIMULATED`.

## Topology

```text
 iOS TAPSO ──HTTPS──┐
 diagnostic tools ──┤
                    ▼
        ┌───────────────────────────┐
        │  transit API (own host)   │   Vercel project: tapso-api
        │  root directory:          │   root: services/api
        │    services/api           │
        │                           │
        │  api/*.ts  ──────────┐    │   transport adapter (Vercel Functions)
        │                      ▼    │
        │            src/apiRouter  │   routing, validation, CORS, limits,
        │                      │    │   cache headers, error shape, logging
        │                      ▼    │
        │   CachedTransitProvider   │   6 h stops / 20 s vehicles / 6 h discovery
        │                      │    │   + CDN s-maxage with the same numbers
        │                      ▼    │
        │    TagoTransitProvider    │   fixed official hosts, no redirects,
        └──────────────────────┼────┘   9 s per request (6 s per attempt), bounded pagination
                               ▼
             https://apis.data.go.kr/1613000/BusRouteInfoInqireService
             https://apis.data.go.kr/1613000/BusLcInfoInqireService
                               ▼
                      Jeju live bus data (cityCode 39)

 the same src/apiRouter is also served by src/server.ts on 127.0.0.1:8787,
 so local development and production share one implementation.

 journey sessions: in-process memory by default, or Upstash Redis over its
 REST API when TRANSIT_SESSION_STORE=redis (see Sessions).

 Railway ride collector: a separate service for the legacy human-ride flows,
 built from services/api/Dockerfile.collector (src/backgroundServer.ts). It
 polls TAGO directly (every 5 s by default) during an operator or beta capture
 and, when Upstash is configured, keeps field-validation submissions and
 beta-tester data there. No release gate depends on it.

 apps/web (marketing site + /api/waitlist, /api/support/*) stays on its own
 Vercel project and is untouched by this service.
```

## Why a separate deployment

`docs/DECISIONS.md` placed the waitlist and support endpoints inside the
marketing site's Vercel project and recorded the condition for revisiting that:
*"Revisit this if the iOS client ever needs the same endpoints."* The iOS client
now needs them, so the decision is revisited here.

- **Self-contained build.** The marketing project's Root Directory is
  `apps/web`. Serving transit endpoints from there would require either
  importing across the root-directory boundary — which depends on a Vercel
  project setting this repository cannot assert — or relocating the transit
  domain into the marketing app. Rooting the API at `services/api` needs
  neither: every file the functions import already lives under that root.
- **Blast radius.** A transit function fault, a TAGO outage, or an abusive
  caller now consumes the API project's function budget and rollback history,
  not the public product site's.
- **Credential separation.** `TAGO_SERVICE_KEY` is set on the API project only.
  The marketing project never holds it. The Railway collector, a separate
  service (see *Topology*), needs its own.
- **Client contract.** iOS gets a base URL that is not the marketing domain, so
  a later move to a custom `api.` host changes one constant instead of a
  deployment topology.
- **Deploy cadence.** `ignoreCommand` skips production builds for commits that do
  not touch `services/api`, so the API does not redeploy when marketing copy
  changes, and the marketing site does not redeploy when the API changes. It only
  skips on `main`: a preview must reflect its branch head, and a branch whose API
  change sits under a later docs commit would otherwise never build.

Rejected: adding a runtime dependency, a database, a queue, or a second hosting
provider. None of them is needed to answer these reads, and the feature that
would justify a durable store is policy-disabled (see *Sessions*).

*2026-09-29:* the read endpoints still need none of them. Two separate pieces
were added later: an optional Upstash session store (see *Sessions*) and the
Railway ride collector for the legacy ride flows, which carries the package's
one runtime dependency, `web-push` (see *Topology*).

## Base URL contract

Clients must treat the base URL as one configurable constant and append the
paths below. Never hard-code a preview deployment URL — preview hostnames change
on every push.

| Environment | Base URL |
|---|---|
| Local | `http://127.0.0.1:8787` |
| Preview | A per-branch alias (`tapso-api-git-<branch>-club-paradiso.vercel.app`) plus a per-commit URL, both in the pull request's `Vercel – tapso-api` check. Never hard-code either into a client |
| **Production** | **`https://tapso-api.vercel.app`** — the canonical base URL. This is what Task D points iOS at. Never substitute a per-deployment URL (`tapso-api-<hash>-club-paradiso.vercel.app`): those are pinned to one build |
| Future | `https://api.<custom domain>` once one is registered; paths do not change |

Every endpoint is also reachable at `<base>/api/...` because that is the
underlying Vercel Function path. The `/api`-less form is the contract; the
rewrites in `services/api/vercel.json` map it onto the functions, and the router
accepts both so local and production paths are identical.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service, provider, cache policy, session policy, build identifier, matching posture, freshness posture |
| GET | `/v1/cities` | Official TAGO city discovery |
| GET | `/v1/routes?cityCode=&routeNo=` | Every official route ID for a route number. `routeNo` is optional: without it the provider is asked to list the whole city, and a provider that will not is reported as such rather than invented |
| GET | `/v1/stops?routeId=&cityCode=` | Ordered, direction-specific stop topology |
| GET | `/v1/route-info?routeId=&cityCode=` | A route's published service day from TAGO `getRouteInfoIem` (REPORTED-OFFICIAL, dataset 15098529): `firstDeparture` / `lastDeparture` as `HH:MM` and `headwayMinutes` for weekday, Saturday and Sunday, each present only when TAGO publishes a valid value. The times are departures from the route's **starting stop** (`meta.timeReference: "starting_stop_departure"`); headways are published averages, never a timetable. `404 NOT_FOUND` when the provider knows no such route or publishes no service day. `meta.undocumentedFields` (only when present) lists service-day fields TAGO sent in a shape its documentation does not give, verbatim and cut to 16 characters; the item never uses them. For Jeju, production answers HTTP 200 with no service-day field in the item and `meta.undocumentedFields: {"intervaltime": "0"}` (`VERIFIED` 2026-10-01, all 58 variants of 102, 202, 282, 365 and 800) |
| GET | `/v1/vehicles?routeId=&cityCode=` | Normalized live vehicle snapshot |
| POST | `/v1/matches` | Rank caller-supplied candidates; no upstream call |
| POST | `/v1/sessions` | Create a ride session |
| GET | `/v1/sessions/:id` | Refresh a ride session |
| DELETE | `/v1/sessions/:id` | End a ride session: the row is deleted, `204`; an unknown or already ended id is `404` |
| POST | `/v1/sessions/:id/confirm` | Confirm a vehicle explicitly |
| PUT | `/v1/sessions/:id/live-activity` | Store the ride's Live Activity push token, `{ "pushToken": "<hex>" }`; answers its fingerprint, never the token. `503 LIVE_ACTIVITY_PUSH_UNAVAILABLE` unless APNs is configured (`/health` → `liveActivityPush.enabled`) |
| DELETE | `/v1/sessions/:id/live-activity` | Clear the push token, `204`; ending the session clears it too |

Two further paths exist for controlled ride evidence only, a legacy flow that
no release gate has required since 2026-09-29. They require
`Authorization: Bearer <RIDE_CAPTURE_OPERATOR_TOKEN>`, answer `no-store`, and
stay disabled unless that token is configured. They are documented in full in
[RIDE_CAPTURE_CONTROLLER.md](RIDE_CAPTURE_CONTROLLER.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/operator/snapshot?routeId=&cityCode=` | Live vehicles straight from the provider, bypassing the 20-second cache, because Task B measures how often the provider's own content changes |
| POST | `/operator/analyze` | A completed ride capture in, the sanitized report out; stateless, never stored, never logged |

### Rules the contract keeps

- **Route variants are never collapsed.** `routeNo=365` returns six official
  route IDs. `JEB405136521` and `JEB405136522` are the two full-length
  directions; a route ID carries direction identity, so a client must choose
  one, not a route number.
- **Stop order is domain data.** `sequence` is TAGO `nodeord`, sorted ascending,
  scoped to the requested route ID. `meta.directionScope` is `route_id`.
- **Timestamps are not invented.** TAGO publishes no source observation
  timestamp. Each vehicle therefore carries `timestampSource: "unavailable"`,
  the epoch sentinel in `observedAt`, and TAPSO's read time in `receivedAt`.
  Receipt time is never presented as freshness, and no rule anywhere claims to
  know when TAGO observed a vehicle.
- **The freshness posture is one object, published identically by `/health`,
  `/v1/vehicles` and `/operator/snapshot`.** It separates three claims that are
  easy to conflate:

  | Field | Value | Means |
  |---|---|---|
  | `providerObservationTimestamp` | `"unavailable"` | TAGO publishes none, and none is reconstructed |
  | `policy` | `"server_observed_cadence_v1"` | TAPSO judges liveness from its own repeated receipts of *changing* provider content |
  | `automaticMatching` | `"shadow_only_pending_matching_readiness"` | candidates are ranked and evidence published; the server never selects a bus |
  | `automaticMatchingWithheldBecause` | the readiness text | release gate `matcher-passive-safety-v4` has demonstrated `READY_FOR_SHADOW`; automatic selection needs `READY_FOR_BOUNDED_AUTOMATION`. Not durable storage |
  | `matchingReadiness` | `{gate, demonstrated, requiredForAutomaticMatching, evidence}` | a reviewed constant in `matchingReadiness.ts` that CI ties to the committed gate result; never read from the environment |
  | `fieldValidationGate` | `{status: "superseded", supersededBy: "matcher-passive-safety-v4", requiredBoardings: 30, …}` | the historical thirty-boarding gate, never met, no longer deciding anything |
  | `cadencePolicy.calibration` | `"provisional"` | every threshold is an operational gate, not a measured value |

  `automaticMatching` reads `"enabled_by_explicit_operator_opt_in"` only where
  an operator has set `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true` **and** the
  demonstrated readiness is at least `READY_FOR_BOUNDED_AUTOMATION`. Below that
  the configuration refuses the flag: `/health` then shows
  `matching.automaticMatchingRequested: true`, `automaticMatchingEnabled: false`
  and `withheldReason: "matching_readiness_below_bounded_automation"`, and the
  production smoke test warns. It is `false` on every platform by default,
  including the local Node server. `matching.matcherPolicy` names the serving
  policy (`directed-route-progress-v1`), and `matching.sessionMatchingMode`
  reports what the journey-session coordinator actually runs (`shadow` unless
  automatic selection was granted; the smoke test fails if it reads
  `automatic` below `READY_FOR_BOUNDED_AUTOMATION`). `POST /v1/matches` answers
  carry `policyVersion`, `riderState`, `abstentionReasons`, `matchingMode` and
  `automaticSelection` (`permitted` | `withheld`). While selection is withheld
  the answer has no `selectedVehicleId`: the matcher's pick is published as
  `shadowSelection: {status, wouldSelectVehicleId, confidence}`, exactly as a
  session's is, and logged as `vehicle_match_shadow`. The endpoint is
  stateless: it accepts no session memory (`passage`, `declaredAt`).
- **Identifiers are validated before the upstream call.** `cityCode` is
  `[0-9]{1,6}`, `routeId` is `[A-Za-z0-9_-]{1,64}`, `routeNo` is up to 16
  alphanumeric or Hangul characters. The former B551982 `stdgCd` and
  `regionCode` aliases stay rejected with `400`.

### Error shape

`{"error": "<CODE>", "message": "<safe text>"}`

| Code | Status | Meaning |
|---|---|---|
| `INVALID_INPUT` | 400 | Missing or malformed parameter, body, or content type |
| `NOT_FOUND` | 404 | No such endpoint. A catch-all rewrite keeps unmatched `/v1/...` paths on the JSON contract instead of the platform's HTML 404; paths outside `/v1` and `/health` are not part of the API |
| `SESSION_NOT_FOUND` | 404 | Unknown session id |
| `METHOD_NOT_ALLOWED` | 405 | Wrong method for a known endpoint |
| `SESSION_EXPIRED` | 410 | Session past its TTL |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 64 KiB |
| `RATE_LIMITED` | 429 | Burst limit; `retry-after` is set |
| `PROVIDER_RESPONSE_INVALID` | 502 | TAGO answered, but with an unusable payload (malformed envelope, missing field, logical error code) |
| `PROVIDER_UNAVAILABLE` | 502 | TAGO could not be reached, or answered with an HTTP error status after the one transient retry |
| `PROVIDER_TIMEOUT` | 504 | TAGO did not answer within the 8-second deadline, twice |
| `BLOCKED_BY_CREDENTIALS` | 503 | No TAGO service key is configured |
| `SESSIONS_UNAVAILABLE` | 503 | Ride sessions are disabled on this deployment |
| `INTERNAL_ERROR` | 500 | Unexpected failure; the message is always `internal error` |

An unmapped failure never echoes its thrown message to the caller. It is logged
server-side and answered generically.

The three provider codes, `INTERNAL_ERROR` and a successful empty list are five
different situations for a rider, and a client must not collapse them (Product
V3, `docs/exec-plans/PRODUCT_V3_JEJU_NATIVE.md`): an empty `items` array means
the route reports no bus right now; `PROVIDER_TIMEOUT` and `PROVIDER_UNAVAILABLE`
mean the feed is slow or down, so try again shortly; `PROVIDER_RESPONSE_INVALID`
means the feed sent something unusable; `INTERNAL_ERROR` means TAPSO itself
failed. A journey session absorbs a bounded run of any of the three provider
failures as `degraded` (keeping its last accepted progress) before surfacing the
error. None of them is ever turned into a statement about a bus.

## Configuration

All values are server-side environment variables. No credential among them is
ever returned, logged, or placed in a URL a client can see.

| Name | Required | Default | Purpose |
|---|---|---|---|
| `TAGO_SERVICE_KEY` | yes, for live data | — | Public Data Portal **Decoding** key. The canonical name, and the only one production reads. Without it every TAGO-backed endpoint answers `503 BLOCKED_BY_CREDENTIALS`. Store it on Vercel as a **Sensitive** variable. |
| `PUBLIC_DATA_SERVICE_KEY` | no — deprecated | — | The retired name. Honoured **only** when `VERCEL` is unset, so an existing local `.env.local` keeps working. Ignored outright on any Vercel deployment. |
| `TRANSIT_STOP_TTL_MS` | no | `21600000` (6 h) | Route-stop cache window |
| `TRANSIT_VEHICLE_TTL_MS` | no | `20000` | Vehicle snapshot cache window |
| `TRANSIT_DISCOVERY_TTL_MS` | no | `21600000` (6 h) | City and route-number discovery cache window |
| `TRANSIT_RATE_LIMIT_PER_MINUTE` | no | `120` | Per-caller burst limit; `0` disables |
| `TRANSIT_ALLOWED_ORIGINS` | no | empty | Comma-separated absolute origins allowed by CORS |
| `TRANSIT_SESSIONS_ENABLED` | no | `true` locally or with the `redis` store; `false` on Vercel with the `memory` store | Whether the three session routes answer (see *Sessions*) |
| `TRANSIT_SESSION_STORE` | no | `memory` | `memory` (one process) or `redis` (Upstash Redis over its REST API). `redis` without both Upstash variables, or any other value, is refused at boot rather than falling back to memory |
| `TRANSIT_SESSION_KEY_PREFIX` | no | `tapso:journey-session:` | Redis key namespace for journey sessions, validated at boot on every store by `src/sessionKeyPrefix.ts`: `tapso:(<segment>:){0,3}journey-session:`, at most 96 characters. Set-but-empty or malformed is refused, never defaulted. Kept out of `/health` |
| `UPSTASH_REDIS_REST_URL` | with `redis` | — | Upstash REST endpoint; an absolute `https` URL, plain HTTP is refused |
| `UPSTASH_REDIS_REST_TOKEN` | with `redis` | — | Upstash REST token. Like the TAGO key it never reaches `/health`; `sessions.durableStoreConfigured` reports presence only |
| `TRANSIT_AUTOMATIC_MATCHING_ENABLED` | no | `false` | Operator opt-in to automatic vehicle selection (`true`/`1`/`false`/`0`; anything else fails at boot). Refused below `READY_FOR_BOUNDED_AUTOMATION`; the demonstrated readiness is `READY_FOR_SHADOW` (`src/matchingReadiness.ts`, never read from the environment). When refused, `/health` reports `matching.automaticMatchingRequested: true`, `automaticMatchingEnabled: false` and `withheldReason: "matching_readiness_below_bounded_automation"`, and the runtime logs `automatic_matching_refused` once per process |
| `PORT` | no | `8787` | Local Node server (`src/server.ts`) only |
| `RIDE_CAPTURE_OPERATOR_TOKEN` | no | unset → `/operator/*` disabled | Shared secret for the ride-capture endpoints and the mobile controller. Minimum 24 characters; a shorter value is refused. Store it on Vercel as a **Sensitive** variable |
| `RIDE_CAPTURE_OPERATOR_RATE_LIMIT_PER_MINUTE` | no | `30` | Per-caller ceiling on the operator budget, kept separate from the public one; `0` disables |

`VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`, and `VERCEL_GIT_COMMIT_SHA` are supplied
by the platform. `VERCEL` also marks a serverless deployment, which the session
default and the retired credential name above depend on; the other three are
read for the health payload only.

The key must never appear in the repository, in a `VITE_*` variable, in the
browser bundle, in the iOS binary, in a client request, in a log line, in an
error message, in a committed fixture, or in a documentation example. Set it in
the Vercel project's environment variables for **Production** and, only when
someone needs to exercise preview deployments against live data, for
**Preview**. Preview deployments do not inherit a production credential by
default and should not be given one casually: preview URLs are shared more
widely than production ones.

The Railway collector (`src/backgroundServer.ts`) reads its own environment:
`TAGO_SERVICE_KEY`, `RIDE_CAPTURE_OPERATOR_TOKEN`, `TRANSIT_ALLOWED_ORIGINS`, the
two `UPSTASH_REDIS_REST_*` variables, `BETA_TESTERS_ENABLED`, the three
`WEB_PUSH_VAPID_*` variables, `PORT` (default `8788`) and `HOST` (default
`0.0.0.0`). The repository's `.env.example` lists them.

### Why the name changed

The credential was originally called `PUBLIC_DATA_SERVICE_KEY`, after the Korean
Public Data Portal it comes from. The name is wrong for a secret: platforms read
a `PUBLIC_` prefix as "expose this to the browser", and Vercel accordingly
refuses to store such a variable with Sensitive visibility.

The two ways out were to lower the key's visibility to match the name, or to fix
the name. Lowering visibility would leave a live government API credential
sitting at a weaker protection level because of a naming accident, so the name
changed instead.

`resolveTagoServiceKey` in `services/api/src/serviceKey.ts` is the single place
that decides this, and both the provider and the health payload go through it —
they cannot end up disagreeing about whether a credential is configured. The
retired name resolves only when `VERCEL` is unset. That is what makes "the
production secret is stored as Sensitive" a property of the deployment rather
than a convention someone has to remember.

## Security posture

- **Upstream.** `TagoTransitProvider` targets two fixed official HTTPS hosts
  that cannot be overridden by environment variables, refuses redirects, gives
  one logical request (every page and retry) 9 s and an attempt at most 6 s,
  retries a transport failure, timeout, HTTP 5xx or malformed envelope once
  after a jittered 250–500 ms pause and only with 2 s of the budget left, bounds
  pagination, validates `resultCode`, and normalizes provider errors to a
  numeric code. There is no caller-controlled URL anywhere in the path, so no
  SSRF surface is introduced.
- **Provider telemetry.** Each logical TAGO request writes one
  `provider_request` log line (operation, outcome class, latency, attempts,
  last HTTP status, TAPSO's own failure message) and feeds `/health` →
  `providerHealth`, a rolling summary of the last 100 requests of *this warm
  instance* (outcomes, retried count, p50/p95/max latency, last failure). It
  never carries the request URL, the service key or a vehicle number, and no
  rider-facing decision reads it.
- **Stale stops, never stale vehicles.** When TAGO fails to refresh a route's
  stop list, `/v1/stops` answers the last list this instance read, up to a day
  old, with `meta.servedStale` and `cache-control: no-store`. Vehicle positions
  are never served from an old read: the failure is the answer.
- **CORS.** No browser origin is allowed unless an operator lists it in
  `TRANSIT_ALLOWED_ORIGINS`. A native iOS client is not a CORS client and is
  unaffected. `Access-Control-Allow-Origin: *` is never emitted, and `*` is not
  an accepted configuration value.
- **Abuse.** Every request passes a per-caller fixed-window burst limit. Caching
  absorbs legitimate repetition, so the limiter only has to stop pathological
  fan-out. In serverless the counters are per warm instance, which is a soft
  limit, not a global one.
- **Logging.** One structured JSON line per request: route, path, method,
  status, cache outcome, provider, duration, masked client address, and the
  public `cityCode`/`routeId`/`routeNo` when they are valid. No credential, no
  authenticated URL, no upstream body, no vehicle inventory.
- **Headers.** `x-content-type-options: nosniff`, `referrer-policy: no-referrer`
  on every response, plus HSTS from `vercel.json`. Error responses and all
  session and health responses are `no-store`.

## Caching

The measured evidence is in `docs/DATA_VALIDATION.md`: the Route 365
snapshot-content change interval had a median of 27.52 s. The 20-second vehicle
window stays shorter than that median without provoking wasteful five-second
upstream polling, and is unchanged by this work.

Two layers now share those numbers:

1. **In-process** read-through cache with concurrent-miss coalescing. Failures
   are never stored, so an outage cannot be replayed as a success.
2. **Shared CDN** cache, because in serverless each warm instance holds its own
   memory. Successful reads carry
   `public, max-age=0, s-maxage=<same TTL>, must-revalidate`. No
   `stale-while-revalidate` window is granted: serving knowingly stale vehicle
   data is exactly the failure this product must not have.

`/v1/cities` and `/v1/routes` previously reached TAGO on every request. They now
use the same primitive with a six-hour window. `/v1/route-info` uses the same
six-hour window per route: a route's service day changes rarely, and one read
per route per window keeps it off the vehicle budget.

## Sessions and the serverless persistence risk

| Question | Answer |
|---|---|
| What is the session store? | A `JourneySessionStore` (`src/sessionStore.ts`) chosen by `TRANSIT_SESSION_STORE`: `memory`, the default, is a `Map` in one process; `redis` is Upstash Redis over its REST API (`src/upstashSessionStore.ts`), with every key under `TRANSIT_SESSION_KEY_PREFIX`. Every save is a compare-and-set on a version, so a stale writer cannot move a rider backward. |
| Is the memory store safe on serverless? | **No.** Vercel Functions scale horizontally and recycle instances. A session created on one instance is absent from the next, so `GET /v1/sessions/:id` would return `404` unpredictably. |
| What is done about it? | The endpoints fail closed. `TRANSIT_SESSIONS_ENABLED` defaults to `false` whenever `VERCEL` is set and the store is `memory`, and the session routes answer `503 SESSIONS_UNAVAILABLE` with the reason. `/health` reports `sessions.store`, `sessions.enabled` and `sessions.durableStoreConfigured` honestly. |
| Can production and a preview share the Upstash database? | Only by namespace, so the namespace is enforced (`src/sessionKeyPrefix.ts`, 2026-10-01). A deployment with `VERCEL_ENV=production` serves sessions only from `tapso:prod:journey-session:`; nothing else (preview, development, a local process) may use that namespace; the `verify` namespace is never served. A violation does not stop the deployment booting: sessions are disabled, the session routes answer `503 SESSIONS_UNAVAILABLE` naming the namespace rule, and `/health` reports `sessions.namespace` (the category: `production`, `preview`, `default`, `verification` or `custom`, never the prefix) and `sessions.problem`. |
| How does a ride end? | `DELETE /v1/sessions/:id` deletes the row instead of leaving it to its 4-hour TTL: a finished ride stops costing provider reads, and its stop history stops existing. A refresh racing the delete loses its compare-and-set and answers `410`. |
| Is the Upstash store verified? | Against the live service on 2026-09-23 (`VERIFIED_LIVE_INFRASTRUCTURE`): store 15/15 and a preview deployment 12/12 (`exec-plans/DURABLE_JOURNEY_SESSIONS.md`). Production was left on the memory store: the operator's record of 2026-09-23 (`HISTORICAL_REPORT_ONLY`), not an observation; `/health` `sessions.store` is the authority. Moving production is a separate decision that needs `TRANSIT_SESSION_KEY_PREFIX=tapso:prod:journey-session:` (`KNOWN_ISSUES.md`). |
| Does a durable store enable automatic matching? | **No.** Sessions and automatic selection are separate flags. Automatic selection is withheld by release gate `matcher-passive-safety-v4`, not by the store, and the configuration refuses `TRANSIT_AUTOMATIC_MATCHING_ENABLED` below `READY_FOR_BOUNDED_AUTOMATION`. |
| Does validation need sessions? | **No.** Matcher evidence comes from rider-free passive collection, which reads the stateless read endpoints or TAGO directly, and from offline replay; neither calls the session API (`.github/workflows/matcher-evidence.yml`). |

Task C's freshness rule now exists (`server_observed_cadence_v1`) and the
durable store is built. A production ride feature still needs production moved
onto that store (*Enabling durable sessions in production* below), and a queue
or scheduled worker for APNs (`ARCHITECTURE.md`).

### Enabling durable sessions in production

Status 2026-10-02: production still answers `503 SESSIONS_UNAVAILABLE` from the
memory store (post-deploy verification run `36976781695`, 07:05 UTC, build
`98c50135f63d`: "sessions policy 503 SESSIONS_UNAVAILABLE"; the lifecycle smoke
skipped). The code is ready; what is missing is four environment variables on
the `tapso-api` Vercel project, which only an account with access to that
project can set. The agent's Vercel connection reaches only team
`club-paradiso` with one project, `visable`; `tapso` and `tapso-api` are not in
it, and reading `tapso-api.vercel.app` through it is refused (403), so an agent
can neither read their settings nor set these. In the Vercel dashboard →
`tapso-api` → Settings → Environment Variables, add for **Production** only:

| Name | Value | Sensitive |
|---|---|---|
| `TRANSIT_SESSION_STORE` | `redis` | no |
| `TRANSIT_SESSION_KEY_PREFIX` | `tapso:prod:journey-session:` | no |
| `UPSTASH_REDIS_REST_URL` | the same Upstash database's REST URL the preview used on 2026-09-23 | yes |
| `UPSTASH_REDIS_REST_TOKEN` | its REST token | yes |

Leave `TRANSIT_SESSIONS_ENABLED` and `TRANSIT_AUTOMATIC_MATCHING_ENABLED` unset:
the first defaults to `true` with the durable store, the second stays `false`
and would be refused anyway. Then redeploy production (Deployments → latest
production → Redeploy). Nothing else is manual:

1. `.github/workflows/post-deploy.yml` (dispatch it, or wait for its daily run)
   runs the read-only smoke, which must now report `PASS session store durable
   store (redis), namespace production, sessions enabled`, and
   `scripts/session-smoke.ts`, which creates one ride session through the public
   API, reads it back across requests and concurrently, confirms a bus if one
   is offered, ends it with `DELETE` and checks it is gone. It prints no vehicle
   number and leaves nothing behind.
2. A wrong namespace (the preview's, or the shared default) is caught by the
   API itself: sessions stay off and `/health` says why. Correct the variable
   and redeploy.

Rollback: delete `TRANSIT_SESSION_STORE` (or set it to `memory`) and redeploy;
sessions return to `503`, and rows already written expire on their own TTL.

## Running locally

```bash
# Store the Decoding key in an ignored .env.local with permissions 0600.
# `env -u` makes sure an exported shell value cannot shadow the file.
env -u TAGO_SERVICE_KEY node --env-file=.env.local \
  --experimental-strip-types services/api/src/server.ts

curl -s http://127.0.0.1:8787/health
curl -s 'http://127.0.0.1:8787/v1/routes?cityCode=39&routeNo=365'
```

Verification:

```bash
npm --prefix services/api test
npm --prefix apps/web ci && npm --prefix apps/web run typecheck:vercel
npx --prefix apps/web tsc --project services/api/tsconfig.json \
  --typeRoots apps/web/node_modules/@types      # run from the repository root
```

## Deploying

The API deploys from the Git integration of a Vercel project whose **Root
Directory is `services/api`**. `services/api/vercel.json` supplies everything
else: static output directory, function bundling, the public path rewrites,
security headers, silent GitHub comments, and an `ignoreCommand` that skips
builds for commits that do not touch `services/api`.

The project is `tapso-api` (`prj_XTimnEWdrhaDMSJfgELHzQAo3Nn2`) in the
`club-paradiso` team, serving `https://tapso-api.vercel.app`. `VERIFIED` on
2026-09-12: it is linked to `club-paradiso/tapso`, Vercel reports its Root
Directory as `services/api`, and preview and production deployments reach
`Ready` / *Deployment has completed*.

`TAGO_SERVICE_KEY` is set on Production with Sensitive visibility.

The credential was added *after* the `b59e9e6` production deployment was created
(2026-09-12T07:57:01Z), and that same build then reported
`credential.source: "canonical"` — its `build.commit` is `b59e9e60b863`. So a
variable added to Production reached an already-running deployment without a
rebuild. Do not assume the reverse; `/health` is the authority either way,
because `liveTransitConfigured` and `credential.source` describe the running
build rather than the project settings. If they ever disagree with the dashboard,
redeploy production (**Redeploy**, or
`vercel redeploy <deployment-url> --target=production`) and check again. No code
change is involved.

The first production deployment ran on the merge of pull request #25 and
succeeded. First-time setup is complete for `tapso-api`; the steps are kept
because they are what any new environment of this API needs.

1. Settings → Environment Variables: add **`TAGO_SERVICE_KEY`** (Decoding key)
   for Production, with **Sensitive** visibility. Done for `tapso-api` on
   2026-09-12. Add it for Preview only if preview deployments must reach live
   data. Until it is set, every TAGO-backed endpoint answers
   `503 BLOCKED_BY_CREDENTIALS` and `/health` reports
   `liveTransitConfigured: false`. `/health` is the authority on whether it is
   set; nothing else reveals it.

   Do **not** use `PUBLIC_DATA_SERVICE_KEY` here. Vercel reads a `PUBLIC_`
   prefix as a public framework variable and will not store it with Sensitive
   visibility; the deployment therefore ignores that name on purpose, rather
   than letting a server credential sit at a lower visibility to match a bad
   name. A project carrying only the retired name shows
   `credential: { source: "missing", deprecatedNamePresent: true }` in `/health`.
2. Settings → Deployment Protection: production must be publicly reachable for
   the iOS client. Preview may stay protected.
3. `/health` must report `liveTransitConfigured: true` and
   `credential.source: "canonical"`, and the smoke script reports both. For
   `https://tapso-api.vercel.app` both were checked, and the smoke script run,
   on 2026-09-12; see *Production verification*. After merge the scheduled
   production smoke runs the script there (see *Smoke test*), so no manual run
   is required.

There is no separate deploy command. Pushing a branch produces a preview and
merging to `main` is the production deploy.

### Smoke test

```bash
node --experimental-strip-types services/api/scripts/smoke.ts https://<base-url>
# optional: --city 39 --route-no 365 --route-id JEB405136521
```

The script checks response semantics, not status codes alone: that `/health`
carries no credential field and which credential source it reports, whether
`cityCode` 39 is present, that route variants are not collapsed, that stop
sequences are strictly increasing, that every vehicle keeps the epoch sentinel
and `timestampSource: "unavailable"`, and that invalid, missing, legacy,
unknown-path, and wrong-method requests are rejected. It also checks:

- **Freshness posture.** `/v1/vehicles` `meta.freshness` must carry
  `providerObservationTimestamp: "unavailable"` and a known `automaticMatching`
  value; the wording from before the readiness gate,
  `shadow_only_pending_field_validation`, is a warning.
- **Matching posture.** From the `/health` `matching` block: a failure if the
  block is missing, if automatic matching is on, or journey sessions report
  `sessionMatchingMode: "automatic"`, while the demonstrated readiness
  it reports is below `READY_FOR_BOUNDED_AUTOMATION`, or if it names a serving
  policy other than `directed-route-progress-v1`; a warning if
  `TRANSIT_AUTOMATIC_MATCHING_ENABLED` is set and refused, or if it names no
  policy (a deployment from before the directed matcher).
- **Sessions and the operator path.** `POST /v1/sessions` gets a write-free
  probe (boarding stop sequence `0`, rejected by input validation before any
  provider read or store write): `503 SESSIONS_UNAVAILABLE` or
  `400 INVALID_INPUT` passes, and a `201` is a failure. `/operator/snapshot`
  without a token must answer `401` or `503`.
- **Session store.** From the `/health` `sessions` block: the memory store with
  sessions off on serverless passes; a durable store must report its namespace,
  and on a production deployment that namespace must be `production`; a
  `sessions.problem` (the API refusing a namespace) is a failure.

The `health` line also prints the build commit and deployment environment the
deployment reports, which is how a merge is confirmed live.

### Session lifecycle smoke

```bash
node --experimental-strip-types services/api/scripts/session-smoke.ts https://<base-url> \
  [--city 39] [--route-numbers 365,202,201] [--interval-ms 6000] [--require-enabled]
```

Unlike `smoke.ts` it writes, exactly once: one ride session, created, read three
times across requests and four times at once, confirmed with the first bus the
session offers, ended with `DELETE`, and checked gone (`404`, and `404` again on
a second `DELETE`). It runs only where `/health` says sessions are enabled and
automatic matching is off, and on a production deployment only from the durable
store's production namespace; elsewhere it reports `SKIP` and writes nothing
(`--require-enabled` turns that into exit `3`). It never reaches Redis directly,
deletes its session even when a check fails, and masks every vehicle number to
its last four digits. `services/api/test/smoke.test.ts` runs it against the real
handler over a synthetic provider.

A deployment without a credential is reported as `BLOCKED_BY_CREDENTIALS`, never
converted into a pass. A warning is not a failure. It exits non-zero only on a
real failure.

No release or validation step requires running it by hand:

- CI runs it on every push and pull request.
  `services/api/test/smoke.test.ts` points it at the real request handler over a
  synthetic provider (the credentialed path against the current contract), and
  the `matcher-evidence` job points it at the real local server with no
  credential and `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true`, requiring the
  refusal warning.
- After merge, the `production-smoke` job of
  `.github/workflows/matcher-evidence.yml` runs it against
  `https://tapso-api.vercel.app` on every scheduled run (and on a manual
  dispatch) and keeps its output as a 90-day artifact.
- `.github/workflows/post-deploy.yml` runs on every push to `main` that touches
  `services/api`: it waits (up to 20 minutes) until `/health` reports the merged
  commit, then runs `smoke.ts` and `session-smoke.ts` against production. It
  also runs daily and on dispatch.

### Rollback

1. Vercel dashboard → the API project → Deployments → pick the last known-good
   production deployment → **Instant Rollback**. This affects the API project
   only; the marketing site has its own deployment history.
2. If the fault is in the repository, revert the offending commit on `main`; the
   Git integration redeploys.
3. If the fault is a credential or configuration problem, clear or correct the
   environment variable and redeploy. With no key the API degrades to
   `503 BLOCKED_BY_CREDENTIALS` rather than serving wrong data.
4. To take the API offline without touching the marketing site, pause the API
   project in Vercel.

## Production verification

`VERIFIED` on 2026-09-12 against `https://tapso-api.vercel.app`, running build
`b59e9e60b863` (`build.environment: production`, `runtime.platform: vercel`).

| Check | Observed |
|---|---|
| `GET /health` | `200`; `liveTransitConfigured: true`, `credential.source: "canonical"`, `deprecatedNamePresent: false` |
| `GET /v1/cities` | `200`; live TAGO response, `cityCode` 39 제주도 present |
| `GET /v1/routes?cityCode=39&routeNo=365` | `200`; all six official variants — `JEB405136521`, `522`, `523`, `524`, `525`, `530` — with `variantsPreserved: true` |
| `GET /v1/stops?routeId=JEB405136521&cityCode=39` | `200`; 43 stops, sequence 1 → 43, `provider_node_order`, direction-specific |
| `GET /v1/vehicles?routeId=JEB405136521&cityCode=39` | `200`; four live vehicles, `observedAt` epoch sentinel, `timestampSource: "unavailable"`, `receivedAt` present |
| unknown `/v1/*` | `404` `{"error":"NOT_FOUND","message":"no such endpoint"}` — the JSON contract, not the platform's HTML 404 |
| `GET /v1/sessions/test` | `503 SESSIONS_UNAVAILABLE` — the intended serverless fail-closed behaviour |
| Runtime logs after 08:10Z | No unexpected production error. The only error group is the `503` from the deliberate session probe |

The freshness posture is unchanged and was confirmed live:
`providerObservationTimestamp: "unavailable"`, `policy: "fail_closed"`,
`automaticMatching: "withheld_pending_source_freshness_rule"`. Live vehicles are
served, and automatic matching stays withheld until Task B and Task C produce a
source-freshness rule.

> Historical record, retained as observed on that date. Task C replaced those
> two strings with `policy: "server_observed_cadence_v1"` and
> `automaticMatching: "shadow_only_pending_field_validation"`, and release gate
> `matcher-passive-safety-v4` later replaced the second with
> `"shadow_only_pending_matching_readiness"`. The substance did not change:
> automatic matching is still withheld. See the freshness-posture table above
> for what the current fields mean.

## Limitations

- `VERIFIED`: the `tapso-api` project builds and deploys this repository from
  Root Directory `services/api`. Preview deployments and the first **production**
  deployment (merge commit `05f40a4`) all completed successfully, which proves
  the functions compile and bundle, the `.ts` import specifiers resolve, and
  `vercel.json` is accepted.
- `VERIFIED` (2026-09-12, production run against
  `https://tapso-api.vercel.app`): HTTP, credential, and live TAGO behaviour
  all observed end to end. See *Production verification* above.
- `IMPLEMENTED`: the Vercel Functions adapter, the rewrites, and the header and
  cache policy are covered by deterministic tests and by an end-to-end run of
  the same handler over real HTTP through the local Node adapter.
- `SIMULATED`: local end-to-end behaviour, including the credentialed,
  uncredentialed, and serverless-shaped configurations, run through the real
  Node adapter over a synthetic TAGO upstream
  (`exec-plans/PRODUCTION_TRANSIT_BACKEND.md` §5).
- Rate limiting is per warm instance, not global.
- Ride sessions are off by default on serverless while the store is `memory`,
  which is production's store as last recorded (2026-09-23). The Upstash store
  is built and was verified on a preview deployment; moving production onto it
  is a separate decision (see *Sessions*).
- Automatic vehicle matching is withheld: release gate
  `matcher-passive-safety-v4` has demonstrated `READY_FOR_SHADOW`, and the
  configuration refuses it below `READY_FOR_BOUNDED_AUTOMATION`; see
  `validation/MATCHER_SAFETY_EVIDENCE_V4.md`.

## Task B prerequisite

> **2026-09-29.** Historical and not required. No readiness level up to
> `READY_FOR_CONFIRMATION_ASSISTED` needs a ride; matcher evidence now comes
> from rider-free passive collection and replay
> (`exec-plans/HUMAN_LABOR_ELIMINATION.md`).

Task B is a controlled real Route 365 ride capture. It does not depend on this
deployment: `scripts/ride-capture/capture.ts` constructs `TagoTransitProvider`
directly and needs only the local key. The production API matters to Task D,
when iOS connects. See `docs/HANDOFF.md` for the exact Task B commands.

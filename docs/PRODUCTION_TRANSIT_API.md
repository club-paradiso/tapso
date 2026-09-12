# Production transit API

The TAPSO transit API is the server-side boundary between TAPSO clients and the
official TAGO bus route and location services. This document is the contract,
the deployment procedure, and the honest list of what it does and does not yet
guarantee.

Reality labels follow the repository convention: `VERIFIED` means executed and
observed, `IMPLEMENTED` means written and covered by tests, `UNVERIFIED` means
neither.

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
        └──────────────────────┼────┘   8 s timeout, bounded pagination
                               ▼
             https://apis.data.go.kr/1613000/BusRouteInfoInqireService
             https://apis.data.go.kr/1613000/BusLcInfoInqireService
                               ▼
                      Jeju live bus data (cityCode 39)

 the same src/apiRouter is also served by src/server.ts on 127.0.0.1:8787,
 so local development and production share one implementation.

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
  The marketing project never holds it.
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
| GET | `/health` | Service, provider, cache policy, session policy, build identifier, freshness posture |
| GET | `/v1/cities` | Official TAGO city discovery |
| GET | `/v1/routes?cityCode=&routeNo=` | Every official route ID for a route number |
| GET | `/v1/stops?routeId=&cityCode=` | Ordered, direction-specific stop topology |
| GET | `/v1/vehicles?routeId=&cityCode=` | Normalized live vehicle snapshot |
| POST | `/v1/matches` | Rank caller-supplied candidates; no upstream call |
| POST | `/v1/sessions` | Create a ride session |
| GET | `/v1/sessions/:id` | Refresh a ride session |
| POST | `/v1/sessions/:id/confirm` | Confirm a vehicle explicitly |

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
  `meta.providerObservationTimestamp` is `"unavailable"` and
  `meta.automaticMatching` is `"withheld_pending_source_freshness_rule"`.
  Receipt time is never presented as freshness.
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
| `PROVIDER_RESPONSE_INVALID` | 502 | TAGO answered with an unusable payload |
| `BLOCKED_BY_CREDENTIALS` | 503 | No TAGO service key is configured |
| `SESSIONS_UNAVAILABLE` | 503 | Ride sessions are disabled on this deployment |
| `INTERNAL_ERROR` | 500 | Unexpected failure; the message is always `internal error` |

An unmapped failure never echoes its thrown message to the caller. It is logged
server-side and answered generically.

## Configuration

All values are server-side environment variables. None is ever returned, logged,
or placed in a URL a client can see.

| Name | Required | Default | Purpose |
|---|---|---|---|
| `TAGO_SERVICE_KEY` | yes, for live data | — | Public Data Portal **Decoding** key. The canonical name, and the only one production reads. Without it every TAGO-backed endpoint answers `503 BLOCKED_BY_CREDENTIALS`. Store it on Vercel as a **Sensitive** variable. |
| `PUBLIC_DATA_SERVICE_KEY` | no — deprecated | — | The retired name. Honoured **only** when `VERCEL` is unset, so an existing local `.env.local` keeps working. Ignored outright on any Vercel deployment. |
| `TRANSIT_STOP_TTL_MS` | no | `21600000` (6 h) | Route-stop cache window |
| `TRANSIT_VEHICLE_TTL_MS` | no | `20000` | Vehicle snapshot cache window |
| `TRANSIT_DISCOVERY_TTL_MS` | no | `21600000` (6 h) | City and route-number discovery cache window |
| `TRANSIT_RATE_LIMIT_PER_MINUTE` | no | `120` | Per-caller burst limit; `0` disables |
| `TRANSIT_ALLOWED_ORIGINS` | no | empty | Comma-separated absolute origins allowed by CORS |
| `TRANSIT_SESSIONS_ENABLED` | no | `false` on Vercel, `true` locally | Opt a single-instance deployment back into ride sessions |

`VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`, and `VERCEL_GIT_COMMIT_SHA` are supplied
by the platform and are read for the health payload only.

The key must never appear in the repository, in a `VITE_*` variable, in the
browser bundle, in the iOS binary, in a client request, in a log line, in an
error message, in a committed fixture, or in a documentation example. Set it in
the Vercel project's environment variables for **Production** and, only when
someone needs to exercise preview deployments against live data, for
**Preview**. Preview deployments do not inherit a production credential by
default and should not be given one casually: preview URLs are shared more
widely than production ones.

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
  that cannot be overridden by environment variables, refuses redirects, times
  out at 8 s, bounds pagination, validates `resultCode`, and normalizes provider
  errors to a numeric code. There is no caller-controlled URL anywhere in the
  path, so no SSRF surface is introduced.
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
use the same primitive with a six-hour window.

## Sessions and the serverless persistence risk

| Question | Answer |
|---|---|
| What is the session store? | An in-process `Map` inside `JourneySessionCoordinator`. |
| Is it safe on serverless? | **No.** Vercel Functions scale horizontally and recycle instances. A session created on one instance is absent from the next, so `GET /v1/sessions/:id` would return `404` unpredictably. |
| What is done about it in this phase? | The endpoints fail closed. `TRANSIT_SESSIONS_ENABLED` defaults to `false` whenever `VERCEL` is set, and the three session routes answer `503 SESSIONS_UNAVAILABLE` with the reason. `/health` reports `sessions.store` and `sessions.enabled` honestly. |
| Is a durable database needed now? | **No.** The only thing a durable store would unlock is automatic passenger tracking, which is already withheld by the freshness gate until Tasks B and C complete. Adding Redis or Postgres now would be infrastructure for a policy-disabled feature. |
| Is stateless enough until then? | **Yes.** Task B is a local controlled ride capture that drives `TagoTransitProvider` directly and never calls the session API. The four read endpoints it depends on are stateless. |

When Task C defines a freshness rule and sessions become a real passenger
feature, the session store is the one component that must be replaced first.

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
  --typeRoots apps/web/node_modules/@types      # run from apps/web
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

**A Vercel deployment carries the environment variables that existed when it was
created.** The credential was added after the `b59e9e6` production deployment
(2026-09-12T07:57:01Z), so that build may still answer
`503 BLOCKED_BY_CREDENTIALS`. `/health` settles it: `liveTransitConfigured` and
`credential.source` describe the running build, not the project settings. If it
reports `false` / `missing`, redeploy production — dashboard **Redeploy** on the
latest production deployment, or `vercel redeploy <deployment-url> --target=production`
— and check again. No code change is involved.

The first production deployment ran on the merge of pull request #25 and
succeeded. Remaining first-time setup:

1. Settings → Environment Variables: add **`TAGO_SERVICE_KEY`** (Decoding key)
   for Production, with **Sensitive** visibility. Add it for Preview only if
   preview deployments must reach live data. Until it is set, every TAGO-backed
   endpoint answers `503 BLOCKED_BY_CREDENTIALS` and `/health` reports
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
3. Confirm `/health` reports `liveTransitConfigured: true` and
   `credential.source: "canonical"`. If not, redeploy production (see above) —
   the running build predates the variable.
4. Run the smoke script against `https://tapso-api.vercel.app`.

There is no separate deploy command. Pushing a branch produces a preview and
merging to `main` is the production deploy.

### Smoke test

```bash
node --experimental-strip-types services/api/scripts/smoke.ts https://<base-url>
# optional: --city 39 --route-no 365 --route-id JEB405136521
```

The script checks response semantics, not status codes alone: that `/health`
carries no credential field, that `cityCode` 39 is present, that route variants
are not collapsed, that stop sequences are strictly increasing, that every
vehicle keeps the epoch sentinel and `timestampSource: "unavailable"`, and that
invalid, missing, legacy, unknown-path, and wrong-method requests are rejected.
A deployment without a credential is reported as `BLOCKED_BY_CREDENTIALS`, never
converted into a pass. It exits non-zero only on a real failure.

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

## Limitations

- `VERIFIED`: the `tapso-api` project builds and deploys this repository from
  Root Directory `services/api`. Preview deployments and the first **production**
  deployment (merge commit `05f40a4`) all completed successfully, which proves
  the functions compile and bundle, the `.ts` import specifiers resolve, and
  `vercel.json` is accepted.
- `UNVERIFIED`: **no HTTP response from any deployment has been observed from an
  agent session.** Every agent session so far ran behind an egress policy that
  denies `*.vercel.app`, with a Vercel authorization that cannot read this
  project, so the rewrites, the response headers, and the deployed runtime
  behaviour have never been exercised over the network by the authoring session.
  A successful build is not a working endpoint. The repository owner reports
  `GET https://tapso-api.vercel.app/health` returning HTTP 200; that is an
  operator observation, recorded as such and not independently reproduced here.
  Run the smoke script before treating the rest as verified.
- `UNVERIFIED`: live TAGO behaviour through production. No credentialed
  `/v1/cities`, `/v1/routes`, `/v1/stops`, or `/v1/vehicles` response from
  `https://tapso-api.vercel.app` has been observed.
- `IMPLEMENTED`: the Vercel Functions adapter, the rewrites, and the header and
  cache policy are covered by deterministic tests and by an end-to-end run of
  the same handler over real HTTP through the local Node adapter.
- `VERIFIED`: local end-to-end behaviour, including the credentialed,
  uncredentialed, and serverless-shaped configurations.
- Rate limiting is per warm instance, not global.
- Ride sessions are disabled in serverless and will stay that way until a
  durable store exists.
- Automatic vehicle matching is withheld; see `docs/DATA_VALIDATION.md`.

## Task B prerequisite

Task B is a controlled real Route 365 ride capture. It does not depend on this
deployment: `scripts/ride-capture/capture.ts` constructs `TagoTransitProvider`
directly and needs only the local key. The production API matters to Task D,
when iOS connects. See `docs/HANDOFF.md` for the exact Task B commands.

# Production live transit backend (Task A / Phase 2)

## 1. Outcome and non-goals

**Outcome.** The live transit API stops being a localhost scaffold and becomes a
deployable production service with one shared request handler, a documented base
URL contract, server-only credentials, bounded upstream usage, and a reproducible
smoke procedure — without weakening any fail-closed rule.

**Non-goals.** Riding a real bus, fixing the TAGO freshness rule, enabling
automatic passenger matching, relaxing the 30-boarding acceptance gate, wiring
iOS to the API, APNs rollout, Apple Developer enrolment, TestFlight, Toss
activation, Supabase/Resend setup, framework migration, unrelated refactoring.

## 2. Verified constraints and assumptions

- `VERIFIED` (2026-09-12): `main` is `8e07285`. Pull requests #20, #21, #22,
  #23, and #24 are all merged. TAGO is the only runtime provider; the B551982
  adapter is gone from `services/api/src`.
- `VERIFIED`: a Vercel project named `tapso` exists in the `club-paradiso` team.
  Creating a project with that name returned HTTP 409 `conflict`, and pull
  request #24 carries a successful `Vercel` commit status pointing at
  `vercel.com/club-paradiso/tapso/…`.
- `VERIFIED`: this session's Vercel authorization is scoped to a single project
  (`visable`). `list_projects` returns only that project and `get_project` for
  anything else returns 404, so the existing `tapso` project's settings,
  environment variables, domains, functions, and logs could not be read.
- `VERIFIED`: the session's network egress allowlist permits `api.github.com`
  only. `tapso-nu.vercel.app`, `vercel.com`, and `apis.data.go.kr` each returned
  a proxy-level 403 to `CONNECT`. No authenticated TAGO call and no HTTP probe of
  any deployment were possible from this session.
- `VERIFIED` (`docs/exec-plans/WAITLIST_SUPPORT_2026_08_26.md`): the marketing
  Vercel project's Root Directory is `apps/web`, framework `vite`, output `dist`,
  with Vercel Functions in `apps/web/api` using the Web Handler signature.
- `VERIFIED` (Vercel documentation): `vercel.json` supports `ignoreCommand`
  (`git diff --quiet HEAD^ HEAD ./`), and `rewrites` may map a parameterized
  source onto a function destination.
- `VERIFIED`: `services/api` had no typecheck of any kind.
  `MockTransitProvider` used constructor parameter properties, which Node's
  `--experimental-strip-types` refuses to load, so the class could never have
  been imported.
- `ASSUMPTION`: the transit API's production alias will be whatever Vercel
  assigns the API project. It is deliberately not written into iOS in this task.

## 3. Milestones and observable completion criteria

1. **Shared handler.** `src/apiRouter.ts` answers every endpoint over Web
   `Request`/`Response`; `src/server.ts` is transport only; the pre-existing
   `tagoServer.test.ts` still passes unchanged over real HTTP. DONE.
2. **Serverless transport.** `services/api/api/**` exposes each endpoint as a
   Vercel Function and `services/api/vercel.json` supplies the rewrites, output
   directory, bundling, headers, and ignore command. DONE.
3. **Hardening.** Identifier validation before any upstream call, JSON-only
   bodies, 64 KiB cap, per-caller burst limit, deny-by-default CORS, generic
   500s, structured logs without secrets. DONE.
4. **Caching.** Discovery reads cached with the same read-through primitive as
   stops and vehicles; successful reads carry a CDN `s-maxage` equal to the
   in-process TTL; failures never cached. DONE.
5. **Session risk.** Memory-only sessions disabled by default on serverless and
   answered with `503 SESSIONS_UNAVAILABLE`; `/health` states the policy. DONE.
6. **Verification.** 56 Node tests in `services/api`, 93 in `apps/web`, 3 Python
   probe tests, a clean typecheck of the deployed surface now wired into CI, and
   an end-to-end HTTP run of all three configurations. DONE.
7. **Deployment.** PARTIAL. The `tapso-api` project is linked to
   `club-paradiso/tapso`, its Root Directory resolves to `services/api`, and a
   preview deployment of this branch reached *Deployment has completed*. The
   marketing project deployed successfully from the same commit, so the public
   site is unaffected. Not done: `PUBLIC_DATA_SERVICE_KEY` is unset, no
   production deployment exists, and **no HTTP response from any deployment has
   been observed** — the session's egress policy denied every `*.vercel.app`
   host and its Vercel authorization could not read this project.

## 4. Decisions and alternatives considered

- **Chosen: a dedicated Vercel project rooted at `services/api`.** Everything
  the functions import already lives under that root, so the build does not
  depend on a Vercel project setting this repository cannot assert. It separates
  the API's credential, blast radius, deploy cadence, and client base URL from
  the public product site.
  *Rejected:* serving the transit endpoints from the marketing project's
  `apps/web/api`. It would force either cross-root imports or relocating the
  transit domain into the marketing app, and it would put the TAGO credential,
  the function budget, and the rollback history of a public API inside the
  product site's project.
  *Rejected:* a non-Vercel host. Nothing in the requirements needs one, and
  adding a provider would add a release process, a secret store, and an
  observability stack for four cached reads.
- **Chosen: rewrites onto plain function files.** `services/api/vercel.json`
  maps `/health` and `/v1/...` onto non-dynamic files, and the router accepts the
  identifier from the path or the query. Local and production paths are then
  identical without depending on a dynamic-filename convention.
- **Chosen: memory sessions disabled on serverless rather than a durable store.**
  The only feature a store would unlock is automatic tracking, which the
  freshness gate already withholds. Adding Redis or Postgres now would be
  infrastructure for a policy-disabled feature.
  *Rejected:* shipping in-memory sessions to a horizontally scaled runtime and
  hoping instances stay warm.
- **Chosen: CDN `s-maxage` equal to the in-process TTL, with no
  `stale-while-revalidate`.** It is the only layer shared across warm instances,
  and a stale window on vehicle data is precisely the failure this product must
  not have.
- **Chosen: no new runtime dependency.** The typecheck borrows the one
  TypeScript install already in the repository so `npm --prefix services/api
  test` still runs with no install step.

## 5. Reproduction and evidence

```bash
npm --prefix services/api test                     # 56 pass
npm --prefix apps/web ci && npm --prefix apps/web test   # 93 pass
npm --prefix apps/web run typecheck:vercel          # clean
npm --prefix apps/web run build                     # clean
python3 -m unittest discover -s scripts/tago -p 'test_*.py'   # 3 pass
cd apps/web && npx tsc --project ../../services/api/tsconfig.json \
  --typeRoots node_modules/@types                   # clean
swift test --package-path packages/transit-core     # CI only; no Swift toolchain on this host
```

End-to-end HTTP evidence, all three configurations, against the real Node
adapter with a synthetic TAGO upstream (six 365 variants, 43 stops, five
vehicles):

| Configuration | Result |
|---|---|
| credential present, sessions enabled | 13/13 smoke checks pass, session create `201` |
| `VERCEL=1`, credential present | 13/13 pass, sessions `503 SESSIONS_UNAVAILABLE`, health reports region, build commit, and `sessions.enabled: false` |
| no credential | 9 pass, 4 reported `BLOCKED_BY_CREDENTIALS`, 0 failures |

Fail-closed behaviour observed directly: a candidate matching route and boarding
stop exactly still scores `rejectedReasons: ["stale_or_invalid_timestamp"]` and
the match result is `unavailable` / `unknown`.

## 6. Progress, findings, risks, next action

**Findings.**

- The Vercel project `tapso-api` (`prj_XTimnEWdrhaDMSJfgELHzQAo3Nn2`) was
  created in the `club-paradiso` team. The creating call could not read it back
  afterwards, and neither could any later call, because this session's Vercel
  authorization is a fixed single-project allowlist — not because the project
  was broken. Its GitHub checks later proved it linked and building. Do not
  create a second project with that name.
- The first `ignoreCommand` inspected only `HEAD^..HEAD`, so this branch's
  preview was cancelled: the API change sat under a later docs commit. It now
  skips on `main` only, which is what let the preview build at all.
- `scripts/transit-spike/resolve-route.ts` still imports
  `services/api/src/publicDataProvider.ts`, which the TAGO migration removed. The
  script cannot load. It is left in place and recorded in
  `docs/KNOWN_ISSUES.md` rather than deleted as part of unrelated cleanup.
- `services/api/test` does not satisfy `noUncheckedIndexedAccess` and is
  excluded from the new typecheck.

**Risks.**

- The deployment built, but nothing has ever called it. Runtime behaviour,
  the rewrites, and the response headers are unobserved in production. The
  smoke script must run against the preview before anything is called verified.
- If a rewrite misbehaves, the `/api/...` function paths still work and the
  router accepts both forms, so the fallback is a base-URL change rather than a
  code change.
- `PUBLIC_DATA_SERVICE_KEY` is unset on the project, so the deployment
  currently answers `503 BLOCKED_BY_CREDENTIALS` on every TAGO-backed endpoint.
  That is the designed unconfigured state and is what the smoke script will
  report until the key is added.

**Next action.** Smoke the branch preview — expect `BLOCKED_BY_CREDENTIALS` on
the four TAGO reads and passes everywhere else:

```bash
node --experimental-strip-types services/api/scripts/smoke.ts \
  https://tapso-api-git-claude-tapso-production-tran-b6b5e5-club-paradiso.vercel.app
```

That is the branch alias, stable across pushes to this branch; the per-commit
URL is in the pull request's `Vercel – tapso-api` check. Then set
`PUBLIC_DATA_SERVICE_KEY` on the project, merge, smoke the production alias, and
record it in the base URL table in `../PRODUCTION_TRANSIT_API.md`.

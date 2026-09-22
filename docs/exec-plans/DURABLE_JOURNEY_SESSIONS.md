# Durable journey sessions

## User-visible outcome

A rider's journey session survives the process that created it. Today
`TRANSIT_SESSIONS_ENABLED` defaults to `false` on Vercel and the three session
routes answer `503 SESSIONS_UNAVAILABLE`, because sessions live in one
process's memory and a serverless deployment has many processes. After this
work, a deployment configured with a durable store can enable sessions without
losing a ride to a cold start or a scale-out.

## Non-goals

- **Automatic matching stays OFF.** `TRANSIT_AUTOMATIC_MATCHING_ENABLED`
  remains `false` by default and this plan does not touch the field-validation
  gate. Durable storage was never what withheld it.
- No change to the cadence policy, the freshness posture, or any source-time
  semantics. `observedAt` stays the epoch sentinel for TAGO.
- No shared fleet-polling collector. Sessions still read TAGO per session; the
  quota cost recorded in `KNOWN_ISSUES.md` is unchanged by this plan and needs
  its own task.
- No session history, analytics, or cross-device resume.
- `BackgroundRideCaptureCoordinator` keeps its in-memory map. It runs as one
  long-lived Railway process, where memory is the correct store.

## Verified constraints and assumptions

| Constraint | Label | Evidence |
|---|---|---|
| Sessions are a single in-process `Map<string, SessionRecord>` | `VERIFIED_FROM_SOURCE` | `services/api/src/journeySession.ts:173` |
| The coordinator has a narrow consumer surface | `VERIFIED_FROM_SOURCE` | 3 call sites in `apiRouter.ts` (create/refresh/confirm), 1 construction in `apiRuntime.ts` |
| No KV, Redis or database is provisioned anywhere in the repo | `VERIFIED_FROM_SOURCE` | zero hits for `UPSTASH`, `KV_REST`, `REDIS_URL`, `DATABASE_URL`, `VERCEL_KV` |
| `services/api` ships exactly one runtime dependency (`web-push`) | `VERIFIED_FROM_SOURCE` | `services/api/package.json` |
| A second hosting provider, database or queue was rejected once before | `VERIFIED_FROM_DOC` | `docs/DECISIONS.md`: "Four cached reads justify none of them" |
| Upstash Redis REST accepts a command array over HTTPS with a bearer token | `ASSUMED_FROM_VENDOR_DOCS` | must be confirmed against a real credential before this is called done |

The last row is the one that cannot be closed from the repository. Everything
else in this plan is testable without an account.

## The actual hard problem: concurrency, not storage

`JourneySessionCoordinator` mutates a `SessionRecord` in place and relies on
that object being the only copy. Port it to a key-value store with a naive
`get`/`set` and the storage problem is solved while a safety invariant breaks:

1. Two `GET /v1/sessions/{id}` requests land on two instances.
2. Both load the record at `currentStopSequence: 4`.
3. Instance A resolves stop 5, writes.
4. Instance B — still holding the stale copy — resolves stop 4, writes.
5. The rider's progress has gone backward, silently.

`journeySession.ts` rejects backward movement explicitly
("Backward stop movement was ignored"), and the whole Task C PR is built on
that guarantee. A lost update reintroduces exactly the failure the code refuses
to make locally. The same race clobbers `cadenceHistory` and
`consecutiveProviderFailures`, which would let a failure counter reset itself
and an absent provider look healthy.

So the store contract is **compare-and-set, not put**. Every load returns a
version; every save states the version it read. A mismatch means another writer
won, and the loser fails closed by returning the stored state rather than
overwriting it.

### Alternatives considered

- **Per-session distributed lock** (`SET key NX PX`). Also dedupes the
  duplicate TAGO poll, which CAS does not. Rejected for now: a lock adds a
  failure mode (holder dies, ride blocks until expiry) that CAS does not have,
  and the quota concern belongs to the shared-collector task. Revisit there.
- **Single-writer via the Railway collector.** Correct long-term shape, far
  larger change, and it couples the Vercel API to a second service's
  availability. Out of scope.
- **Last-write-wins.** Rejected: it is the bug described above.

## Decisions

**Decision: compare-and-set with an explicit version, fail closed on conflict.**
The store returns `{ session, version }`; `save` takes the expected version and
reports whether it won. On a lost CAS the coordinator does not retry blindly —
a retry would re-run a TAGO read and re-derive progress from a snapshot the
winner already consumed. It returns the winner's stored state, which is by
construction at least as advanced as what this instance computed.

**Decision: a dependency-free Upstash REST client.**
Upstash's REST API is an HTTPS POST carrying a JSON command array and a bearer
token. A client is roughly sixty lines of `fetch`, is stubbed in tests without
a network, and adds no supply-chain surface to a service that deliberately
carries one dependency. `@upstash/redis` would add a package to do what
`fetch` already does here.

*Rejected:* `@vercel/kv` — same Upstash underneath, plus Vercel coupling in a
service `DECISIONS.md` deliberately keeps portable.
*Rejected:* `ioredis`/`node-redis` — TCP pooling is the wrong shape for
serverless invocations.

**Decision: the store is selected by config and fails closed.**
`TRANSIT_SESSION_STORE` chooses `memory` (default) or `redis`. Choosing `redis`
without usable credentials is a misconfiguration that throws at wiring time,
matching how `apiConfig.ts` already treats an unparseable flag. Sessions on
serverless stay off unless both a store and the existing flag say otherwise.

**Decision: credentials never reach `/health`.**
`sessionStore` reports a category (`memory` / `redis`) and configured-ness,
never a URL or token — the same rule `credential` already follows for the TAGO
key.

## Milestones

1. `DONE` `sessionStore.ts`: the `JourneySessionStore` interface, a
   serializable `StoredJourneySession`, the version/CAS contract, and
   `MemoryJourneySessionStore`. Observable: round-trip tests prove
   `cadenceHistory` (a `Map`) and every optional field survive
   serialization unchanged.
2. `DONE` `journeySession.ts` refactor: load → mutate → CAS-save, with a
   lost CAS returning stored state. Observable: existing 185 API tests still
   pass, plus a test that drives two coordinators against one store and proves
   progress never moves backward.
3. `DONE` `upstashSessionStore.ts`: dependency-free REST client and the
   Redis-backed store, with TTL delegated to Redis `PX` and CAS done in one
   round trip. Observable: tests drive it through a stub `fetch` covering
   success, CAS loss, expiry, malformed payload, and transport failure.
4. `DONE` Config and wiring: `TRANSIT_SESSION_STORE`,
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, health reporting.
   Observable: a test asserts no credential substring appears in `/health`.
5. `DONE` Docs: `ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`,
   and this plan updated with results.
6. `BLOCKED` Live verification against a real Upstash database. Cannot be
   completed from the repository; needs a credential. Until it is done, the
   Upstash client is `UNVERIFIED_AGAINST_LIVE_SERVICE` and this plan must say
   so.

## Reproduction commands

```bash
npm --prefix services/api test
python3 -m unittest discover -s scripts/tago -p 'test_*.py'
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
npm --prefix apps/web run build
swift test --package-path packages/transit-core
```

## Evidence

`npm --prefix services/api test`: **219 passed, 0 failed**, up from 185 on the
branch this is based on. The 185 existing tests pass unmodified, which is the
evidence that the coordinator refactor preserved Task C's behaviour rather than
quietly renegotiating it.

New coverage:

| Claim | Test |
|---|---|
| Every field, including the `cadenceHistory` map, survives a store round trip | `sessionStore.test.ts` |
| A loaded session is a copy, so the memory store cannot be mutated without a save | `sessionStore.test.ts` |
| A create never overwrites an existing session | both stores |
| A stale save loses and returns the winner's row | both stores |
| An expired row is returned, not hidden, so `410` stays distinct from `404` | `sessionStore.test.ts` |
| Upstash `create` uses `SET NX` with a TTL past the expiry boundary | `sessionStore.test.ts` |
| The bearer token travels in the header, never the URL | `sessionStore.test.ts` |
| A store outage throws rather than reading as an absent session | store and coordinator level |
| No error message carries the credentialed host | `sessionStore.test.ts` |
| A row with a bad version prefix, bad JSON, or a foreign shape is refused | `sessionStore.test.ts` |
| A session outlives the coordinator that created it | `journeySession.test.ts` |
| **A concurrent writer cannot move a rider backward along the route** | `journeySession.test.ts` |
| Store credentials never reach config or `/health` | `apiConfig.test.ts`, `apiRouter.test.ts` |
| `redis` without credentials throws instead of falling back to memory | `apiConfig.test.ts` |
| A stray Upstash variable does not silently switch the store | `apiConfig.test.ts` |
| A plaintext store URL is refused | `apiConfig.test.ts` |

### The concurrency test was verified to fail without the mechanism

A test that passes whether or not the feature exists proves nothing. The
compare-and-set branch in `MemoryJourneySessionStore.save` was temporarily
removed and the suite re-run:

```
not ok 1 - a concurrent writer cannot move a rider backward along the route
  expected: 4
  actual: 3
```

The rider's stop sequence went from 4 back to 3 — the exact failure this design
exists to prevent. The branch was restored and all 219 tests pass.

## Progress, findings, risks

- Branch: `feat/durable-journey-sessions`, based on `4cb645f`, the head of the
  Task C branch. Stacked deliberately: this work refactors the coordinator that
  PR #44 introduces, so it cannot be based on `main`.
- Risk: the coordinator refactor touches every method that mutates a session.
  A silent behaviour change there would weaken Task C's guarantees without
  failing a test. Mitigation: the existing suite must pass unmodified except
  where the store contract genuinely changes a signature.
- Risk: milestone 6 cannot be closed here. Nothing in this plan may be reported
  as production-ready until a live Upstash round trip is recorded.

## Exact next action

Milestone 6, and it cannot be done from the repository. Someone with an Upstash
account must:

1. Create a Redis database and copy its REST URL and token.
2. Set `TRANSIT_SESSION_STORE=redis`, `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` on a **preview** deployment, never production.
3. Create a session, refresh it, and confirm a vehicle; then confirm the row
   exists under `tapso:journey-session:<id>` with a `<version>:<json>` value
   and a TTL, and that a second refresh increments the version prefix.
4. Record the result here and drop the `UNVERIFIED_AGAINST_LIVE_SERVICE` label
   from `upstashSessionStore.ts` and `KNOWN_ISSUES.md`.

Until that is recorded, `TRANSIT_SESSION_STORE=redis` must not be set in
production. The Lua compare-and-set in particular is the piece most likely to
behave differently against a real server than against a stub.

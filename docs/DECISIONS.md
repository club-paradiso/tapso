# Architecture decisions

## Native SwiftUI client

**Decision:** SwiftUI + ActivityKit + WidgetKit. Dynamic Island is central and a wrapper framework adds no value.

## iOS 17 minimum

**Decision:** target iOS 17. ActivityKit began on iOS 16.1, but iOS 17 provides a stable modern baseline for the chosen SwiftUI APIs and avoids maintaining a short-lived iOS 16 compatibility branch. No beta-only iOS 26 API is required.

## Framework-independent Swift core

**Decision:** keep matching, route progress, freshness, and transitions in a Swift package with Foundation only. Views and ActivityKit are adapters.

## XcodeGen plus checked-in project

**Decision:** `project.yml` is the maintainable source and the generated `.xcodeproj` is retained so the repository opens immediately. Regenerate after target/resource changes.

## TypeScript service without a framework

**Decision:** Node's HTTP and test modules are enough for the first provider boundary. Choose hosting, persistence, queueing, and a web framework only after measuring the credentialed API and pilot load.

## Transit API on its own Vercel project

**Decision:** the transit API deploys from a Vercel project rooted at
`services/api`, separate from the marketing site's project rooted at `apps/web`.

This is the revisit the entry below reserved for the moment the iOS client needs
these endpoints. Everything the functions import already lives under
`services/api`, so the build depends on no cross-root project setting. The TAGO
credential, the function budget, the rollback history, and the deploy cadence of
a public API stay out of the product site's project, and iOS gets a base URL
that is not the marketing domain.

**Decision:** journey sessions persist to Upstash Redis over its REST API, through a hand-written `fetch` client rather than a package.

The entry below rejected "a second hosting provider, a database, or a queue" when four cached reads justified none of them. What justifies one now is narrower: a ride session is per-rider mutable state that must outlive one serverless invocation, which no amount of caching provides. The scope stays small — one key per session, a TTL Redis enforces itself, and no schema to migrate.

The client is roughly sixty lines of `fetch` because Upstash's REST endpoint is an HTTPS POST carrying a JSON command array and a bearer token. `services/api` carries one runtime dependency on purpose; adding a package to build a request body `fetch` already builds would spend supply-chain surface on nothing, and the stub-`fetch` tests are the same either way.

Saves are compare-and-set, executed as a Lua script in one round trip. A plain `SET` would let two instances lose each other's updates and walk a rider backward along the route, which is the failure the coordinator refuses to make locally.

*Rejected:* `@vercel/kv` — the same Upstash underneath, plus Vercel coupling in a service this file deliberately keeps portable.
*Rejected:* `ioredis`/`node-redis` — TCP connection pooling is the wrong shape for serverless invocations.
*Rejected:* a per-session distributed lock. It would also dedupe the duplicate upstream poll, which compare-and-set does not, but it adds a failure mode compare-and-set lacks: a holder that dies blocks the ride until its lease expires. Revisit it with the shared fleet collector, where the duplicate poll is the actual problem being solved.
*Rejected:* last-write-wins. It is the bug.

*Rejected:* co-locating the transit endpoints in `apps/web/api`. It would force
either cross-root imports or moving the transit domain into the marketing app.
*Rejected:* a second hosting provider, a database, or a queue. Four cached reads
justify none of them, and the feature that would need a durable store is
withheld by the freshness gate.

**Decision:** one request handler, two transports. `src/apiRouter.ts` answers
every endpoint over Web `Request`/`Response`; `src/server.ts` and
`services/api/api/**` are transport adapters only. Local and production
behaviour cannot drift because there is only one implementation of it.

## No passenger GPS by default

**Decision:** identify the bus from vehicle observations and ride intent. Optional one-shot location may become supporting evidence, never a hidden continuous tracker.

## Marketing-site backend as co-located Vercel Functions

**Decision:** the waitlist and support endpoints live in `apps/web/api` and
deploy with the marketing site.

`services/api` binds to `127.0.0.1`, declares no dependencies, and has no host,
Dockerfile, or deployment pipeline. Deploying it to serve one public form would
have meant choosing a host, a runtime, a release process, and a CORS boundary
for a feature the existing Vercel project can already serve. Revisit this if the
iOS client ever needs the same endpoints; until then, one deployment is the
smaller system.

That revisit happened once the iOS client needed the transit endpoints; see
*Transit API on its own Vercel project* above. The waitlist and support
endpoints stay where they are.

The handlers use the Web Handler signature (`export async function POST(request:
Request)`), which gives exact raw-body access for webhook verification and lets
every endpoint be unit-tested with a plain `Request`.

## No SDKs at the marketing-site provider boundaries

**Decision:** reach Supabase through PostgREST and Resend through its REST API
with `fetch`.

Four HTTP calls do not justify two SDKs and their transitive trees, and
injecting `fetch` makes each boundary testable without a network. This matches
`services/api`, which also ships zero dependencies.

## Toss Payments for KRW support

**Decision:** implement support payment behind a `SupportPaymentProvider`
interface with a Toss Payments adapter, and keep it disabled until a merchant
account exists.

Toss covers the Korean payment methods TAPSO's riders actually use; Stripe does
not. Toss sends no signature on `PAYMENT_STATUS_CHANGED`, so the webhook handler
treats the request body as a notification and re-reads the payment from the Toss
API before recording anything. The amount is whatever the server stored when the
intent was created; a value supplied by the browser is only ever compared.

## Directed route progress replaces symmetric stop distance (2026-09-29)

**Decision:** the backend matcher is `directed-route-progress-v1`
(`services/api/src/matching.ts`). A waiting rider's bus is selected only from
one to four stops *before* the boarding stop; a bus at the stop or one past it
blocks every selection; a departed bus is never selected.

Passive Shadow v3 showed the symmetric term `20 − 5·|seq − S|` committing to
buses that had already left the rider's stop in 268 blind live cases. Tuning
its thresholds could not fix a term that cannot tell the two directions apart.
The blocking zone is convention-agnostic because TAGO's `nodeord` semantics are
unverified: under every reading, a bus reporting S or S + 1 may be dwelling at
the stop, and one reporting S may have left. Measuring the convention could
only ever relax coverage, never safety, so the rule does not depend on it. The
old policy is kept verbatim in `matchingLegacy.ts` for comparison; nothing that
serves a rider may import it.

## Session memory instead of commit-on-crossing (2026-09-29)

**Decision:** once any bus has been seen at, or crossing, the boarding stop
during a waiting session — or lost from view while it could have reached it —
no bus is automatically selected for the rest of that session
(`PassageMemory`, finding F4).

Found by the old-versus-new migration on synthetic data: the rider's own bus
reached the stop before its cadence was fresh, so it was (correctly) never
selected, and the bus behind it then became the "leading approaching vehicle".
Committing to whichever bus crosses the stop was rejected: it selects a
departed vehicle with no independent evidence that the rider boarded it.

## Rider state is the rider's declaration (2026-09-29)

**Decision:** `riderState` (`waiting_at_stop` by default, or `on_board`) is
input from the rider, with a separate rule for each; replays take it from the
capture's start declaration (a `boarded` marker at the first snapshot), never
from which vehicle the rider was on.

The default is the rule whose mistake is harmless: a rider who is really
aboard gets a confirmation prompt, while treating a waiting rider as aboard
would admit departed buses.

## A readiness gate replaces the thirty-ride count (2026-09-29)

**Decision:** automatic matching is governed by release gate
`matcher-passive-safety-v4` (`services/api/src/matcherSafetyGate.ts`), which
awards one of five readiness levels from machine-produced evidence. The
configuration refuses `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true` below
`READY_FOR_BOUNDED_AUTOMATION`, and CI fails if the readiness the code claims
differs from the one the committed gate result awards.

The legacy campaigns (`broad-real-mode-30-boardings-v1`,
`beta-matcher-30-boardings-v2`) stay as historical definitions with their real
count of zero. Their risks are decomposed in
`docs/validation/EVIDENCE_SUBSTITUTION_MATRIX.md`. Minimum sample sizes rest on
the rule of three at the vehicle-trajectory level, with product tolerances
stated as choices (5 % for a suggestion the rider confirms, 1 % for an
unconfirmed commit), and were not fitted to existing evidence.

## Confirmation-assisted, not automatic, is the product target (2026-09-29)

**Decision:** the strongest level TAPSO aims for without new human evidence is
`READY_FOR_CONFIRMATION_ASSISTED`: the matcher may suggest, the rider's tap
commits.

Two facts no passive evidence can establish — how far the provider lags the
physical stop, and whether riders board the first bus to arrive — both matter
only if the product commits without the rider. Designing them out of the
safety path is sound; asking people to ride buses to measure them is not
necessary for the shipped behaviour.

## One ride-guidance model for every surface (2026-09-30)

**Decision:** `RideGuidancePolicy` in the Swift core maps a `RideSignal` (phase, remaining stops, freshness, destination passed, offline) to one `RideGuidance`: moment, vehicle identity and data freshness as separate signals, milestone, haptic, colour role, symbol, recovery action, copy keys and relevance. The app, the Lock Screen and every Dynamic Island region read it; none decides on its own.

The V1 app and Live Activity each had their own switch over the phase, and they already disagreed: a passed destination was presented and alerted as an arrival (`product/UX_AUDIT_V2.md` P0-1). The policy keeps every V1 fail-closed rule and its tests, and adds `passedDestination`, `vehicleLost` and `offline` as distinct quiet moments. Journey state machine, session and progress semantics are unchanged; the matcher is not involved.

## Destination-first setup, rider-confirmed bus (2026-09-30)

**Decision:** setup asks where the rider gets off, then which bus (only when two directions reach the stop), then the boarding stop — never a trip origin. A bus is selected only by the rider's confirmation of a proposal, in the demo as in production, because automatic selection is withheld below `READY_FOR_BOUNDED_AUTOMATION`. Two or more proposals are always a question.

## Product V2 runs on synthetic data until the app has a server path (2026-09-30)

**Decision:** the app keeps making no network request. Search, proposals and rides come from `DemoCatalog` and `DemoRideScript`, labelled synthetic in code and on Home. `services/api/test/crossLanguageAuthority.test.ts` stays as it is; the Swift `VehicleMatchingEngine` still ranks only the sample ride's demo fixture.

## CI builds the iOS app and publishes snapshot evidence (2026-09-30)

**Decision:** a macOS `ios` job builds the committed project, runs the app and Live Activity tests, renders every Product V2 screen and ride surface in Korean and English, and checks XcodeGen membership parity. The committed `.xcodeproj` is kept in step by `scripts/ios/sync_xcodeproj.py` so it can be updated without a Mac. The job runs with `contents: read` and no persisted credentials; its only output is the artifact `ios-snapshot-evidence`. A branch-publishing job (`ci-evidence/<branch>`) was tried during Product V2 review and removed: it held a write token while installing an unpinned package from the network, and the artifact is the canonical evidence.

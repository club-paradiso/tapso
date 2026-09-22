# Task C — source freshness for a provider with no timestamps

## The problem this exists to solve

TAGO's realtime position feed (`getRouteAcctoBusLcList`) publishes no
observation timestamp in any field. Not a stale one, not a coarse one — none.
Every other part of TAPSO that wants to know "is this position current?" has
nothing to ask.

The tempting answer is to use `receivedAt`, the time TAPSO's own server
finished reading the snapshot. That answer is wrong and it is wrong in the
dangerous direction: `receivedAt` is always recent, because TAPSO just read it.
A rule built on it would call every response fresh, including a response TAGO
had been serving unchanged for ten minutes. Riders would be matched to buses
that are not where the app says they are.

So Task C does not produce a freshness rule in the sense of "this position is
N seconds old". No such rule is derivable. It produces something narrower and
honest.

## What was built

### 1. A liveness surrogate, not a freshness measurement

`services/api/src/sourceFreshness.ts` — `server_observed_cadence_v1`.

It answers one question: did this server keep receiving snapshots, close
together, in which this vehicle's reported content actually changed and never
moved backwards?

| State | Meaning | Unlocks matching |
|---|---|---|
| `fresh` | continuous receipts **and** changed provider content in the window | yes |
| `aging` | continuous receipts, unchanged content | no |
| `stale` | broken receipt chain, late receipt, or backward stop sequence | no |
| `unknown` | insufficient bounded history | no |

Two rules carry most of the safety:

- **Changed content is required.** Recent receipts alone are never `fresh`.
  This is the whole point; loosening it to "recent receipts equal fresh"
  reintroduces exactly the failure the module exists to prevent.
- **Unchanged content is `aging`, not `stale`.** A bus at a red light reports
  the same row for minutes. Calling that a dead feed would be a different kind
  of wrong, and would make the surrogate useless in traffic.

Thresholds and their evidentiary basis are tabulated in
`docs/DATA_VALIDATION.md`. Every one is marked `PROVISIONAL`. None is a
provider timestamp threshold.

### 2. Source-time semantics, made hard to misread

- `observedAt` on a TAGO record is the epoch sentinel. It carries no
  information and is never replaced by a receipt time.
- `timestampSource` is `"unavailable"`.
- `receivedAt` is TAPSO server receipt time, documented as such on
  `VehicleObservation` and at the point of construction in `tagoProvider.ts`.
- Journey progress publishes `evidenceAt` together with
  `evidenceAtIs: "tapso_server_receipt"`, so the ordering instant announces
  what it is rather than sitting unlabelled next to `observedAt`.

A test asserts the exact key set of the published progress object, so a new
time-like field has to be named and reviewed rather than quietly appearing.

### 3. An automatic-matching rollout gate

Restoring the session wiring made automatic selection reachable again, which
made a second gate necessary. `TRANSIT_SESSIONS_ENABLED` decides whether the
ride endpoints answer at all. It must not also decide whether the server picks
a passenger's bus — those are different risks with different evidence
requirements.

- `TRANSIT_AUTOMATIC_MATCHING_ENABLED`, `false` by default on every platform.
- Shadow mode is what `false` means: rank candidates, compute and publish
  cadence evidence, report what would have been selected, select nothing.
- Explicit rider confirmation stays available and stays subject to the cadence
  gate. Confirming a bus does not make its data fresh.

### 4. Transient provider failure handling

Production has been returning 502 from `/operator/snapshot` when TAGO answers
without a `body` object. Task C reads the provider uncached and consecutively,
so it meets this more often, not less.

A failed read is treated as the absence of evidence, which is what it is:
cadence history, the selected vehicle and the last accepted progress are all
left untouched, and the session reports `degraded` with
`providerRead.state: "failed"`. Nothing is inferred, nothing is rematched,
progress cannot move backward, and no provider timestamp is invented.

After a bounded run of consecutive failures the error is returned to the caller
instead. A provider that is genuinely down must not read as a healthy session.
`create` and `confirm` propagate immediately, since neither has retained state
worth preserving and a confirmation must be answered against a snapshot that
actually arrived.

## What remains open

| Item | Status | Owner |
|---|---|---|
| 30 observed boardings across multiple routes | `OPEN`; zero observed | field validation |
| Candidate-margin calibration | `OPEN` | needs the boardings above |
| Marker-lag distribution | `OPEN` | needs a clean ride capture |
| Arrival/alighting accuracy | `OPEN` | needs a clean ride capture |
| Durable journey-session storage | `OPEN` | next architecture task, tracked separately |
| Cadence thresholds promoted from `PROVISIONAL` | `OPEN` | needs ride evidence that separates provider lag from collector lag |

The two physical rides captured so far used the local/browser recorder and are
`CONFOUNDED` by Safari background suspension. The 2026-09-22 Railway background
acceptance run fixed the collection mechanism — `20` snapshots, `103.06 s`
background, worst gap `7.94 s` against a `5 s` target — but a working collector
is not ride evidence. No clean ride capture exists yet.

## Explicitly out of scope

Durable session storage. It is a real gap and the reason sessions default off
on serverless, but it is not why automatic matching is withheld. Health
metadata previously said it was; that was corrected, and it must not regress.

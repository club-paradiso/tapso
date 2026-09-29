# Beta field testers

> **Status, 2026-09-29.** Historical ExecPlan for a legacy ride flow. Human
> rides, beta rides included, are no longer a release requirement: release gate
> `matcher-passive-safety-v4` decides matcher readiness from machine-produced
> evidence and reads no ride count, and no level up to
> `READY_FOR_CONFIRMATION_ASSISTED` needs a ride
> ([`../validation/MATCHER_SAFETY_EVIDENCE_V4.md`](../validation/MATCHER_SAFETY_EVIDENCE_V4.md),
> [`HUMAN_LABOR_ELIMINATION.md`](HUMAN_LABOR_ELIMINATION.md)). The beta flow
> remains in the Railway collector behind `BETA_TESTERS_ENABLED` and may keep
> running; a beta ride counts only toward the historical
> `beta-matcher-30-boardings-v2` campaign, which stays as defined, with zero
> observed boardings. The practice ride, restart check and review steps below
> are not release or validation requirements.

## Goal

A non-technical friend with a private link records a real bus ride in four
steps, and the ride becomes matcher field evidence without anyone moving files:

```text
open invite link → enter bus number + plate last 4 → pick boarding stop
  → [탑승 시작] → phone in pocket (Railway collects) → [하차 완료] → 기록 완료 ✓
```

After 하차 완료 the server alone completes the capture, keeps the raw, runs the
current `analyzeRideCapture` (matcher replay included), deduplicates, stores raw +
report + sanitized record in Upstash, and classifies the ride under the versioned
beta policy. There is no second submit button.

Page: `/ride-capture/beta.html` on the Vercel API origin (the same static
deployment as `background.html`). Invite links look like
`https://<vercel-api-origin>/ride-capture/beta.html#invite=tbi_…`.

## Non-goals / unchanged

- Automatic matching stays disabled (`TRANSIT_AUTOMATIC_MATCHING_ENABLED=false`).
- The v1 campaign (`broad-real-mode-30-boardings-v1`), `classifyReplayedRide`,
  its buckets and `evidenceCompleteness` are unchanged.
- No second capture engine and no second matcher. Beta rides use
  `BackgroundRideCaptureCoordinator`, `analyzeRideCapture`/`replayMatching` and
  `submitCompletedCapture` exactly as operator rides do.
- The operator page keeps every control (unlock, markers, raw/report export,
  explicit submit). It gains one collapsible "베타테스터 초대" panel.

## Feature flag: `BETA_TESTERS_ENABLED` (Railway collector only)

| `BETA_TESTERS_ENABLED` | Upstash configured | `/health.betaTesters` | Behaviour |
|---|---|---|---|
| absent, empty, `false`, `0`, or malformed | any | `disabled` | every `/beta/*` route (tester and operator) answers `503 BETA_DISABLED` before reading any credential or store; no journal, no recovery loop |
| `true` / `1` | no | `unconfigured` | every `/beta/*` route answers `503 BETA_UNCONFIGURED` |
| `true` / `1` | yes | `enabled` | beta routes live; beta rides are journaled; recovery runs at startup and every 15 s |

- Upstash alone never enables beta testing. A malformed value is `disabled`
  (with a startup warning), never a crash.
- The operator ride-capture flow is identical in all three states (tested).
- Even when disabled, the collector keeps a read-only beta-ownership lookup
  whenever Upstash is configured, so `POST /capture/:id/submit` still refuses a
  beta ride (`409 BETA_CAPTURE`) and v1 can never absorb one.
- The beta page shows "지금은 베타 테스트를 진행하지 않아요" on `BETA_DISABLED` /
  `BETA_UNCONFIGURED` and keeps the tester's credential. The operator panel
  shows the server's message naming the variable.
- Vercel needs nothing: the static page is harmless when the collector says no.
- `/health.betaRestartRecovery` is `durable_journal` when enabled, else
  `not_applicable`.

Enable: set `BETA_TESTERS_ENABLED=true` on the Railway collector service,
redeploy, confirm `/health` → `betaTesters: "enabled"`. Disable: remove it (or
`false`) and redeploy; in-progress beta rides then stay journaled but
unattended until re-enabled (their evidence is not deleted).

## Restart durability

The coordinator stays process-memory for operator rides. A beta ride is started
`durable`: every piece of evidence is also written to a capture journal in
Upstash (`src/captureJournal.ts`, keys `tapso:beta-tester:v1:journal:<sessionId>:*`
and the set `journals:open`):

- header (the capture without its lists) and the first snapshot are written
  before polling starts; if that fails, the ride does not start (`503`, no ride
  slot used);
- each snapshot, marker and lifecycle event is appended in collection order;
- the phase (`active` / `post_alight` + alight time / `completed` + endedAt) is
  written on every change; 하차 완료 waits for its marker and phase to be durable
  before answering.

**Single owner.** A lease key holds the owning process's random instance id with
a 30 s TTL. Every journal write runs in one Lua `EVAL` that renews the lease and
writes, and refuses (writes nothing) if a *different* collector holds the lease.
A process whose write is refused stops polling that ride and forgets it
(`detach`). A lapsed lease that nobody took (a long poll gap) is re-taken by its
writer.

**Recovery.** At startup and every 15 s, and lazily on any tester read or
finish, a process loads each open journal whose ride is not terminal and calls
`coordinator.restore`: it takes the lease (refused while another live collector
holds it — the tester then honestly still sees `recording`), rebuilds the exact
capture, appends a `resumed` lifecycle event, and resumes polling. The downtime
is simply missing snapshots; nothing is fabricated, and the cadence surrogate
fails closed across the gap. A ride already past its 90-minute cap or its
post-alight window is completed at recovery without a provider read. A journal
whose phase is `completed` is restored byte-for-byte (no `resumed` event), so a
resubmission deduplicates on the same raw hash.

**Submission.** One attempt at a time per ride across collectors
(`capture:<id>:submit-lock`, 60 s), on top of the raw-hash `SET NX` dedupe. The
journal is deleted after the ride is stored; a revoked tester's journal is kept
(removed from the open set) for the operator.

**Verified by** `test/betaRestart.test.ts` with two simulated processes sharing
the stores and one clock: active ride → restart → the owner resumes via
`/beta/me` with all 13 pre-restart snapshots → collection continues in B →
finish twice → one submission, no duplicate snapshots, one `resumed` event,
`MATCHER_FIELD_CLEAN`, journal closed; zombie fencing (A's late poll writes
nothing and A detaches); restart after 하차 완료; restart after completion but
before storage (byte-identical raw, one record); restart past the 90-minute cap;
journal outage at start; cross-tester 404 after recovery.

**Live Upstash verification: DONE (2026-09-25).** The exact
`UpstashCaptureJournal` implementation was exercised against the production
collector's existing Upstash database through a run-unique
`tapso:verify:capture-journal:<uuid>:` namespace. The verifier passed all 16
invariants: begin/load round-trip, same-owner fenced append/state writes,
foreign-owner acquire/append/state refusal, unchanged evidence after a refused
writer, same-owner lease renewal, a real positive Redis lease TTL, lease
deletion followed by re-take through the production Lua `EVAL` path, restored
owner identity, close semantics, and exact-key cleanup. The Railway deployment
used the fail-closed start command
`verifyCaptureJournalLive.ts --yes && backgroundServer.ts`; deployment
`78ab4598-febe-4670-8cb2-897f3850b1c9` reached `SUCCESS` and passed
`/health`, which is possible only if the verifier exits 0 after all checks and
cleanup. The service start command was then restored and the one-off hook
removed.

This closes the live-Redis/Lua uncertainty without a bus ride. It does **not**
prove the full real-iPhone → active beta ride → Railway restart → recovered ride
E2E path; that remains a release-evidence item before broad automatic matching
is enabled. *(Historical, 2026-09-29: no longer a release-evidence item. The
path stays unverified and matters only to beta rides; see the note at the
top.)*

A ride is still lost (tester sees 저장되지 못했어요, slot returned) only when no
journal exists for it — which, with the flag enabled, means its journal was
deleted by hand.

## Why marker lag does not gate beta rides (finding, verified in code)

`markerLagSamples` exists in `assessEvidence` (`services/api/src/rideCapture.ts`)
as a sample-size precondition for the *provider lag distribution*: how long after
a rider physically passed a stop TAGO reported it. It feeds only
`evidenceCompleteness.verdict` and `freshnessEvidence.markerLagSeconds`.

- `replayMatching` (`matchReplay.ts`) never reads markers. It reads snapshots,
  the boarding stop sequence and the boarded vehicle id (for scoring and for the
  direction cross-check).
- v1 `classifyReplayedRide` (`rideCampaign.ts`) never reads
  `evidenceCompleteness`. A Railway ride without markers is already
  `CLEAN_GATE_CANDIDATE` under v1 today if its replay is clean. So the premise
  "the campaign required physical markers" holds only for the descriptive
  `evidenceVerdict`, not for the v1 bucket.

Conclusion: marker lag is a provider/cadence calibration requirement, not a
per-ride matcher ground-truth requirement. Beta rides therefore can inform the
matcher question and cannot inform the calibration question.

## Validation model

| Question | Evidence | Who |
|---|---|---|
| A. Provider / cadence calibration | physical stop markers, marker lag, receipt cadence | operator rides (v1 page, unchanged) |
| B. Matcher field correctness | tester-confirmed bus + boarding stop, Railway snapshots, current matcher replay | beta rides (`beta-matcher-30-boardings-v2`) |

The broad-real-mode gate needs both. Thirty clean beta rides can satisfy only
the matcher field-sample part. `GET /beta/campaign` always reports
`gateClosed: false`, `automaticMatching: "disabled"` and
`providerCadenceCalibration: "SEPARATE_REQUIREMENT_NOT_ADDRESSED_BY_BETA_RIDES"`.

### Beta policy `beta-matcher-v2` (`services/api/src/betaCampaign.ts`)

A beta ride is `MATCHER_FIELD_CLEAN` only if all hold:

- `captureEngine = railway-background`, raw stored (by construction)
- ground truth = the tester's plate suffix, resolved on the server to exactly one
  vehicle on an uncached provider read, then re-confirmed by `coordinator.start`
  (never the matcher's pick)
- `evidenceCompleteness` criteria `trackedVehiclePresent`, `successfulSnapshots`
  (≥ 20), `trackedSequenceProgression` (≥ 3), `contentChangeSamples` (≥ 5) met —
  the analyzer's own thresholds, reused by name
- `matchGate.usableForGate = true`
- `selectionVerdict = correct` (v1 also counts `never_committed`; v2 does not)
- `boardedDirectionChanges = 0`, `selectionsWhileNotFresh = 0`

`markerLagSamples` and `arrivalObserved` are recorded, never required.
`wrong`, a direction change or a stale selection → `MATCHER_FIELD_FAILURE`
(listed first in `alerts`). Anything else → `MATCHER_FIELD_NOT_COUNTED` with
reasons. v2 is stricter than v1 on sample size and verdict; it relaxes nothing v1
enforces. Each stored beta record keeps v1's bucket too, for comparison.

Beta records live only in the beta campaign set. `submitCompletedCapture`
refuses a beta ride into v1 and a non-beta ride into beta, refuses the same raw
bytes in a second campaign, and `POST /capture/:id/submit` refuses a
beta-owned session (`409 BETA_CAPTURE`).

## Historical ride-report audit (2026-09-25)

The user's retained library contains **13 historical real-ride reports across 10
route IDs**, but no matching raw captures. Twelve of the thirteen reports meet
the beta v2 analyzer's reusable minimum sample-size criteria
(`successfulSnapshots >= 20`, `trackedSequenceProgression >= 3`,
`contentChangeSamples >= 5`). Across the set there are 2,081 successful
snapshots; the median ride has 149 snapshots, 8 distinct tracked sequence
positions and 63 content changes. One short/weak ride has only two sequence
positions and correctly fails the minimum.

This is useful threshold sanity evidence: the v2 20/3/5 minimums are not
obviously unrealistic for the historical field data. It is **not matcher
correctness evidence**. All retained files are old `web-controller` reports
with no replayable raw snapshots and no current `matchGate` block, so they
cannot be re-run under the current matcher and must not be counted toward
`beta-matcher-30-boardings-v2`. Four of the thirteen reports also contain
browser-hidden/background gaps, another reason not to promote them into the
Railway beta campaign.

## Threat model and auth

| Asset | Protection |
|---|---|
| `RIDE_CAPTURE_OPERATOR_TOKEN` | Never in beta HTML/JS, invite links, storage, logs or responses. Beta routes do not accept it; operator routes do not accept beta credentials. |
| Invite secret `tbi_` + 32 random bytes | URL fragment only (never sent in HTTP), removed with `history.replaceState` before the first request, POSTed in a body. Stored as SHA-256 only. Single use (`SET NX`). Expiring, revocable. |
| Tester credential `tbt_` + 32 random bytes | Issued once at redemption, kept in the tester's `localStorage` (the collector is a different site from the page, so a cookie would be a third-party cookie Safari blocks). Stored as SHA-256 only. Revocation is immediate. |
| Other testers' rides | Server-side ownership record per session; foreign and nonexistent ids both return the same 404. No listing endpoint. |
| Raw captures, campaign numbers | Operator routes only. Tester responses carry `state`, route number, stop names, start time. No bucket, vehicle number, coordinate or count. |

The beta page has a CSP (`script-src 'self'`, `connect-src 'self'` + collector,
no inline code), `no-referrer`, and never asks for geolocation.

Tester capabilities: redeem, read own access, start one ride, read/finish own
rides (finish implies submit). Never: raw, campaign, invites, operator routes,
other sessions, enumeration.

## Lifecycles

**Invite:** operator `POST /beta/invites {label?, days=14 (1–30), maxRides=10 (1–50)}`
→ link shown once → tester opens → `POST /beta/session {invite}` → credential.
Second redemption `409 INVITE_USED`; expired `410 INVITE_EXPIRED`; revoked
`410 INVITE_REVOKED`. `GET /beta/invites` lists metadata and rides used, never a
secret or digest. `POST /beta/invites/:id/revoke` is idempotent.

**Credential:** valid until the invite's `expiresAt` or revocation. After expiry
the tester may still read and finish a ride that started before expiry, for up to
4 hours (`EXPIRED_ACTIVE_RIDE_GRACE_MS`); a new start is `403 BETA_EXPIRED`.
Revocation returns `401 BETA_REVOKED` immediately; a revoked tester's ride that
completes afterwards is `held_revoked` and not submitted (raw stays with the
collector for the operator).

**Ride / ownership** (`BetaCaptureOwnership`):
`starting → recording → finishing → submitted`, with `submit_failed` (retried on
every read/finish), and terminals `lost` (collector restart or retention; the
ride slot is handed back), `start_failed`, `held_revoked`. The session id is
allocated by the beta service and ownership is written before the collector
starts polling. One open ride per tester (`409 BETA_RIDE_IN_PROGRESS`), a
30-second start lock, and `maxRides` counted per started session (`SADD`, so
retries never double-count).

**Finish:** `POST /beta/rides/:id/finish` calls the coordinator's idempotent
`alight`, then the collector completes the capture (destination seen, or the
20-second post-alight window). Completion triggers submission from the
coordinator's `onComplete` hook, so the ride is stored even if the tester closes
the page; any later read also retries a pending submission. Submission is
idempotent on the raw hash, so double taps and retries create one record.

**No destination:** the tester may skip it. The capture then uses the route's
last stop only as a collection bound, records a note saying so, and 하차 완료
records a note instead of an `alighted` marker, so no alighting stop is claimed.

## Storage (Upstash, existing credentials)

Beta namespace `tapso:beta-tester:v1:` (key names hold random ids or secret
digests only): `invites`, `invite:<id>`, `invite-secret:<sha256>`,
`invite:<id>:redeemed`, `credential:<sha256>`, `capture:<sessionId>`,
`tester:<testerId>:active`, `tester:<testerId>:rides`,
`tester:<testerId>:start-lock` (30 s TTL, the only TTL).

Ride evidence uses the existing `tapso:field-validation:v1:` store unchanged
(raw chunks, report, submission) with campaign set
`campaign:beta-matcher-30-boardings-v2`. Records gain an optional
`matcherCampaign` block `{policyVersion, bucket, reasons, criteria, groundTruth,
markerLagSamples, testerId}`.

Pull beta raws for a later replay:
`scripts/field-validation/pull-campaign.ts --yes --campaign=beta-matcher-30-boardings-v2`
(`batch-analyze.ts` then applies v1 rules; re-classify with `classifyBetaMatcherRide`).

## API (Railway collector)

| Route | Auth | Notes |
|---|---|---|
| `POST /beta/session` | none (rate-limited 10/min/IP) | `{invite}` → `{credential, expiresAt, maxRides}` |
| `GET /beta/me` | tester | access state, rides used, own open ride |
| `POST /beta/rides` | tester | `{routeId, cityCode, routeNo, plateSuffix, boardingStopSequence, destinationStopSequence?}` |
| `GET /beta/rides/:id` | tester, owner | sanitized ride view; retries a pending submission |
| `POST /beta/rides/:id/finish` | tester, owner | idempotent |
| `POST/GET /beta/invites`, `POST /beta/invites/:id/revoke` | operator | |
| `GET /beta/campaign` | operator | sanitized v2 summary |

Tester routes are limited to 60 requests/min per tester (per process).
`/health` adds `betaTesters: "enabled" | "unconfigured" | "disabled"`, as in the
flag table above (`backgroundServer.ts`).

## Production setup

One new variable, Railway collector only:

| Name | Where | Secret | Default | Deploy |
|---|---|---|---|---|
| `BETA_TESTERS_ENABLED` | Railway collector | no | absent = disabled | redeploy after changing |

It also needs the existing `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
Vercel needs nothing new. Required:

1. Merge, then redeploy the Railway collector and let Vercel deploy the static
   page. `/health` shows `betaTesters: "disabled"` — beta stays off.
2. When ready, set `BETA_TESTERS_ENABLED=true` on Railway, redeploy, and confirm
   `/health` shows `betaTesters: "enabled"` and `betaRestartRecovery: "durable_journal"`.
3. `TRANSIT_ALLOWED_ORIGINS` on Railway must include the Vercel origin serving
   `beta.html` (it already must, for `background.html`).
4. Upstash eviction must stay off (already confirmed for the field-validation data).
   *(Unconfirmed, 2026-09-29: no record of that check exists in the repository,
   which cannot read the setting; see `../KNOWN_ISSUES.md`. No release gate
   depends on it.)*
5. Create an invite from the operator page and complete one practice ride on a
   real iPhone before inviting anyone. During it, restart the Railway service
   once mid-ride and confirm the page still shows the ride, `/beta/campaign`
   ends with one submission, and the stored raw has one `resumed` event.

## Status

- `DONE` invites, credentials, ownership, beta page, auto finish + submit, v2
  policy, operator panel, deterministic tests (`betaTester`, `betaCampaign`,
  `betaClient`), a 390 px Chromium walkthrough with mocked network.
- `OPEN` full real-iPhone Safari beta restart E2E and human review of the v2
  criteria before any beta matcher count is cited as release evidence.
- `DONE` `BETA_TESTERS_ENABLED` flag (enabled on the Railway collector as of
  2026-09-25), deterministic restart durability (`betaFlag`, `betaRestart`
  tests), and the capture journal's production Lua `EVAL` path against live
  Upstash (16/16 plus cleanup).
- Known limitations: snapshots during actual restart downtime are missing (not
  invented); if a journal write fails transiently the evidence stays in memory
  and a later restart would lose only what was not journaled; rate limits are
  per process; a revoked tester's in-progress capture keeps polling until the
  collector's 90-minute cap; an invite whose redemption response was lost is
  burned and must be reissued; there is no delete/export tool for a tester's own
  data.

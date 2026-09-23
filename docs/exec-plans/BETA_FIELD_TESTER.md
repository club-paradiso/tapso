# Beta field testers

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
`/health` adds `betaTesters: "enabled" | "unconfigured"`.

## Production setup

No new environment variables. Beta is enabled exactly when the collector already
has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Railway), which
production has. Required:

1. Merge, then redeploy the Railway collector and let Vercel deploy the static page.
2. Confirm collector `/health` shows `betaTesters: "enabled"`.
3. `TRANSIT_ALLOWED_ORIGINS` on Railway must include the Vercel origin serving
   `beta.html` (it already must, for `background.html`).
4. Upstash eviction must stay off (already confirmed for the field-validation data).
5. Create an invite from the operator page and complete one practice ride on a
   real iPhone before inviting anyone.

## Status

- `DONE` invites, credentials, ownership, beta page, auto finish + submit, v2
  policy, operator panel, deterministic tests (`betaTester`, `betaCampaign`,
  `betaClient`), a 390 px Chromium walkthrough with mocked network.
- `OPEN` real-iPhone Safari walkthrough; first real beta ride; human review of
  the v2 criteria before any beta count is cited.
- Known limitations: collector state is process memory, so a Railway restart
  loses an in-progress ride (`lost`, slot returned); rate limits are per process;
  a revoked tester's in-progress capture keeps polling until the collector's
  90-minute cap; an invite whose redemption response was lost is burned and must
  be reissued; there is no delete/export tool for a tester's own data.

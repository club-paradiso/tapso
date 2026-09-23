# One-tap field-validation submission

## Goal

A completed Railway background ride counts toward the 30-boarding gate by one
tap on the phone. Nobody moves JSON files around. The raw `RideCapture` stays
the only source of truth, and it stays replayable under any later matcher.

```text
start ride → server collects → complete → [검증 데이터 제출]
  → server replays the raw under the CURRENT analyzeRideCapture
  → duplicate check → campaign classification (classifyReplayedRide)
  → raw + report + sanitized record stored durably → count returned to the phone
```

Manual RAW / REPORT download stays, under "개발자 / 백업 내보내기", as the rescue
path and for debugging.

## Unchanged by this plan

- Automatic matching stays disabled (`TRANSIT_AUTOMATIC_MATCHING_ENABLED=false`).
- The gate criteria are the same, and the bucket rules are PR #49's, unchanged.
  Only `CLEAN_GATE_CANDIDATE` counts.
- A report without its raw never counts. The endpoint accepts no report at all.
- Reaching 30 closes nothing. `gateClosed` is always `false`; a human decides.
- The 13 historical report-only rides stay at 0 of 30.

## Storage

**Chosen: Upstash Redis, which TAPSO already uses.** `services/api` reaches it
through the same zero-dependency REST client (`upstashRest.ts`) the
journey-session store now shares.

*Rejected: Supabase (used by `apps/web`).* Its client runs with the
service-role key, which bypasses RLS. Putting that key on the ride collector
would let the collector reach waitlist and payment data. That is a worse
exposure than keeping ride evidence in the Redis database `services/api`
already holds a token for.

Keys, all under `tapso:field-validation:v1:`. They carry a random submission id
or a content hash; none carries a vehicle number, a route or a time:

| Key | Value | Notes |
|---|---|---|
| `hash:<rawSha256>` | submission id | `SET NX`; the duplicate identity |
| `ride:<sha256(route\|start\|engine)>` | submission id | `SET NX`; advisory only, never rejects |
| `raw:<id>:meta` | `{chunks, rawSha256, rawBytes, encoding}` | |
| `raw:<id>:<n>` | gzip + base64 chunk (≤ 256 KiB of text) | **sensitive**: vehicle numbers and coordinates |
| `report:<id>` | sanitized report JSON | |
| `submission:<id>` | sanitized `FieldRideSubmission` | written last; its presence means committed |
| `campaign:<campaignId>` | set of submission ids | `SADD`, idempotent |

`FieldRideSubmission` records:
- identity: `id`, `campaignId`, `routeId`, `cityCode`, `startedAt`, `endedAt`, `captureEngine`
- storage and integrity: `rawObjectKey`, `rawSha256`, `reportSha256`, `rawBytes`
- evidence: `snapshotCount`, `evidenceVerdict`
- gate: `usableForGate`, `selectionVerdict`, `contestedDecisions`, `candidateMargin`, `boardedDirectionChanges`, `selectionsWhileNotFresh`, `boardedCadenceStates`
- classification: `bucket`, `policy`, `reasons`
- audit: `replayAgreesWithRideTimeReport`, `sameRideAs`, `analyzerSchemaVersion`, `schemaVersion`, `submittedAt`

The campaign counter is not a stored integer. It is recomputed from the
committed records on every read, so a retry or a duplicate cannot skew it.

No key has a TTL. This is evidence, so **the database must not evict keys**;
see the one-time setup below.

## API (Railway collector, `backgroundHttp.ts`)

| Route | Capability | Behaviour |
|---|---|---|
| `POST /capture/:sessionId/submit` | `capture:submit` | No request body is read. It loads the session's own completed raw, replays it, stores it and returns a sanitized receipt: `201` for a new submission, `200` with `duplicate: true` for a repeat. `409` while the ride is active, `404` once pruned, `400` for a bad id, `503 FIELD_VALIDATION_UNAVAILABLE` when storage is not configured, `503 SUBMISSION_FAILED` on a storage error. |
| `GET /field-validation/campaign` | `campaign:read` | The sanitized campaign summary: clean count, remaining, routes, verdict counts, contested decisions, direction reversals, stale selections, alerts. |

**Duplicates.** `rawSha256` is taken over canonical JSON (keys sorted). The
first submit claims it with `SET NX`. A second submit of the same capture finds
the committed record and returns it unchanged. A submit interrupted by a
storage failure resumes under the same id on retry, because the claim is taken
first and the record is written last. Two submissions that share a route, start
and engine but differ in bytes are both stored and flagged in `alerts`, never
silently merged.

**Replay.** The server runs the current `analyzeRideCapture` over the raw and
records whether it agrees with the ride-time report the collector computed at
completion (`replayAgreesWithRideTimeReport`). Disagreement is raised as an
alert; the replay always wins.

## Phone (background.html / background.js)

The finish screen has one primary action, **검증 데이터 제출**, followed by:
- **Result:** `Field Ride #n`, the bucket, `캠페인 x / 30` and `남은 기록`. If the
  ride doesn't count, the screen says why (`WRONG_VEHICLE_SELECTED`,
  `NOT_USABLE_FOR_GATE`, `INSUFFICIENT_EVIDENCE`, …). Server alerts are shown in red.
- **On failure:** "제출 실패 · 원본은 서버에서 아직 보관 중입니다", a **다시 제출**
  button, the retention deadline, and the backup section opened.
- **Manual export:** the raw is prefetched into page memory when the ride
  completes, so it can still be saved by hand after the collector prunes it.
- **Leaving without saving:** starting a new ride without either submitting or
  saving the raw asks for confirmation.

No vehicle number is rendered anywhere.

## Authorization and friend testers

**Superseded by `BETA_FIELD_TESTER.md`** (scoped tester credentials, ownership,
automatic submission into `beta-matcher-30-boardings-v2`). The text below is the
original deferral, kept for history.

**Deferred.** Every route still requires `RIDE_CAPTURE_OPERATOR_TOKEN`, so the
flow is operator-only. Nothing in this PR hands that token to anyone.

What exists is the seam. Every route declares one `CollectorCapability`, and
authorization goes through a `CollectorAuthorizer`, so a tester credential can
be added without touching the routes. The follow-up needs:

1. Tester credentials (issued, revocable, stored hashed), separate from the
   operator token.
2. Session ownership, recorded at `capture:start`.
3. An authorizer granting `capture:start`, `capture:write`, `capture:read`
   and `capture:submit` for the tester's own sessions only, and never
   `capture:raw` or `campaign:read`.
4. Tests for cross-session denial.

## One-time setup (production)

| Variable | Service | Secret | Notes |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Railway collector | no (but it names the host; treat as private) | must be `https://` |
| `UPSTASH_REDIS_REST_TOKEN` | Railway collector | **yes** | |

- Setting both enables submission; the collector must be **redeployed** after
  setting them. `/health` then reports `fieldValidationStorage: "upstash"`.
- Without them it reports `"unconfigured"`, submit answers `503`, and the phone
  falls back to manual export.
- In the Upstash console, confirm that **eviction is off** for this database. A
  database that evicts under memory pressure would silently delete evidence.
- Vercel needs nothing new. The background page is static and talks only to
  the collector.

## Replaying the campaign later

```bash
env -u UPSTASH_REDIS_REST_TOKEN node --env-file=.env.local --experimental-strip-types \
  scripts/field-validation/pull-campaign.ts --yes          # raws → work/field-validation/pulled/
node --experimental-strip-types scripts/ride-capture/batch-analyze.ts work/field-validation/pulled
```

`pull-campaign.ts` is read-only against the store and verifies every raw
against its recorded hash.

## Status

- `DONE` Storage, submit, dedupe, campaign summary, finish-screen UX, pull
  script, and deterministic tests (`test/fieldValidation.test.ts`).
- `OPEN` One-time production setup above, then one practice ride to confirm the
  receipt on a real phone.
- `DONE` Friend-tester credentials, as a separate beta flow with its own
  versioned campaign: `BETA_FIELD_TESTER.md`.

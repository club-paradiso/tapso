# Controlled Route 365 ride capture

## Outcome and non-goals

Give the next validation gate in `docs/DATA_VALIDATION.md` a repeatable tool: during a real Route 365 ride, poll TAGO for the chosen direction, store bounded snapshots only under ignored `work/rides/`, let the rider mark the boarded vehicle and physically passed stops, and produce a sanitized report that compares provider `nodeord` progression, content-change age, gaps, and arrival against those markers.

Non-goals: defining the freshness rule itself, enabling journey-session matching or progress for passengers, changing `TagoTransitProvider`, or committing raw vehicle numbers, coordinates, or authenticated responses.

## Verified constraints

- VERIFIED_OFFICIAL_SCHEMA: TAGO locations carry `vehicleno`, `nodeord`, `nodeid`, `nodenm`, `gpslati`, `gpslong` and no source timestamp. Every age in the report is time since the snapshot content for a vehicle last changed, measured with TAPSO receipt time (`docs/validation/TAGO_2026-09-11.md`).
- VERIFIED_MEASUREMENT (2026-09-10 bounded probe): snapshot-change interval median 27.52 s, max 83.10 s. The default 5 s poll and 3 s floor stay far below the development quota for a 90-minute cap (≤ 1 080 location calls).
- REPOSITORY_POLICY: `work/` is Git-ignored; capture files are written with mode `0600` and refuse to persist if the service key appears in the encoded payload.
- UNVERIFIED: real-ride behaviour. No capture has been run yet; the tool is validated only against synthetic fixtures labelled synthetic.
- VERIFIED (2026-09-12, DRY RUN / SYNTHETIC): the whole operator flow was rehearsed by running the real CLI with a fabricated TAGO upstream injected at `fetch`. Briefing, `v`, `s`, `?`, an ambiguous `b` refusal, a partial-number `b` resolution, four markers, arrival detection, post-arrival snapshots, `work/rides/` at `0700` with files at `0600`, and a report holding neither a vehicle number nor the key. This rehearsal is not real-world evidence and is not stored in the repository.
- VERIFIED (2026-09-12): the real CLI fails closed without a credential (`BLOCKED_BY_CREDENTIALS`), rejects a percent-escaped Encoding key by name, and warns before honouring the retired `PUBLIC_DATA_SERVICE_KEY`. No message carried a URL or a key.

## Milestones

1. `DONE` Analysis module `services/api/src/rideCapture.ts`: schema, validation against official topology, per-vehicle pseudonymised timelines, tracked-vehicle remaining stops, marker lag, gap and content-age summaries, and a refusal guard when a raw vehicle identifier would reach the report.
2. `DONE` Runner `services/api/src/rideCaptureRunner.ts`: bounded polling loop with rider commands, persisted after every snapshot, tolerant of provider failures, automatic stop after arrival plus a few snapshots, snapshot and duration caps.
3. `DONE` CLI `scripts/ride-capture/capture.ts` and `scripts/ride-capture/analyze.ts`.
4. `DONE` Deterministic Node tests (`services/api/test/rideCapture.test.ts`, 15 tests) covering tracking, gaps, reversal, marker lag, warnings, validation, runner failure tolerance, arrival stop, limits, quit, command parsing, vehicle resolution, the rider briefing, masked status output, presence and advance distributions, GPS-versus-`nodeord` movement, capture integrity counters, the evidence verdict, and an interrupted capture.
5. `DONE` Operator readiness (Task B preparation): the rider sees the stop list and both endpoint names before the first poll, boards by the last four characters of the plate with the typed number cross-checked against the live snapshot, and can ask for vehicles or status mid-ride. The report carries p75/p90, presence ratios, advance and marker-lag distributions, integrity counters, and a `SUFFICIENT` / `INSUFFICIENT_EVIDENCE` verdict.
6. `PENDING` One real ride on `JEB405136521` or `JEB405136522`, sanitized report summarised in `docs/DATA_VALIDATION.md`.
7. `PENDING` Freshness rule derived from ≥ 1 ride, then journey-session tests before enabling tracking. Task C, not this plan.

## Decisions

- Report pseudonyms (`tracked`, `V1`, `V2`, …) are assigned per run in order of first appearance so the report can be tracked in Git without vehicle numbers. The report generator throws rather than emitting a raw identifier.
- Arrival is detected when the tracked vehicle reports `stopSequence >= destination`; `passedDestination` flags overshoot separately. This mirrors the fail-closed spirit of the journey state machine but is analysis only.
- Marker lag is `providerReachedAt − markedAt`: positive means the provider reported the stop after the rider saw it. `boarded` and `note` markers are recorded without lag.
- The runner keeps polling through provider errors and records the credential-safe message, because a dropout is itself evidence for the freshness rule.
- The rider types the vehicle number once, in full or as its last four characters. It resolves against the vehicles the route is currently reporting: a unique match is recorded, an ambiguous one is refused with the candidates masked, and a number that matches nothing is still honoured verbatim with a loud warning. Nothing ever re-matches on its own — picking the wrong bus is the one mistake a ride cannot repair afterwards.
- The terminal prints vehicle numbers masked to their last four characters, which is what a rider compares against the plate in front of them. Full numbers exist only in the ignored capture file, so a screenshot of the session leaks nothing.
- The report states `INSUFFICIENT_EVIDENCE` when a distribution lacks samples. Each minimum is a sample-count precondition, never a freshness threshold; Task C derives thresholds from the distributions.

## Reproduction

```bash
npm --prefix services/api test
mkdir -p work
env -u TAGO_SERVICE_KEY node --env-file=.env.local --experimental-strip-types \
  scripts/ride-capture/capture.ts JEB405136521 39 <boarding-seq> <destination-seq>
# while riding: b <vehicle|last4> · p <seq> · a [seq] · n <note> · v · s · ? · q
node --experimental-strip-types scripts/ride-capture/analyze.ts work/rides/<capture>.json
```

`env -u TAGO_SERVICE_KEY` clears an exported copy of the name so the value in
`.env.local` is the one used: Node's `--env-file` does not overwrite a variable
that is already set.

Stop sequences come from `GET /v1/stops?routeId=…&cityCode=39`, or from the
briefing the capture prints before its first poll, which lists every stop from
boarding to destination with its name.

## Progress / next action

Implemented and tested. [PR #24](https://github.com/club-paradiso/tapso/pull/24) merged into `main` on 2026-09-11 with CI green (`api`, `transit-core`, `web`). The tool is therefore available on `main`; no credentialed run has happened yet.

Next action: ride one full-length Route 365 direction with `.env.local` loaded,
keep the capture under `work/rides/`, and paste only the sanitized
`.report.json` summary (counts, seconds, pseudonyms) into
`docs/DATA_VALIDATION.md`. Then define the TAGO freshness rule from
`freshnessEvidence` and `tracked.markerComparisons` — in Task C, not here. The
exact commands are in `docs/HANDOFF.md`; a deployed API is not required, because
the capture tool drives `TagoTransitProvider` directly.

Marker density for that ride: the analyzer needs at least three physical markers
the provider was observed to reach before a lag distribution means anything, and
p75/p90 only start to separate around eight to ten. Mark a stop where the bus
actually halts and the doors open, roughly every third or fourth stop, rather
than every stop — an uncertain marker is worse than a missing one, because the
lag distribution cannot tell the two apart.

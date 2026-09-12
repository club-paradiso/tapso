# Controlled Route 365 ride capture

## Outcome and non-goals

Give the next validation gate in `docs/DATA_VALIDATION.md` a repeatable tool: during a real Route 365 ride, poll TAGO for the chosen direction, store bounded snapshots only under ignored `work/rides/`, let the rider mark the boarded vehicle and physically passed stops, and produce a sanitized report that compares provider `nodeord` progression, content-change age, gaps, and arrival against those markers.

Non-goals: defining the freshness rule itself, enabling journey-session matching or progress for passengers, changing `TagoTransitProvider`, or committing raw vehicle numbers, coordinates, or authenticated responses.

## Verified constraints

- VERIFIED_OFFICIAL_SCHEMA: TAGO locations carry `vehicleno`, `nodeord`, `nodeid`, `nodenm`, `gpslati`, `gpslong` and no source timestamp. Every age in the report is time since the snapshot content for a vehicle last changed, measured with TAPSO receipt time (`docs/validation/TAGO_2026-09-11.md`).
- VERIFIED_MEASUREMENT (2026-09-10 bounded probe): snapshot-change interval median 27.52 s, max 83.10 s. The default 5 s poll and 3 s floor stay far below the development quota for a 90-minute cap (≤ 1 080 location calls).
- REPOSITORY_POLICY: `work/` is Git-ignored; capture files are written with mode `0600` and refuse to persist if the service key appears in the encoded payload.
- UNVERIFIED: real-ride behaviour. No capture has been run yet; the tool is validated only against synthetic fixtures labelled synthetic.

## Milestones

1. `DONE` Analysis module `services/api/src/rideCapture.ts`: schema, validation against official topology, per-vehicle pseudonymised timelines, tracked-vehicle remaining stops, marker lag, gap and content-age summaries, and a refusal guard when a raw vehicle identifier would reach the report.
2. `DONE` Runner `services/api/src/rideCaptureRunner.ts`: bounded polling loop with rider commands, persisted after every snapshot, tolerant of provider failures, automatic stop after arrival plus a few snapshots, snapshot and duration caps.
3. `DONE` CLI `scripts/ride-capture/capture.ts` and `scripts/ride-capture/analyze.ts`.
4. `DONE` Deterministic Node tests (`services/api/test/rideCapture.test.ts`, 6 tests) covering tracking, gaps, reversal, marker lag, warnings, validation, runner failure tolerance, arrival stop, limits, quit, and command parsing.
5. `PENDING` One real ride on `JEB405136521` or `JEB405136522`, sanitized report summarised in `docs/DATA_VALIDATION.md`.
6. `PENDING` Freshness rule derived from ≥ 1 ride, then journey-session tests before enabling tracking.

## Decisions

- Report pseudonyms (`tracked`, `V1`, `V2`, …) are assigned per run in order of first appearance so the report can be tracked in Git without vehicle numbers. The report generator throws rather than emitting a raw identifier.
- Arrival is detected when the tracked vehicle reports `stopSequence >= destination`; `passedDestination` flags overshoot separately. This mirrors the fail-closed spirit of the journey state machine but is analysis only.
- Marker lag is `providerReachedAt − markedAt`: positive means the provider reported the stop after the rider saw it. `boarded` and `note` markers are recorded without lag.
- The runner keeps polling through provider errors and records the credential-safe message, because a dropout is itself evidence for the freshness rule.
- The rider types the vehicle number once (`b <vehicleno>`); the runner never prints it back.

## Reproduction

```bash
npm --prefix services/api test
mkdir -p work
env -u TAGO_SERVICE_KEY node --env-file=.env.local --experimental-strip-types \
  scripts/ride-capture/capture.ts JEB405136521 39 <boarding-seq> <destination-seq>
# while riding: b <vehicleno> | p <stop-seq> | a | n <note> | q
node --experimental-strip-types scripts/ride-capture/analyze.ts work/rides/<capture>.json
```

Stop sequences come from `GET /v1/stops?routeId=…&cityCode=39` or from the stop list the capture prints at exit.

## Progress / next action

Implemented and tested. [PR #24](https://github.com/club-paradiso/tapso/pull/24) merged into `main` on 2026-09-11 with CI green (`api`, `transit-core`, `web`). The tool is therefore available on `main`; no credentialed run has happened yet.

Next action: ride one full-length Route 365 direction with `.env.local` loaded, keep the capture under `work/rides/`, and paste only the sanitized `.report.json` summary (counts, seconds, pseudonyms) into `docs/DATA_VALIDATION.md`. Then define the TAGO freshness rule from `freshnessEvidence` and `tracked.markerComparisons`. The exact commands are in `docs/HANDOFF.md`; a deployed API is not required, because the capture tool drives `TagoTransitProvider` directly.

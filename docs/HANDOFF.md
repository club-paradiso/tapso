> TAGO migration: complete and merged. Current provider setup and evidence are in `DATA_SOURCES.md`, `DATA_VALIDATION.md`, and `exec-plans/TAGO_MIGRATION.md`. Earlier B551982 instructions are historical.

> **2026-09-29.** The next step is no longer a human ride. It is the rider-free path under *Next step: rider-free matcher evidence* below. Task B's ride procedures are kept as history and are not required.

# Handoff

For the release-focused Claude Desktop/Claude Code continuation, use `docs/CLAUDE_DESKTOP_HANDOFF.md`. The Apple team identity is now resolved: the only team available to the build host is a free Personal Team, so TestFlight distribution is gated on obtaining a paid Apple Developer Program membership. See `KNOWN_ISSUES.md` and the Team prerequisite in `TESTFLIGHT.md`.

## State on 2026-10-02 (production ride vertical slice, PR #94)

- **Production sessions: on since 2026-10-03.** Post-deploy run `37081618489` (00:21 UTC, build `bfd8c7e`): smoke 17/17, lifecycle 8/8. The Production variables are set; do not change or redeploy them to "enable" sessions. Rollback is in `PRODUCTION_TRANSIT_API.md`. History: until then production answered `503 SESSIONS_UNAVAILABLE`, and the first attempt on 2026-10-02 took the API down for about 30 minutes (`KNOWN_ISSUES.md`, `INCIDENT`).
- **Issue #80: fixed in code.** At `READY_FOR_SHADOW` the rider picks a bus from raw positions (`vehicleChoice`, `choose`). Only `READY_FOR_CONFIRMATION_ASSISTED` lets the matcher's list be a suggestion.
- **TAGO failures are bounded.** One 9 s deadline per logical request, with telemetry per request in `/health` → `providerHealth`. A failed stop-list refresh is served stale; a failed vehicle read fails closed.
- **Issue #74: measured and not fixed, by decision** (`validation/ISSUE_74_LATE_APPEARANCE_2026-10-02.md`). Readiness stays `READY_FOR_SHADOW`.
- **Live Activity push, milestone 4: done in code.** It pushes on change, alerts each milestone once, and ends the activity with the ride. It needs APNs credentials (paid Apple team) and a scheduler (milestone 5) before anything is pushed.
- **Route 365 and 442 timetables.** Imported 2026-10-03 (`fixtures/jeju/timetables/365.json` and `442.json`, parsed from the owner's downloads by `scripts/timetables/jeju_xlsx.py`, schema `tapso-jeju-timetable-v2`). Nothing reads it at runtime yet: route-info still shows TAGO's service day. Next: a holiday calendar to pick the day type, then the other routes' files (`DATA_SOURCES.md` → *Jeju timetables*).
- **Exact next action:** unchanged for matcher evidence. It is the rider-free path below; no readiness level needs a ride. Product, separately and optionally: an owner check of the live flow on their own iPhone, installed with the free Personal Team (no TestFlight, a 7-day install, no APNs). It is a product check, not matcher evidence. The paid Apple team remains the blocker for APNs and TestFlight.

## What works

- `packages/transit-core`: deterministic Swift route progress, freshness, journey state, demo fixtures, and a demo-only matcher (`VehicleMatchingEngine`, not authoritative for real riders; see `VEHICLE_MATCHING.md`).
- `apps/ios`: generated native Xcode project, SwiftUI demo, ActivityKit lifecycle, WidgetKit Lock Screen/Dynamic Island extension, localization, and iOS tests.
- `services/api`: the TAGO adapter boundary, one shared request handler with a local Node transport and a Vercel Functions transport, route caching, the directed matcher `directed-route-progress-v1` under release gate `matcher-passive-safety-v4`, journey sessions in memory or an Upstash store, credential validation, timeouts, the APNs interface, and Node tests.
- `fixtures/transit`: synthetic scenario manifest, official-shaped adapter payload, and the language-neutral matcher specification cases.
- Rider-free matcher evidence: CI's `matcher-evidence` job runs the property suite, the negative controls and the re-decision of the 268 former live wrong commits on every push; `.github/workflows/matcher-evidence.yml` runs passive collection, replay and counterfactuals once merged.

## Reproduce

```bash
swift test --package-path packages/transit-core
npm test --prefix services/api
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

If the repository is in an iCloud/FileProvider location, choose **Keep Downloaded** and put DerivedData under `/tmp` or another unsynced local directory. Signing can fail when copied resource forks or Finder metadata reach the `.app`; use a content-only copy if necessary.

## Next step: rider-free matcher evidence

Status on 2026-09-29: release gate `matcher-passive-safety-v4` has demonstrated
`READY_FOR_SHADOW`. Automatic matching is off, and the configuration refuses it
below `READY_FOR_BOUNDED_AUTOMATION`. The next level,
`READY_FOR_CONFIRMATION_ASSISTED`, needs a clean, deterministic full-window
replay of live evidence, clean counterfactuals on real bases, and a larger live
sample (≥ 60 trajectories, ≥ 30 vehicles, ≥ 30 contested trajectories, ≥ 8 routes,
≥ 3 windows, ≥ 2 time bands; Passive Shadow v3 alone has 29 trajectories
with cases by its own split (the gate's unit can only merge them), 27 vehicles,
5 routes, 1 window and 1 time band, and its 46 contested cases come from at
most 29 trajectories). None of it needs a bus ride, a stop marker, a
capture export, a manual script run or a manual inspection:

1. **Merge the pull request.** Scheduled workflows run only from the default
   branch, so nothing below starts before the merge.
2. **The merge commit runs the evidence-of-record replay.** It changes
   `ops/matcher-evidence/request.json` on `main`, which runs
   `.github/workflows/matcher-evidence.yml` once in `replay` mode. The job
   downloads the Passive Shadow v3 raw artifact (run `36098610702`), keeps a
   90-day copy first, verifies it against the digest GitHub recorded at upload,
   replays it offline twice under both policies (the two outputs must be
   byte-identical), evaluates the current policy blind, and runs the
   counterfactual suite on the real bases. A best-effort job also stores the raw
   in a private draft-release vault. The source artifact expires on
   2026-10-09T06:28:03Z and must be copied before then.
3. **The schedule collects one bounded passive window a day.** Read-only,
   rotating route pools across KST time bands; each window is then
   evaluated blind, migrated and run through the counterfactual suite offline,
   and every scheduled run also smoke-tests production. Without a
   `TAGO_SERVICE_KEY` repository secret the job reads TAPSO's public API; with
   one it reads TAGO directly.
4. **The gate is re-evaluated.** After each successful replay or window, the
   workflow's `gate-evidence` job recomputes the gate's live inputs offline
   from every retained raw collection (`scripts/matcher-evidence/live-evidence.ts`)
   and evaluates the gate with `scripts/matcher-evidence/gate.ts`; that result
   is informational. CI's `matcher-evidence` job fails unless the committed
   `artifacts/matcher-passive-safety-v4/gate-result.json` and the readiness
   claimed in `services/api/src/matchingReadiness.ts` both match the evidence,
   so a higher readiness arrives only in a reviewed pull request, which an agent
   can prepare once it can read the run's artifacts. Readiness never rises
   through a configuration change.

Owner actions, each a one-time authorisation and none of them a ride:

- Let GitHub Actions start jobs again. Since 2026-09-29 every GitHub-hosted job
  of this repository fails before a runner is assigned (cause `INFERRED`: the
  account's Actions budget), so until then neither CI nor the evidence
  workflow runs. Restore the budget or spending limit.
- Merge the pull request. Required: it starts steps 2 and 3.
- Or, instead of both: allow the agent environment to reach
  `productionresultssa18.blob.core.windows.net` and `tapso-api.vercel.app`, so a
  session can copy the raw artifact and replay it offline without Actions.
  Either way, before 2026-10-09T06:28:03Z.
- Optional: add a `TAGO_SERVICE_KEY` repository secret, so the scheduled windows
  read TAGO directly at session cadence. Gate criteria BA-1 and BA-2 require that
  evidence for `READY_FOR_BOUNDED_AUTOMATION`.
- Optional: grant the Claude GitHub App `actions: write`, so an agent can
  dispatch and re-run workflows once Actions can start jobs.

The physical-device Live Activity check (gate criterion BA-5) matters only for
`READY_FOR_BOUNDED_AUTOMATION`, and it is a device check, not a ride. Method and
progress: `exec-plans/HUMAN_LABOR_ELIMINATION.md`. Evidence, and what each level
still needs: `validation/MATCHER_SAFETY_EVIDENCE_V4.md`.

## Task B: controlled real-ride validation (historical, not required)

> **Historical, 2026-09-29.** Not required for release or for any readiness
> level. Release gate `matcher-passive-safety-v4` replaced the ride-count
> campaigns `broad-real-mode-30-boardings-v1` and
> `beta-matcher-30-boardings-v2`, which stay as defined, with zero observed
> boardings. The next step is the rider-free path above. The procedure below is
> kept as the record of the rider-based approach.

~~This is the next evidence gate.~~ It runs entirely against the local machine and
does **not** depend on a deployed API. Status: `READY_FOR_RIDE` — the tooling is
prepared and rehearsed against a synthetic upstream; nothing here is real-world
evidence until a physical ride happens.

Prerequisites:

- A Public Data Portal **Decoding** key in an ignored `.env.local` with
  permissions `0600`, as `TAGO_SERVICE_KEY`:

  ```bash
  install -m 600 /dev/null .env.local   # create it empty and private first
  ```

  Then open `.env.local` in an editor and add the single line
  `TAGO_SERVICE_KEY=<your Decoding key>`. Do not echo, printf or export the key
  on the command line: the repository's rule is that it never reaches shell
  history. The Encoding key is rejected by name — it is the one containing `%` escapes.
  The retired `PUBLIC_DATA_SERVICE_KEY` still works for local runs but is ignored
  on Vercel; rename it. Keep one copy of the key, not two: a value exported in
  the shell beats `.env.local`, because Node's `--env-file` does not overwrite a
  variable that is already set.
- A route, a direction, and a boarding and destination stop sequence. The
  capture tool is route-generic — it takes any official `routeId` and
  `cityCode` — so ride whatever is convenient, provided it passes the preflight
  below.

  Route 365's `JEB405136521` (제주대학교 → 제주한라대학교) and `JEB405136522`
  (제주한라대학교 → 제주대학교) on `cityCode` 39 are the **recommended
  baseline**: their ordered topology and live vehicles are already verified
  against production, so a capture on them reads against a known reference.
  Recommended, not required. Do not take a first ride on a route whose topology
  or direction is unclear.
- A phone or laptop that can run Node 22.18+ during the ride.

### Option A — from a phone (no laptop)

Open `https://tapso-api.vercel.app/ride-capture/` in Safari, enter the operator
token when asked, and follow the screens: preflight, ready, tap the bus you
boarded, tap the stops where it actually halted, `하차`, `캡처 종료`, then export
the sanitized report. The whole procedure and its limits are in
`RIDE_CAPTURE_CONTROLLER.md`. This needs `RIDE_CAPTURE_OPERATOR_TOKEN` set on the
`tapso-api` Vercel project; without it the operator endpoints stay disabled.

Keep the screen on and the page in front. iOS suspends a backgrounded tab, which
stops collection — the controller records the gap honestly but cannot prevent it.

### Option B — from a laptop (the reference implementation)

```bash
# 1. Preflight against live TAGO before boarding. Production serves the same
#    data and needs no local key. Substitute your own route number and routeId;
#    Route 365 and JEB405136521 are the recommended baseline.
curl -s 'https://tapso-api.vercel.app/v1/cities'                                  # confirm the cityCode
curl -s 'https://tapso-api.vercel.app/v1/routes?cityCode=39&routeNo=365'          # list every official variant
curl -s 'https://tapso-api.vercel.app/v1/stops?routeId=JEB405136521&cityCode=39'  # ordered topology
curl -s 'https://tapso-api.vercel.app/v1/vehicles?routeId=JEB405136521&cityCode=39'
#    All four must answer, the stop sequence must be contiguous, your boarding
#    and destination sequences must exist on it in that order, and the vehicles
#    response must be non-empty so the physical bus can be cross-checked. A
#    route number covers several variants with different topologies: pick one
#    exact routeId and one direction, and ride that.

# 2. Capture the ride. Raw snapshots stay in ignored work/rides/.
env -u TAGO_SERVICE_KEY node --env-file=.env.local \
  --experimental-strip-types scripts/ride-capture/capture.ts \
  JEB405136521 39 <boarding-seq> <destination-seq>

# 3. Produce the sanitized report. The capture already writes one at exit; this
#    re-runs the analysis on the raw file, which is also how a later analyzer
#    improvement is applied to an old ride.
node --experimental-strip-types scripts/ride-capture/analyze.ts \
  work/rides/<capture>.json
```

The capture prints a briefing before its first poll: the direction with both
endpoint names, the boarding and destination stops by name, and every stop
number between them. That list is what the `p` command takes.

While riding, five actions are enough:

1. Board the bus.
2. `b <last 4 characters of the plate>` — the number is cross-checked against
   the vehicles the route is reporting. A unique match is confirmed with its
   current stop; an ambiguous one is refused so you can type more characters;
   an unmatched one is recorded verbatim with a warning. Use `v` first to see
   what the route is reporting.
3. `p <stop-seq>` when the bus actually halts and the doors open — roughly every
   third or fourth stop, aiming for eight to ten markers. Certainty matters more
   than count: a guessed marker corrupts the lag distribution.
4. `n <note>` for anything unusual.
5. `a` at the destination, then `q`. `s` shows elapsed time, snapshot counts and
   the tracked bus at any point.

Never switch the tracked vehicle silently, never `git add` anything under
`work/`, and send back only the sanitized `.report.json` — never the raw
capture, which holds real vehicle numbers. Identity is the exact `routeId`, which
the capture and the report both record; a route number alone is not identity.

Once the first ride is analysed, repeat the capture on a different route. That
is how the tooling and any freshness rule are shown not to be fitted to Route
365.

Then define and test a TAGO freshness rule from `freshnessEvidence` and
`tracked.markerComparisons` before anything enables journey-session matching or
progress. That is Task C. See `DATA_VALIDATION.md`,
`exec-plans/TASK_C_SOURCE_FRESHNESS.md` and `exec-plans/RIDE_CAPTURE.md`.

Task C has shipped the mechanism — a server-observed cadence surrogate, a
shadow-mode rollout gate, and tests — but not the evidence. Its thresholds are
`PROVISIONAL` and automatic matching is off by default everywhere
(`TRANSIT_AUTOMATIC_MATCHING_ENABLED=false`). ~~A clean ride capture is still the
thing that moves it forward.~~ Historical: see the note at the top of this section.

## Other open evidence

1. ~~Smoke test production.~~ Done 2026-09-12: `https://tapso-api.vercel.app`
   verified end to end, including live TAGO. See `PRODUCTION_TRANSIT_API.md`.
   Once merged, the scheduled production smoke in
   `.github/workflows/matcher-evidence.yml` repeats it, matching posture
   included.
2. Add route setup and ambiguity confirmation UI before calling the client MVP complete.
3. Provision Apple credentials and replace the APNs scaffold.
4. Execute `DEVICE_TEST_PLAN.md` on signed hardware. The release gate needs only
   its Live Activity check (criterion BA-5), and only for
   `READY_FOR_BOUNDED_AUTOMATION`; that is a device check, not a bus ride.
5. Follow `TESTFLIGHT.md` for the deterministic internal-beta release path and its explicit reality boundary.

## Repository hygiene

Secrets must remain outside Git. Keep the checked-in `.xcodeproj` synchronized with `project.yml`, and increment the build number before every App Store Connect upload.

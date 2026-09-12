> TAGO migration: complete and merged. Current provider setup and evidence are in `DATA_SOURCES.md`, `DATA_VALIDATION.md`, and `exec-plans/TAGO_MIGRATION.md`. Earlier B551982 instructions are historical.

# Handoff

For the release-focused Claude Desktop/Claude Code continuation, use `docs/CLAUDE_DESKTOP_HANDOFF.md`. The Apple team identity is now resolved: the only team available to the build host is a free Personal Team, so TestFlight distribution is gated on obtaining a paid Apple Developer Program membership. See `KNOWN_ISSUES.md` and the Team prerequisite in `TESTFLIGHT.md`.

## What works

- `packages/transit-core`: deterministic Swift matching, route progress, freshness, journey state, and demo fixtures.
- `apps/ios`: generated native Xcode project, SwiftUI demo, ActivityKit lifecycle, WidgetKit Lock Screen/Dynamic Island extension, localization, and iOS tests.
- `services/api`: the TAGO adapter boundary, one shared request handler with a local Node transport and a Vercel Functions transport, route caching, conservative matching, credential validation, timeouts, the APNs interface, and Node tests.
- `fixtures/transit`: synthetic scenario manifest and official-shaped adapter payload.

## Reproduce

```bash
swift test --package-path packages/transit-core
npm test --prefix services/api
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

If the repository is in an iCloud/FileProvider location, choose **Keep Downloaded** and put DerivedData under `/tmp` or another unsynced local directory. Signing can fail when copied resource forks or Finder metadata reach the `.app`; use a content-only copy if necessary.

## Task B: controlled real-ride validation

This is the next evidence gate. It runs entirely against the local machine and
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
progress. That is Task C. See `DATA_VALIDATION.md` and
`exec-plans/RIDE_CAPTURE.md`.

## Other open evidence

1. ~~Smoke test production.~~ Done 2026-09-12: `https://tapso-api.vercel.app`
   verified end to end, including live TAGO. See `PRODUCTION_TRANSIT_API.md`.
2. Add route setup and ambiguity confirmation UI before calling the client MVP complete.
3. Provision Apple credentials and replace the APNs scaffold.
4. Execute `DEVICE_TEST_PLAN.md` on signed hardware.
5. Follow `TESTFLIGHT.md` for the deterministic internal-beta release path and its explicit reality boundary.

## Repository hygiene

Secrets must remain outside Git. Keep the checked-in `.xcodeproj` synchronized with `project.yml`, and increment the build number before every App Store Connect upload.

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

## Task B: controlled Route 365 ride validation

This is the next evidence gate. It runs entirely against the local machine and
does **not** depend on a deployed API.

Prerequisites:

- A Public Data Portal **Decoding** key in an ignored `.env.local` with
  permissions `0600`, as `TAGO_SERVICE_KEY`. The Encoding key is rejected. The
  retired `PUBLIC_DATA_SERVICE_KEY` still works for local runs but is ignored on
  Vercel; rename it.
- A boarding and destination stop sequence chosen from one verified full-length
  direction: `JEB405136521` (제주대학교 → 제주한라대학교) or `JEB405136522`
  (제주한라대학교 → 제주대학교), `cityCode` 39.
- A phone or laptop that can run Node 22.18+ during the ride.

```bash
# 1. Confirm the identifiers against live TAGO before boarding.
env -u TAGO_SERVICE_KEY node --env-file=.env.local \
  --experimental-strip-types services/api/src/server.ts &
curl -s 'http://127.0.0.1:8787/v1/routes?cityCode=39&routeNo=365'
curl -s 'http://127.0.0.1:8787/v1/stops?routeId=JEB405136521&cityCode=39'

# 2. Capture the ride. Raw snapshots stay in ignored work/rides/.
#    Commands while running: b <vehicleno> | p <stop-seq> | a [stop-seq] | n <note> | q
env -u TAGO_SERVICE_KEY node --env-file=.env.local \
  --experimental-strip-types scripts/ride-capture/capture.ts \
  JEB405136521 39 <boarding-seq> <destination-seq>

# 3. Produce the sanitized report.
node --experimental-strip-types scripts/ride-capture/analyze.ts \
  work/rides/<capture>.json
```

Then define and test a TAGO freshness rule from `freshnessEvidence` and
`tracked.markerComparisons` before anything enables journey-session matching or
progress. See `DATA_VALIDATION.md` and `exec-plans/RIDE_CAPTURE.md`.

## Other open evidence

1. ~~Smoke test production.~~ Done 2026-09-12: `https://tapso-api.vercel.app`
   verified end to end, including live TAGO. See `PRODUCTION_TRANSIT_API.md`.
2. Add route setup and ambiguity confirmation UI before calling the client MVP complete.
3. Provision Apple credentials and replace the APNs scaffold.
4. Execute `DEVICE_TEST_PLAN.md` on signed hardware.
5. Follow `TESTFLIGHT.md` for the deterministic internal-beta release path and its explicit reality boundary.

## Repository hygiene

Secrets must remain outside Git. Keep the checked-in `.xcodeproj` synchronized with `project.yml`, and increment the build number before every App Store Connect upload.

> TAGO migration: current provider setup and evidence are in `DATA_SOURCES.md`, `DATA_VALIDATION.md`, and `exec-plans/TAGO_MIGRATION.md`. Earlier B551982 instructions below are historical.

# Handoff

For the release-focused Claude Desktop/Claude Code continuation, use `docs/CLAUDE_DESKTOP_HANDOFF.md`. The Apple team identity is now resolved: the only team available to the build host is a free Personal Team, so TestFlight distribution is gated on obtaining a paid Apple Developer Program membership. See `KNOWN_ISSUES.md` and the Team prerequisite in `TESTFLIGHT.md`.

## What works

- `packages/transit-core`: deterministic Swift matching, route progress, freshness, journey state, and demo fixtures.
- `apps/ios`: generated native Xcode project, SwiftUI demo, ActivityKit lifecycle, WidgetKit Lock Screen/Dynamic Island extension, localization, and iOS tests.
- `services/api`: official adapter boundary, conservative matching endpoint, credential validation, timeout, APNs interface, and Node tests.
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

## Required next evidence

1. Set `PUBLIC_DATA_SERVICE_KEY` locally and run the transit spike for official route IDs.
2. Fill the unknowns in `DATA_VALIDATION.md`; do not tune against the synthetic fixture alone.
3. Connect `MockTransitProvider` and the official adapter to production cached polling/session orchestration.
4. Add route setup and ambiguity confirmation UI before calling the client MVP complete.
5. Provision Apple credentials and replace the APNs scaffold.
6. Execute `DEVICE_TEST_PLAN.md` on signed hardware.
7. Follow `TESTFLIGHT.md` for the deterministic internal-beta release path and its explicit reality boundary.

## Repository hygiene

Secrets must remain outside Git. Keep the checked-in `.xcodeproj` synchronized with `project.yml`, and increment the build number before every App Store Connect upload.

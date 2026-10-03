# ExecPlan: screenshot route import (V1)

## Outcome and non-goals

A rider can pick a screenshot of a map app's bus route; TAPSO reads it on the device,
verifies it against TAPSO's own route data, shows what it found, and starts the existing
live setup after the rider confirms. Link/paste import stays, as a peer.

Non-goals (V1): photographs of bus-stop signs; a server or multimodal interpreter; Share
Extension image support; analytics (none exists); changing the matcher or live-ride logic.

## Constraints (labels)

- `VERIFIED` (repository): TAPSO's API has no stop search; routes are found by number (`TapsoAPIClient.routes(number:)`) and stops by `routeId`. `TransitRoute.live` builds the route; the live setup (`chooseLiveStops`) is the one way into a vehicle check.
- `VERIFIED` (repository): deployment target iOS 17.0, Swift 6, SwiftPM package `TapsoTransit`.
- `ASSUMED`: `VNRecognizeTextRequest` (accurate) reads Korean on iOS 17+ (Apple added Korean in iOS 16). The app filters the languages by `supportedRecognitionLanguages()` and the Vision test skips where `ko-KR` is absent. Not run in this session.
- `ASSUMED`: `PhotosPicker` with `.screenshots` needs no library permission (Apple documents out-of-process picking). Not run on a device.

## Milestones

1. Core: normaliser, extractor, `StopNameSimilarity`, `RouteImportResolver`, importer, interfaces. Done when `swift test` covers the cases in `SCREENSHOT_IMPORT_V1.md`.
2. App: Vision recogniser, API-backed route catalog, model state, screens, copy. Done when `ScreenshotImportFlowTests` pass in the simulator.
3. Docs, device test cases, known issues.
4. Device check by the owner (cases 17–20). Not done.

## Decisions

- Resolve against routes fetched by bus number, not a local stop index: the data is the server's and changes; a stale local index would break "TAPSO's data is the authority".
- Only bus numbers leave the device; a screenshot never does.
- Confirmation always: the high-confidence path still needs the tap. A list row's tap is the rider's choice and shows boarding, destination and stop count.
- Destination-only results are allowed (the rider picks the boarding stop on the existing stop list, with the screenshot's stop offered as the destination).
- Alternatives rejected: a Core ML / LLM matcher (no need, non-deterministic); persisting screenshots for retry (violates "do not store"); a Share Extension now (cannot be exercised without Xcode, see product doc).

## Evidence

The code was written in a Linux session with no Swift toolchain, then verified by CI on PR #102 (head `7efccdd`, 2026-10-03): `transit-core` (`swift test`), `ios` (`xcodebuild` build and test, including `ScreenshotImportFlowTests`), `api`, `web` and `matcher-evidence` all succeeded, and the PR merged as `d7d89e5`.

Also run before merge: `check_localization.py`, `sync_xcodeproj.py --check`, web tests, typecheck and build.

Not verified: the Vision test is skipped where the runtime lacks `ko-KR` (CI's log says whether it ran); no real KakaoMap, NAVER Map or Apple Maps screenshot; nothing on a device.

## Next action

Check whether the Vision test ran or skipped in the `ios` CI log, then run `DEVICE_TEST_PLAN.md` cases 17–20 with real screenshots from the three map apps. Then: Share Extension images (store a `ScreenshotReading` in the App Group inbox), real-screenshot fixtures sanitised by the owner, and an alias table if a source for stop aliases is found.

## Follow-up: Share Extension images (2026-10-03)

Done in PR `claude/share-extension-images`: image activation rule, Vision in the extension, `ScreenshotReading` through `HandoffInbox`, app-side `receiveScreenshotReading`. Same CI verification as above applies; device case 21 is open.

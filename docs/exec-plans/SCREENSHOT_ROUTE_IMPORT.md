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

Environment of the authoring session: Linux, no Swift toolchain, no Xcode, no network route to `download.swift.org`. **Swift code was written and syntax-checked (tree-sitter) but not compiled or run in this session.** The checks that did run:

- `python3 scripts/ios/check_localization.py`: ok.
- `python3 scripts/ios/sync_xcodeproj.py --check`: ok.
- Syntax parse of every new Swift file: no errors.
- Expected values in the tests were derived by tracing the algorithm by hand against the fixtures.

Not run here (CI and the owner's Mac must): `swift test --package-path packages/transit-core`, the `xcodebuild … build test` command in `AGENTS.md`.

## Next action

Run the verification commands in `AGENTS.md` on a Mac, fix whatever the compiler and tests report, then run `DEVICE_TEST_PLAN.md` cases 17–20 with real screenshots from the three map apps. Then: Share Extension images (store a `ScreenshotReading` in the App Group inbox), real-screenshot fixtures sanitised by the owner, and an alias table if a source for stop aliases is found.

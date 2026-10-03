# Screenshot route import V1

A rider screenshots a bus route in KakaoMap, NAVER Map or Apple Maps, opens TAPSO,
picks the screenshot, confirms the route TAPSO found, and the ride starts exactly as
if they had chosen the bus and stops by hand. It exists because a map app version
or context may offer no share action and no link TAPSO can read.

**A screenshot is untrusted input. So is its OCR text. TAPSO's own route and stop
data is the only authority.** Nothing starts from OCR output: a route is offered
only if it exists in the data TAPSO fetched, the stops fit it in a direction that
works, and the rider confirms.

## What existed before (audit, 2026-10-03)

| Piece | Where |
|---|---|
| Import screen ("지도 앱에서 가져오기") | `apps/ios/TapsoApp/SetupViews.swift` (`MapImportView`, `MapImportContent`) |
| Home card | `HomeView.swift` (`MapHandoffIntakeCard`) |
| Paste (system `PasteButton`, no clipboard read without a tap) | `MapImportView` → `TapsoAppModel.importSharedText` → `SharedPlaceParser` |
| Share extension (text and one web URL only, no images) | `apps/ios/ShareExtension`, hands a parsed `SharedPlace` over via `HandoffInbox` (App Group) |
| Shared place → live setup | `TapsoAppModel.continueWithLiveRoute` → `.liveRoutes` (bus number) → `.liveStops` (stop list) → `chooseLiveStops` → vehicle check |
| Real route data | `TapsoAPIClient.routes(number:)` and `.stops(routeID:)`, built into `TransitRoute` by `TransitRoute.live` |
| Stop-name matching | `StopNameMatcher` (`DemoCatalog.swift`): normalise and substring only |
| Photos, Vision, analytics | none |

There is no stop-name search in TAPSO's API. A route is found by bus number, so a
screenshot import has to start from the bus number and verify stops on that route.

## Flow

```text
PhotosPicker (.screenshots, no library permission)
  → Data in memory                                        [app]
  → VisionScreenshotTextRecognizer (VNRecognizeTextRequest, accurate, ko-KR + en-US, on device)
  → ScreenshotTextNormalizer      chrome, arrows, full-width, whitespace          [core]
  → TransitEntityExtractor        bus-number candidates, stop-like lines, 출발/도착 labels
  → RouteImportCandidateSource    GET /v1/routes?routeNo=N, GET /v1/stops?routeId=…   (bus numbers only)
  → RouteImportResolver           match stops, check order and direction, score        [core]
  → RouteImportResult             .confirmed | .choose([…]) | .notFound(reason)
  → confirmation UI               rider taps "이 경로로 시작"
  → chooseLiveStops(…)            the existing live setup and vehicle check
```

The core (`packages/transit-core/Sources/TapsoTransit/ScreenshotImport/`) is Foundation
only: no Vision, no SwiftUI, no network. The Vision recogniser and the API-backed
route source live in the app target behind two protocols
(`ScreenshotTextRecognizer`, `RouteImportCandidateSource`).

## Matching rules

**Bus numbers.** 2–4 character tokens of digits, with `O`/`o`→`0` and `I`/`l`→`1` fixed when at
least two real digits remain (`44O` → `440`, flagged `wasCorrected`). Times (`9:41`),
distances, fares, minutes, `3번 출구` and decimals are not numbers. At most four are tried,
ranked by context (`440번`, `버스 440`), length and OCR confidence. A corrected number
only counts if a route of that number exists *and* stops fit it.

**Stops** (`StopNameSimilarity`, deterministic):
- spacing, punctuation, case ignored (`국립제주 트라우마 치유센터`);
- a `(…방면)` qualifier and a trailing `정류장`/`방면` set aside, with a penalty when the
  qualifiers differ (0.9) or only one side has one (0.97);
- Hangul compared as jamo, so `센타` is one edit from `센터`; allowed edits scale with
  length: names under 10 jamo (≈ 4 syllables) must match exactly, 10–17 allow one edit,
  18+ allow two. `제주시장` never matches `제주시청`;
- a line wrapping a whole stop name of four or more syllables is accepted at 0.85;
- an alias table is supported and empty: an alias is data and needs a source.

**Direction.** Direction is never inferred from the bus number alone.
- Every stop line is matched to the stops of each variant of that number. No matched
  stop, no proposal.
- Two or more matched stops must appear in the variant in the order the screenshot lists
  them (longest ordered chain). A variant that runs the other way is rejected, and its
  sibling direction can still fit. One line out of order is tolerated at a cost and never
  confirmed. More than one is rejected.
- One matched stop is a place to get off: it cannot be a variant's first stop, and a stop
  labelled `출발` is no use alone. The rider chooses the boarding stop.
- A stop that appears twice (loop) lists both visits unless an earlier stop disambiguates.

**Confidence** (internal; the UI shows a confirmation, a short list, or "not found"):

| | When | UI |
|---|---|---|
| high | one bus number; one survivor within 15 points of the best; ordered stops, or a single uncorrected stop at similarity ≥ 0.95; mean OCR confidence ≥ 0.5 | confirmation |
| medium | several survivors, survivors on different bus numbers, a corrected number without ordered stops, partially ordered stops, or OCR confidence 0.2–0.5 | up to three candidates (one candidate shows as a confirmation) |
| low | no text, OCR confidence < 0.2, no bus number, no TAPSO route for the number, no stop fits, route data unavailable | explanation, choose another photo or search |

Points: bus number 40 (30 if corrected), ≈10 per matched stop (best five), +20 for fully
ordered stops (−15 if one line disagreed), +5 when the destination is the variant's
terminus, +10 for a stop labelled `도착`, −10 when labels disagree with the order. Offered
from 50. The scale is internal and may change; tests assert behaviour, not points.

The stop count is `destination.sequence − boarding.sequence` from TAPSO's data, never read
from the screenshot.

## Privacy

| Fact | Status |
|---|---|
| The screenshot is read with Vision on the device. It is decoded from memory, downscaled, read and dropped; never written to disk, never uploaded, never in analytics. | by construction (`VisionScreenshotTextRecognizer`) |
| `PhotosPicker` runs out of process and returns only the chosen photo: no photo-library permission, no `NSPhotoLibraryUsageDescription`. | Apple documentation: PhotosPicker needs no library authorisation (`UNVERIFIED` on a device here) |
| The only network traffic is TAPSO's own API: the bus number(s) read (`routeNo`), then `routeId` per variant. No OCR text, no stop name, no image. | `ScreenshotImportFlowTests.testOnlyTheBusNumberLeavesTheDevice` |
| TAPSO has no analytics SDK or event pipeline, so none was added. Any future event must carry counts and outcomes only, never pixels or OCR text. | repository audit |
| A remote interpreter is *not* implemented. Sending a screenshot off the device needs an explicit privacy review first. | design |

## Deleting the original (rider's choice)

TAPSO stores no screenshot, so there is nothing of its own to delete. Under a result, the screen says
"사진은 저장하지 않았어요. 원본은 사진 앱에 그대로 있어요." and, for a photo picked in TAPSO, offers
"사진 앱에서 이 스크린샷 삭제". Only then does TAPSO ask for photo-library access (`PHPhotoLibrary`
`.readWrite`; `NSPhotoLibraryUsageDescription`), never at launch and never for picking a photo, and iOS asks
the rider to confirm the deletion; the photo goes to "Recently Deleted". Cancelling either step changes nothing.

- The picker is created with `photoLibrary: .shared()` so it reports the photo's identifier; the identifier is kept
  in memory for this one action and dropped with the result.
- A screenshot shared from Photos to the extension has no identifier: no delete button there.
- Under a "selected photos" grant Photos may not show TAPSO the photo: the screen says it could not delete and to
  delete it in Photos, never that it succeeded. Behaviour under "Limited" access is `UNVERIFIED` on a device.
- Once granted, the access is a standing full-library read/write grant. That is the cost; it is why the ask is deferred.

## Extension point

`RouteScreenshotInterpreter` turns an image into a `ScreenshotReading` (bus-number and
stop-name claims, `Codable`). `LocalVisionRouteInterpreter` is the only implementation.
A future `RemoteMultimodalRouteInterpreter` would return the same type and go through the
same `RouteImportResolver`: no interpreter's output becomes a route without TAPSO's data
agreeing (`testARemoteStyleInterpreterIsValidatedLikeAnyOther`).

## Share extension (Photos → Share → TAPSO)

The share extension accepts one image (`NSExtensionActivationSupportsImageWithMaxCount`). It reads
the image on the device with the same Vision recogniser (downscaled to 2,000 px, an extension has far
less memory than the app) and `LocalVisionRouteInterpreter`, and shows what it read: the bus numbers
and how many lines may name a stop. If there is no bus number or no stop-like line it says so and saves
nothing (`ScreenshotReading.isUsable`).

"탑서에 남기기" stores the `ScreenshotReading`, never the image, in the App Group inbox
(`HandoffInbox.put(_:at:)`): one thing at a time (a reading replaces a waiting place and the other way
round), read once, 30 minutes. A share extension cannot open its app, so the app takes it the next time
it becomes active (`collectHandoff` → `receiveScreenshotReading`), opens the import screen and checks
the reading against TAPSO's routes exactly like a picked screenshot: `ScreenshotRouteImporter.importRoute(from:)`,
at most four bus numbers looked up however large the reading is. The rider still confirms.
The extension never touches the network. Without the App Group (an unsigned build) it says to pick the
screenshot in TAPSO instead.

What the inbox holds is text read from the picture (bus numbers and stop-like lines), in the App Group's
`UserDefaults` for at most 30 minutes or until the app takes it.

## Verification

| Check | Result |
|---|---|
| `swift test --package-path packages/transit-core` (`ScreenshotImportTests`, `RouteImportResolverTests`) | passed in CI, PR #102 |
| `ScreenshotImportFlowTests` (app model with a stubbed transit API; Vision on rendered light and dark screens) | passed in CI, PR #102 (the Vision test skips without `ko-KR`) |
| Real KakaoMap / NAVER Map / Apple Maps screenshots | `UNVERIFIED`: none committed or run. Fixtures are SYNTHETIC OCR transcripts shaped like each app's route view |
| iPhone | `UNVERIFIED`: `DEVICE_TEST_PLAN.md` cases 17–22 |

Every fixture is labelled SYNTHETIC. Stop names in them come from the feature brief for
readability; their order, sequences, ids and coordinates are invented, so they prove
nothing about Jeju's real network.

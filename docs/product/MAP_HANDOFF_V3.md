# Map hand-off V3 (`V2.2`)

A rider plans in KakaoMap, NAVER Map or Apple Maps, then hands the place to
TAPSO. TAPSO reads it on the phone, asks which bus they take, suggests the stop
nearest the place on that route, follows the bus, and at the end hands the walk
back to a map app — toward the place, not just the stop. Supersedes the inbound
half of `MAP_APP_HANDOFF_V2.md`; its evidence section still holds.

```text
Map app ── Share ─┬─ TAPSO share extension: read on the phone ─ App Group (one place, 30 min, read once)
                  └─ Copy ─ TAPSO › 지도 앱에서 가져오기 › 붙여넣기
                                   │
TAPSO  SharedPlaceCard: name · address · 위치 확인됨 · 제주 / 제주 밖 / 링크만
                                   │  "이곳으로 가는 버스를 타세요?" → bus number (live) or a demo stop
TAPSO  stop list: "협재해수욕장 근처 정류장" — nearest stops after boarding, straight-line metres
                                   │  rider confirms the bus; server follows it (LIVE_JOURNEY_V3.md)
TAPSO  end: "협재해수욕장까지 걸어서" → NAVER route/walk · KakaoMap route by=FOOT · Apple Maps
```

## What TAPSO reads, and the basis for each shape

| Input | Example shape | Read as | Label |
|---|---|---|---|
| Apple Maps legacy link | `maps.apple.com/?q=<name>&ll=<lat>,<lng>`, `address=`, `daddr=` | name, coordinate, address | `VERIFIED` (Apple Map Links reference) |
| Apple Maps unified link | `/place?coordinate=&name=&address=`, `/directions?destination=`, `/search?query=` | name, coordinate | `VERIFIED` (developer.apple.com › MapKit › Unified Map URLs: `destination` takes "an address, coordinate, or a place name") |
| `geo:` URI | `geo:<lat>,<lng>` | coordinate | RFC 5870 |
| NAVER Map scheme | `nmap://place?lat=&lng=&name=`, `nmap://search?query=`, `nmap://route/*?dlat=&dlng=&dname=` | name, coordinate | `REPORTED-OFFICIAL` (NAVER Cloud URL scheme guide) |
| KakaoMap scheme | `kakaomap://route?ep=<lat>,<lng>` | coordinate | `REPORTED-OFFICIAL` (Kakao URL scheme guide) |
| Kakao Maps web link | `map.kakao.com/link/map|to/<name>,<lat>,<lng>`, `/link/search/<query>` | name, coordinate | `REPORTED` (Kakao Maps web guide; this environment cannot reach it, so `scripts/data-sources/tago-docs.ts` quotes it from a GitHub runner) |
| Share text | `[카카오맵] <name>` / `[네이버 지도] <name>`, an address line, a short link | name, address | `REPORTED` — formats observed in public descriptions, not captured from a device |
| Short links | `kko.to/…`, `naver.me/…`, `place.map.kakao.com/…`, NAVER place pages | kept as `unresolvedLink` | never fetched (see below) |
| Plain text | a place name, a Jeju road or lot address, `lat, lng` (either order) | name, address, coordinate | parser rules |

`SharedPlaceParser` (`packages/transit-core/Sources/TapsoTransit/SharedPlace.swift`)
is pure Swift with no network request. A short link that only the network could
resolve is shown as "링크만 받았어요": resolving it would mean fetching a page on
the phone (forbidden by `crossLanguageAuthority.test.ts`) and undocumented
scraping. Unrecognised shapes produce nothing rather than a guess.

Jeju only: `JejuRegion` (latitude 33.0–34.1, longitude 126.0–127.1; Udo, Gapado,
Marado and the Chuja islands inside). A place outside it says "제주 밖 장소예요"
and never becomes a destination.

## The share extension (`apps/ios/ShareExtension`)

| Fact | Label |
|---|---|
| Activation: `NSExtensionActivationSupportsText`, `NSExtensionActivationSupportsWebURLWithMaxCount = 1` ("the maximum number of HTTP URLs") | `VERIFIED` (Information Property List reference) |
| `NSExtensionPrincipalClass` names the controller; mutually exclusive with a storyboard | `VERIFIED` |
| A share extension cannot open its containing app: "In iOS, the Today and iMessage app extension points support" `NSExtensionContext.open` | `VERIFIED` |
| App Groups are available to a free Apple Developer account (Personal Team), as well as ADP and ADEP | `VERIFIED` (Account Help › Supported capabilities (iOS), 2026-10-01). Push notifications are not |
| `NSItemProvider.loadTransferable(type:completionHandler:)` takes a `@Sendable` handler; `NSItemProvider` is not `Sendable` | `VERIFIED` (Foundation reference) |

So the extension parses what it receives, shows what it read, and on "탑서에 남기기"
stores the parsed `SharedPlace` — never the raw text — in the App Group
`group.com.lucanomics.tapso` (`HandoffInbox`). The app takes it the next time it
becomes active, once; an entry older than 30 minutes, or dated in the future, is
discarded. Where the App Group is not provisioned (`containerURL` is `nil`), the
extension offers "복사하기" instead: the rider's own copy, pasted in TAPSO.

## Where to get off (`HandoffStopSuggester`)

Suggestions only; the rider chooses.

- Coordinates are compared only when both are real: the place's came from the
  rider's map app, the stops' from TAGO (`coordinatesAreSurveyed`). Demo stop
  coordinates are synthetic and never produce a "nearby" suggestion.
- Nearby = within 1,000 m in a straight line (`ASSUMED`, roughly 15 minutes'
  walk once streets bend the line), nearest first, at most three, each stop once
  even on a loop. The distance is labelled "직선 320 m"; TAPSO has no walking
  network, so no surface converts it into minutes.
- When both coordinates are real they decide: a route that passes nowhere near
  the place shows "이 방향으로는 1000 m 안에 정류장이 없어요" — the common cause is
  the opposite direction — rather than a far-away name match.
- Without real coordinates, a stop is suggested only when its whole name appears
  in the place's name. Addresses are never matched word by word.

## The journey it creates

`HandoffJourney.segments` gives the Journey Contract (`JOURNEY_CONTRACT_V3.md`)
shape: one `ride`, then a last-mile `walk` whose distance stays unmeasured.
`RideDraft.finalPlace` carries the place with the ride (on the device, with the
active ride only — not in the saved-journey history), and `RideOutcome.place`
hands it to the end screen.

## The walk after the bus

| App | Request | Basis |
|---|---|---|
| NAVER Map | `nmap://route/walk?dlat=&dlng=&dname=&appname=com.lucanomics.tapso`; a name-only place gets `nmap://search?query=` | `REPORTED-OFFICIAL` |
| KakaoMap | `kakaomap://route?ep=<lat>,<lng>&by=FOOT`; not offered without a coordinate (no documented app-scheme keyword search) | `REPORTED-OFFICIAL` |
| Apple Maps | `MKMapItem.openInMaps()` on the place: shows it, asks for no directions mode | MapKit API (`VERIFIED`). Walking directions in Korea are `UNVERIFIED`: secondary sources describe them as partial; Apple's feature-availability page could not be read from this environment (`www.apple.com` is blocked by its egress policy) |

A place's coordinate came from the rider's map app, so the walk can go there
even after a demo ride, whose own stop coordinates stay synthetic. Without a
shared place the end screen keeps the V2 behaviour, and now also offers KakaoMap
and Apple Maps when a live ride's stop coordinates are surveyed.

## Privacy

- Parsing happens on the phone; links are never opened; nothing about the place
  is sent to TAPSO's API (`testALiveRideFromASharedPlaceSuggestsItsNearestStopAndWalksThere`
  asserts no request URL or body carries it).
- The App Group holds one parsed place for at most 30 minutes and deletes it when
  read. No clipboard is read without the rider's tap (`PasteButton`); the
  extension writes to the clipboard only when the rider taps "복사하기".

## Tests

| Where | What |
|---|---|
| `SharedPlaceTests` (core) | every input shape above, coordinate order, Jeju bounds, link-only, the inbox's once / expiry / future-date rules |
| `HandoffDestinationTests` (core) | nearest-first suggestions with rounded metres, loops, no far name match, synthetic coordinates fall back to names, no address matching, outside Jeju, the Journey Contract shape, the hand-off URLs |
| `MapHandoffFlowTests` (app) | paste → place, inbox collected once, a ride is never interrupted, a demo ride walks to the place, outside-Jeju and link-only never reach a ride, a new setup never inherits the place |
| `TapsoAPIClientTests` (app) | live: shared place → bus 202 → stop 10 suggested at 10 m → confirmed ride → NAVER `route/walk` to the place; the place never reaches the server |

All payloads are synthetic. App test files carry no web links: the network guard
forbids them outside `TapsoAPIClient`.

## Limitations

- No stop or nearby-stop search on the server yet: the rider names the bus. TAGO
  documents `getCrdntPrxmtSttnList` (stops near a coordinate) in
  `BusSttnInfoInqireService` (`REPORTED-OFFICIAL`, data-source probe), but the
  service key's authorization for that dataset is not established; the owner's
  data.go.kr application comes first.
- Share-text formats are reported, not captured: a device check with real
  KakaoMap and NAVER Map shares is in `DEVICE_TEST_PLAN.md`.
- The share extension is built and unit-tested through the shared core in CI;
  the extension itself has not run on a device.

# Map-app hand-off V2

How TAPSO works *with* KakaoMap and NAVER Map instead of replacing them. Researched 2026-09-30; labels as in `COMPETITIVE_POSITIONING_V2.md`. Only integrations with a documented basis are implemented, and the app still makes no network request (`services/api/test/crossLanguageAuthority.test.ts`).

## The flow

```text
KakaoMap / NAVER Map ── choose a route, find the stop or place
        │  Share → Copy (text with the place name and a short link)
        ▼
TAPSO  Home › 지도 앱에서 가져오기 › 붙여넣기 (PasteButton)
        │  stop names found in the text, on the device
        ▼
TAPSO  destination chosen → bus → boarding stop → rider confirms the bus → ride
        │  arrival
        ▼
NAVER Map  "네이버 지도에서 목적지 찾기" (name search) for the walk
```

## Evidence

### iOS platform (all VERIFIED, developer.apple.com)

| Fact | Source |
|---|---|
| `canOpenURL` needs the scheme in `LSApplicationQueriesSchemes`, else it always returns false; limit 50 schemes (25 for apps linked on iOS 27+) | `documentation/uikit/uiapplication/canopenurl(_:)` |
| `open(_:options:completionHandler:)` is **not** constrained by `LSApplicationQueriesSchemes`; it launches the app if installed and reports failure otherwise | same page |
| A Share Extension appears for web URLs through `NSExtensionActivationSupportsWebURLWithMaxCount`; `TRUEPREDICATE` activation rules are rejected at review | `nsextensionactivationsupportsweburlwithmaxcount`; App Extension Programming Guide |
| From iOS 16, programmatic `UIPasteboard` reads show a permission prompt; `UIPasteControl` / SwiftUI `PasteButton` pastes on the user's tap without it | `documentation/uikit/uipastecontrol` |
| App Shortcuts are available at install; `LiveActivityIntent` can start a Live Activity from a shortcut | `documentation/appintents/app-shortcuts`, `liveactivityintent` |

### NAVER Map scheme (REPORTED-OFFICIAL, `guide.ncloud-docs.com/docs/maps-url-scheme`)

- Format `nmap://{action}?{params}&appname={bundle id}`; `appname` required on every call; app version 5+.
- `nmap://search?query=…`, `nmap://route/walk?dlat=…&dlng=…&dname=…` (also `route/public`, `route/car`, `route/bicycle`), `nmap://place?lat=…&lng=…&name=…`, `nmap://search/bus?query=<route number>`.
- No parameter pins a specific bus or boarding stop on `route/public`: NOT FOUND.

### KakaoMap scheme (REPORTED-OFFICIAL, `apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/`)

- `kakaomap://route?sp=lat,lng&ep=lat,lng&by=CAR|PUBLICTRANSIT|FOOT|BICYCLE`; transit takes no waypoints.
- The app-scheme syntax of `search`, `look`, `place` could not be confirmed: UNVERIFIED.
- Developers report `by` being ignored (REPORTED, Kakao DevTalk).
- No bus or boarding-stop parameter: NOT FOUND.

### Share links

- KakaoMap place shares are `kko.to/…` short links; NAVER Map shares are `naver.me/…` or `map.naver.com/p/entry/place/{id}` (REPORTED).
- Resolving a short link needs a network request, and extracting coordinates from KakaoMap's page is undocumented scraping (REPORTED).
- No evidence that any share link carries a bus number or boarding stop: NOT FOUND.

## What is implemented

| Capability | Where | Basis | Limits |
|---|---|---|---|
| **Inbound: paste shared text** | `MapImportView` (`PasteButton`), `StopNameMatcher.matches(in:among:)`, `TapsoAppModel.stopNames(inSharedText:)` | `PasteButton` pastes on tap without the iOS 16 prompt (VERIFIED). The place name is in the shared text; nothing is fetched | Finds only names that match a stop in the catalogue; a bare link finds nothing and the screen says why ("링크만으로는 장소를 알 수 없어요") and offers search. Text is read on the device and not stored |
| **Outbound: walk after the bus** | `MapHandoff.walkingRequest(to:in:coordinatesAreSurveyed:)`, `RideEndView`, passed-destination hero | `open(_:)` needs no `LSApplicationQueriesSchemes` entry (VERIFIED); NAVER scheme actions (REPORTED-OFFICIAL) | Demo stop coordinates are synthetic, so only `nmap://search?query=<stop name>&appname=com.lucanomics.tapso` is offered. A `route/walk` or `kakaomap://route?…&by=FOOT` to invented coordinates would send the rider somewhere wrong; both are built and unit-tested for surveyed stops but unused until real coordinates exist. KakaoMap has no documented app-scheme name search, so it is not offered, and the end screen says so. If NAVER Map is not installed, the app says so rather than failing silently |
| **Repeat without opening Home** | `RideAgainIntent`, `TapsoShortcuts` ("탑서로 다시 타기") | App Shortcuts (VERIFIED) | Opens the app at the vehicle check for the last ride; it does not start a Live Activity directly, because a bus is selected only by the rider's confirmation |

## Not implemented, and why

| Idea | Reason |
|---|---|
| Share Extension target (TAPSO in the map app's share sheet) | Valid (VERIFIED) and the natural next step, but it adds a target, an App Group and signing capabilities that need the paid Apple team (`KNOWN_ISSUES.md` › `BLOCKED_BY_PAID_MEMBERSHIP`). Paste gives the same result with one extra tap today |
| Resolving `kko.to` / `naver.me` links | Needs a network request (forbidden in the app) and undocumented scraping; must live on the server if ever built |
| Reading the clipboard automatically | Would trigger the iOS paste prompt and read data the rider did not hand over |
| Handing a bus route to a map app | No documented parameter exists in either app (NOT FOUND) |
| Apple Maps hand-off | No transit in Korea (REPORTED); MapKit hand-off also needs coordinates, which are synthetic here |

## When real data arrives

1. Stop coordinates from TAGO are surveyed: switch `coordinatesAreSurveyed` to true for real stops, which enables NAVER `route/walk` and KakaoMap `route … by=FOOT`.
2. Match pasted place names against the server's stop search instead of the demo catalogue.
3. Consider the Share Extension once a paid team can sign App Groups.

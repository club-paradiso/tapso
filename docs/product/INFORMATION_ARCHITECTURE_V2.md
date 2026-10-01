# Information architecture V2

Implemented in `apps/ios/TapsoApp`. Figma: `03 iOS — GO` (node `205:3310`) and `04 iOS — RIDE` (node `157:10`).

## Principle

The rider configures once, trusts what TAPSO says, puts the phone away, and looks again only when TAPSO gives a reason. The app therefore has no tabs, no feed and no map. Four places:

```text
Home ──▶ Setup (pushed) ──▶ Ride (replaces setup) ──▶ End (replaces ride) ──▶ Home
            search › route › boarding › bus check
            map-app intake
```

`TapsoRootView` shows exactly one of Ride, End or the Home navigation stack, so the ride never sits on top of a half-finished setup and nothing is modal over a modal. The only sheet is the demo controls, and its presence is itself temporary (see below).

## Home — "어디서 내릴까요?"

Priority order (`HomeContent`):

1. The question and a search field (opens search; typing happens on the next screen, so Home never raises a keyboard).
2. Recent destinations as chips — one tap starts destination-first setup at that stop.
3. **최근 여정** — the most recent ride with **다시 타기**, which goes straight to the bus check. The star saves it as a favourite.
4. **즐겨찾기** — other favourites, one tap each.
5. **지도 앱에서 가져오기** — paste intake.
6. First run only: **처음이라면** — the sample ride, because the app has no live data.
7. The privacy promise: no location permission.

Not on Home: news, promotions, a map, nearby stops, dashboards.

## Destination-first setup

| Step | Screen | Question | Skipped when |
|---|---|---|---|
| 1 | `DestinationSearchView` | 어디서 내릴까요? | Started from a recent-destination chip or a map paste |
| 2 | `RouteSelectView` | 어떤 버스를 탈까요? | Only one route direction reaches the destination (`TapsoAppModel.chooseDestination`) |
| 3 | `BoardingStopView` | 어디서 타나요? | A recent/favourite ride restarts (the boarding stop is known) |
| 4 | `VehicleCheckView` | 이 버스가 맞나요? | Never — a bus is selected only by the rider |

"출발지" is never used: TAPSO needs the **타는 정류장**, not where the trip began, and says so on the boarding screen. Boarding stops are listed nearest-to-destination first with the stop count to the destination, so the likely one is at the top.

Repeat rider: Home → 다시 타기 → 맞아요 = **two taps** to a tracked ride. New rider: search → stop → (route) → boarding → 맞아요 = four or five.

## Bus check

`VehicleCheckContent` stages from `VehicleCheck.evaluate`:

- **searching** "버스를 찾고 있어요 · 정류장으로 오는 365번을 확인하고 있어요"
- **proposed** "이 버스로 보여요" — plate ending `••0001`, where it is, **맞아요, 이 버스를 탔어요** / **다른 버스예요**
- **similarBuses** "비슷한 버스가 있어요 · 탑승한 버스를 골라주세요" — each bus is a tappable card, plus **둘 다 아니에요**
- **notFoundYet** "아직 오는 버스가 안 보여요" — keeps watching
- **confirmed** — the ride starts

"다른 버스예요" removes that bus and keeps watching; it never switches to another bus silently.

## Ride

`RideView`: route badge and destination in the navigation bar; then

1. a status banner only when something is wrong (delayed, lost, offline, checking);
2. the moment-specific hero (`RideHeroCard`);
3. the two trust badges;
4. the stop ladder (now → next three → destination);
5. a one-line reason the phone can be put away (riding only);
6. **여정 끝내기** (with confirmation) at the bottom, except at arrival where **내렸어요** is the only action.

Demo controls are behind the menu (…) › 체험 설정.

## End

`RideEndView`: "잘 내리셨어요" (or "목적지를 지나쳤어요"), the walk handed to NAVER Map by name, and **홈으로**.

## Recovery paths

| Situation | What the rider sees | Where |
|---|---|---|
| Wrong bus proposed | 다른 버스예요 → keeps watching | Bus check |
| Two similar buses | Pick one, or 둘 다 아니에요 | Bus check |
| Live data late | Banner, dimmed last-known count, no alert | Ride |
| Bus missing from feed | Banner "버스를 잠시 찾지 못했어요 · 추적은 유지하고 있어요" | Ride |
| Phone offline | Banner "인터넷 연결이 끊겼어요 · 연결되면 바로 이어서 추적해요" | Ride |
| Signals disagree | Blue banner "확실해질 때까지 하차 알림은 보내지 않아요" | Ride |
| Passed destination | Coral outline "목적지를 지났어요 · 다음 정류장에서 내려 돌아가세요", NAVER Map search | Ride |
| App relaunched mid-ride | "여정을 이어가요" notice, ride resumes | Ride |
| Live Activities off | Notice: app keeps guiding; where to turn it on | Ride |
| Map app missing | "네이버 지도를 열 수 없어요 · 설치되어 있는지 확인해주세요" | Ride / End |
| Live Activity left by a lost session | Ended at launch | — |

## Permissions

| Permission | Requested | Why |
|---|---|---|
| Location | **Never** | TAPSO tracks the vehicle, not the rider. Nearby stops would be the only use; it is not built, because demo stop coordinates are synthetic. If added, it must be asked in context from a "근처 정류장" action and stay optional |
| Notifications | **Never** | Milestone alerts are Live Activity `AlertConfiguration`s, which need no notification permission |
| Live Activities | No in-app prompt | The rider controls them in Settings (`ActivityAuthorizationInfo`). One starts only after the rider confirms the bus; if they are off, the app says so and keeps guiding in-app |
| Paste | Never prompted | `PasteButton` pastes on the rider's tap |

## First-time experience

No onboarding carousel. The first ride teaches in order: choose where to get off → choose/confirm the bus → TAPSO checks the actual vehicle ("탑서는 확실하지 않으면 버스를 대신 고르지 않아요") → the Lock Screen and Dynamic Island carry the same guidance (in this preview build, while the app stays open; see `KNOWN_ISSUES.md`) → the surfaces escalate as the stop nears.

## Temporary: synthetic data

The app has no data path yet. Search holds two synthetic directions of route 365 (`DemoCatalog`), proposals and rides are scripted (`DemoRideScenario`), and Home carries a "체험판 · 합성 데이터" chip. The demo controls sheet chooses the scenario. These go when the app talks to the journey-session API through a path that keeps matcher authority on the server.

# Competitive positioning V2

Researched 2026-09-30. Labels: **VERIFIED** read on an official primary page; **REPORTED-OFFICIAL** official page seen only through a search summary because this environment's network policy blocked the page (re-check in a browser before relying on it); **REPORTED** secondary source; **NOT FOUND** looked for and not found. Nothing below is copied into TAPSO's visuals: only interaction principles are taken.

## The position in one line

지도 앱은 길을 찾아준다. TAPSO는 실제로 탄 버스를 지켜보고, 내려야 할 때 알려준다.

KakaoMap and NAVER Map answer *how do I get there*. TAPSO answers *which physical bus am I on, how far is my stop, and when do I stand up* — and then lets the rider stop looking at the phone. Its category is a **transit ride companion**: the execution layer after a route has been chosen.

## 지하섬 (Jihaseom)

Sources: `jihaseom.app`, App Store `id6792708146` (both REPORTED-OFFICIAL).

| Area | What it does | Label |
|---|---|---|
| Core | Remaining stations to the destination on the Dynamic Island and Lock Screen, visible while using other apps | REPORTED-OFFICIAL |
| Identity of the train | Server-side tracking of "the train I'm on" from Seoul real-time data; no location permission | REPORTED-OFFICIAL |
| Escalation | Vibrates one station before and on arrival; the one-before alert is shown enlarged | REPORTED-OFFICIAL; mechanism (Live Activity alert vs local notification) NOT FOUND |
| Compact option | Next station name instead of remaining time on the island | REPORTED-OFFICIAL |
| Repeat use | Starred routes restart from home; home/work chips; per-widget stations | REPORTED-OFFICIAL; entry of departure/arrival and a recents list NOT FOUND |
| Transfers, best car | Transfer guidance, quick-transfer / quick-exit car, pick a transfer station mid-ride | REPORTED-OFFICIAL |
| Personality | Themed platform scenes (free and paid) | REPORTED-OFFICIAL; whether it is pixel art UNVERIFIED |
| Complaints | "Off by 1–2 stations"; the developer answered it is correcting segments | REPORTED (App Store reviews) |
| Devices | iPhone 14 Pro+ for the island; Lock Screen otherwise; iOS 18+ | REPORTED-OFFICIAL |

### Lessons (principles, not visuals)

1. **Start in one tap.** Saved routes and home/work chips beat forms. → TAPSO: recent ride "다시 타기", favourites, recent destinations, App Shortcut.
2. **Two escalations are enough, and the one-before must be bigger.** → TAPSO keeps three steps because a bus rider needs time to stand and press the stop button (two stops = prepare), and makes the next stop the loudest surface: the whole Lock Screen turns coral and names the destination.
3. **No location permission is a selling point.** → TAPSO says so on Home ("내 위치 권한은 필요 없어요").
4. **Stop-count drift destroys trust fastest.** Jihaseom's own complaint pattern. → TAPSO's structural answer is below.

### Where TAPSO differs structurally

A subway line has one train per platform direction and fixed stops; identity is easy and drift is the risk. A Jeju bus route has several vehicles, variants and directions sharing streets, and TAGO gives no observation timestamp (`docs/KNOWN_ISSUES.md` › `NO_SOURCE_TIMESTAMP`). So TAPSO cannot copy "departure → arrival" and trust the count. It differentiates by:

- **Physical vehicle identity, confirmed by the rider.** A plate ending (`••0001`) the rider can see on the bus, never a guessed match (`VehicleCheck`).
- **Two separate trust signals.** Vehicle identity and data freshness are shown side by side (`TrustBadge`), so "the right bus, late data" is expressible.
- **Fail-closed escalation.** A get-off alert needs an exact phase/count agreement on fresh, online data; otherwise the surface goes calm and says why (`RideGuidancePolicy`).
- **Destination-first + boarding context**, because a bus rider needs *where to get off, which bus, where it is boarded* — not the trip's origin.
- **Designed recovery**: late data, lost bus, offline, relaunch, passed destination each have their own copy and action.

TAPSO is not "지하섬 for buses": the subway product's hard problem is display and drift; the bus product's is identity and uncertainty.

## KakaoMap and NAVER Map

Neither app, per the vendors' own scheme guides as far as they could be read, exposes a way to hand a *specific bus* or *boarding stop* to another app, and no evidence was found that a shared link carries a bus number or boarding stop in parseable form (NOT FOUND). Full evidence: `MAP_APP_HANDOFF_V2.md`.

What this means for TAPSO:

- Do not rebuild POI search, walking navigation or multimodal planning; the map apps own them.
- Take the one thing a share reliably contains in its text — the place name — and match it to a stop on the device.
- Hand the walk after the bus back to the map app.

## Apple Maps

Apple Maps reportedly offers no public-transit directions in Korea (REPORTED, namu.wiki). Whether it has a get-off alert there: NOT FOUND. It is not a competitor in Jeju today.

## Positioning summary

| | Map apps | 지하섬 | TAPSO |
|---|---|---|---|
| Question answered | How do I get there? | How many stations left? | Which bus am I on, when do I get off, and can I trust that? |
| Vehicle identity | — | Train, server-side | Physical bus, rider-confirmed plate |
| Uncertainty shown | — | Not separated | Vehicle and data signals separate; calm fail-closed states |
| Escalation | — | One-before + arrival | Two stops, next stop, arrival; none on uncertain data |
| Repeat speed | Saved places | Stars, home/work | Recent ride in one tap, favourites, App Shortcut |
| Location permission | Required for most flows | None | None |
| Relation to TAPSO | Complementary: route planning in, walking out | Parallel in another mode | — |

# ExecPlan: Jeju production transit v1

Started 2026-10-03 on `feat/jeju-production-transit-v1`. Living document; update it as work lands. Reality labels as in `docs/DATA_VALIDATION.md`.

## 1. Outcome and non-goals

**Outcome.** On an arbitrary operating Jeju route that was not chosen during development, a rider searches a real destination, finds the real route and the exact variant and direction, picks a real boarding stop, confirms a real bus, rides with the app closed, gets trustworthy remaining-stop guidance and a get-off warning, and can read the route's official timetable where one exists. With no synthetic data, no route-specific code, and no app change per route.

**Non-goals for this slice.** Automatic bus selection beyond demonstrated readiness (the release gate keeps it `READY_FOR_SHADOW`); continuous passenger GPS; interpolated times between published timepoints; any timetable source other than Jeju's own; unattended background location.

## 2. Verified baseline (main `dd6924d`, 2026-10-03, before this work)

| Question | Answer | Evidence |
|---|---|---|
| Why only a tiny subset of routes? | Home's destination-first search, route choice, boarding and the sample ride all read `DemoCatalog`: one synthetic route 365 in two directions, ten stops (`SetupViews.swift`, `TapsoAppModel.chooseDestination`). Real data was reachable only through "버스 번호로 타기", which needs the rider to know the number. | Source audit; `DemoCatalog.swift` |
| What was synthetic? | `DemoCatalog`/`DemoFixtures` routes, stops, plates and scripted ride; the sample card, the always-visible "체험판 · 합성 데이터" chip and demo settings, all reachable in Release (no `#if DEBUG`). Demo copy also showed on live rides (`ride.closeApp`, `check.confirmed.detail`, `handoff.kakao.unavailable`, `live.error.sessionsUnavailable.body`). | Source audit |
| What already used real data? | The bus-number flow (`/v1/routes`, `/v1/stops`, journey sessions), screenshot/map import validation (`LiveRouteImportCatalog` over the API), the post-ride 막차 card (`/v1/route-info`, which TAGO leaves empty for Jeju). | `TapsoAPIClient.swift`, `LiveRouteImportCatalog.swift` |
| Official datasets present | TAGO routes, stops and vehicles through the production API; 234 BIS timetable workbooks (235 entries) downloaded 2026-10-03 with a manifest. | `fixtures/jeju/timetables/bis/manifest.json` |
| Data present but not surfaced | All timetables (nothing read them at runtime, `HANDOFF.md`); 167 workbooks refused by parser v2. | `services/api/src/officialTimetable.ts` had no importer |
| Production state | `tapso-api.vercel.app` live on TAGO; durable Redis sessions enabled (production namespace); automatic matching off (`READY_FOR_SHADOW`); `liveActivityPush` disabled (no APNs credentials). | Post-deploy smoke run 37103746791, 2026-10-03 06:39 UTC |
| Code blockers | Demo-only destination search; no catalog; parser v2 one-layout-at-a-time; no holiday engine; no timetable endpoint; hybrid engine behind a launch argument. | — |
| Infrastructure/account blockers | No APNs key or paid Apple team (`BLOCKED_BY_APPLE_ACCOUNT`); no signed device build (`BLOCKED_BY_PHYSICAL_DEVICE`); the agent environment cannot reach TAGO, BIS or the production API (egress denied), so every live read runs in GitHub Actions. | `docs/TESTFLIGHT.md`, `LIVE_ACTIVITY_PUSH.md` |
| Official-data limitations | TAGO publishes no observation timestamp and no Jeju first/last bus; BIS files contradict themselves in places; most BIS tables state no day type; no official road geometry. | `DATA_SOURCES.md`; census below |

## 3. Target architecture (built in this slice)

```
TAGO (via TAPSO API) ──► scripts/catalog/build-jeju-catalog.ts ──► services/api/data/jeju-transit-catalog.json ─┐
   jeju-catalog.yml: weekly, data PR, live probe per variant                                                      │  GET /v1/catalog (ETag = content version)
                                                                                                                  ▼
bus.jeju.go.kr XLSX ──► fetch_jeju_bis.py ──► jeju_xlsx.py v3 ──► build_bundle.py ──► data/jeju-timetables.json ──► GET /v1/timetables?routeNo= (served day via data/kr-public-holidays.json)
   jeju-timetables.yml: weekly, change report, data PR                                                              │
                                                                                                                  ▼
iPhone: catalog cached in Application Support → DestinationSearchIndex (local, no request per keystroke)
        → variants grouped by number, never merged → server's current stop list with the destination fixed
        → boarding (only stops before it) → existing journey session → rider confirms the bus → ride
        → timetable card on the stop list (official, dated, never live)
```

## 4. Constraints and assumptions

| Item | Label | Source |
|---|---|---|
| TAGO `getRouteNoList` number search is not exact ("810" lists 810-1, 810-2) | `VERIFIED` | data-source probe run 37091997278 |
| TAGO without `routeNo` lists every route | `UNVERIFIED`: the unfiltered query answered HTTP 504 through TAPSO's API after four attempts (catalog run 37109317794). The catalog comes from the digit 1-9 and census-number searches, which all answered 200 | `artifacts/route-coverage/jeju-catalog-discovery.json` |
| Jeju route numbers are numeric (`N`, `N-N`) | `OBSERVED` in every route the 265 answering searches returned; a non-numeric name reachable only through the failed unfiltered query would be missing | same |
| BIS summary 첫차/막차 refer to the table's first/last row, or to the earliest/latest trip from a place the summary names ("첫차(제주 출발)") | `VERIFIED` on the census (rows are ordered by the core section: Route 365 row 1 starts 06:03 at 월성마을, a later row 06:00 at 한라대) | `jeju_xlsx.py` `check_service` |
| "휴일" covers Sundays and public holidays; whether it covers Saturday is unstated | `VERIFIED` from the files: sheet names use "(휴일)" for both "토,공휴일" (320, 360, 365, 415) and "일,공휴일" (741-1, 741-2, 742-2) | census |
| Korean public holidays 2024-2028 | `OFFICIAL_DERIVED` via python-holidays 0.105 (cites 공휴일에 관한 법률 2026 amendment and 인사혁신처); 임시공휴일 after its release need an override entry | `scripts/calendar/generate_kr_holidays.py` |
| Staleness bounds 30/90 days from download | `ASSUMED` (unchanged) | `officialTimetable.ts` |

## 5. Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| A | Demo out of the Release journey path | `DONE` | `TapsoBuild.showsDemo`; gate 2 source checks; demo copy replaced on live surfaces |
| B | Canonical catalog pipeline | `DONE`: catalog `794f3bcb831d783e` committed (989 variants), the same version from two independent builds | `transitCatalog.ts` (6 tests), `jeju-catalog.yml` runs 37106503237 (built, then cut by the old 60-minute limit) and 37109317794 |
| C | Real destination search | `DONE` in code; `UNVERIFIED` on a device | `DestinationSearchIndex` (7 Swift tests), app flow test |
| D | Variant handling | `DONE` | grouping by exact number, same-ended branches told apart by a stop, identical stop lists under two route IDs numbered as separate services (32 pairs), first-stop destinations excluded, revisited stops offered per visit |
| E-H | Timetable census, failure classification, strict validation, normalized dataset | `DONE` | §6 |
| I | Holiday/service-day engine | `DONE` | `serviceDay.ts`, 8 dated cases incl. substitute holiday and out-of-calendar |
| J | Runtime timetable API | `DONE` in code; production after merge | `GET /v1/timetables`, `staticData.test.ts` |
| K | iOS timetable experience | `DONE` in code; `UNVERIFIED` on a device | `TimetableCard`, `TimetableSheet`, `OfficialTimetableTests` |
| L, X | All-route live compatibility audit | `DONE`: all 989 variants probed (2026-10-03 09:32 UTC, 18:32 KST Saturday); gate 3 `PENDING_EVIDENCE` because no 순환버스 bus reported at that moment | `routeReadiness.ts`, `jeju-production-readiness.{json,md}`, §6 |
| M | Hybrid engine productionization | `UNCHANGED`: stays behind `-tapsoHybridTracking` until device evidence (gate 4) | `HYBRID_POSITION.md` |
| N | Route geometry | `NOT AVAILABLE`: no official road shape; stop coordinates only, reported per variant | readiness report |
| O | Historical segment timing | Foundation only (`SegmentTimingEstimate`, ≥5 samples); no ingestion | `HybridPositionEngine.swift` |
| P | Vehicle confirmation | `UNCHANGED`: rider identifies the bus; automatic selection refused below `READY_FOR_BOUNDED_AUTOMATION` | `matchingReadiness.ts` |
| Q | Background / Live Activity | Code complete since `LIVE_ACTIVITY_PUSH.md` M1-5; ride screen now says which mode is active; `BLOCKED` on APNs credentials and a device | gate 5 |
| R | Screenshot/map import on the catalog | Shared-text stop matches now come from the catalog (labelled synthetic only in a demo build); screenshot validation already used the live API | `TapsoAppModel.stopNames(inSharedText:)` |
| S | Refresh pipeline | `DONE`: both workflows weekly into reviewed data PRs with change reports | §8 |
| T | Observability | Partial: `/health.staticData` reports catalog, timetable and calendar versions; request logs carry route and status. No client metrics added | — |
| U | Offline | Catalog cached on the phone; search works offline once fetched; live vehicle data is never cached as live | `TransitCatalogFile` |
| Z | Release gates | `DONE`: `scripts/release-gates/jeju-v1.ts`, enforced in CI for the repository-decidable gates | §9 |

## 6. Timetable census (2026-10-03 download, parser v3)

235 entries listed by bus.jeju.go.kr: **201 parsed, 30 source conflicts, 4 without a timetable, 0 refused.** 388 services (direction × day type), 345 served, 43 withheld. Day types: 332 unstated, 28 weekday, 18 Saturday/Sunday/holiday, 4 "휴일", 3 Saturday, 3 Sunday/holiday. Report: `artifacts/timetables/jeju-timetable-census.md`.

Parser v2 refused 167. Format families read by v3, each with a fixture test in `scripts/timetables/test_jeju_xlsx.py`:

| Family | Real example | v3 rule |
|---|---|---|
| Multi-route workbook with a 노선번호 column and per-route summaries | 231/232, 251…254 | trips keep their route; summaries checked per route; identical repeated sheets merge |
| Title shorthand and listed name | "704-1,3번" vs "704-1, 704-3" | expanded, then must equal the site's listing |
| Service labels in titles | (옵서버스), (공항리무진), (심야), 우도마을버스 | kept apart from day labels |
| Day labels | 평일, 평, 토,공휴일, 토.공휴일, 주말/공휴일, 토요일, 일,공휴일, 휴일 | each with evidence; anything else refuses |
| Served-without-time marks | ● ○ O ◎ in (경유) and express columns | recorded, never a time |
| Not served | X, ×, -, blank, "X(공항 미경유)" | recorded with the note |
| Merged header | 201 "고성" over two columns | both columns named; only the header row is filled |
| Start/end markers | "5:30(출발)", "(종료)", "(<place> 출발)" | start here, end here, or off-table start |
| Via and conditional notes | "(고성 경유)", "(승객 없을시 … 종료)", "(월,화,목,금)" | time stays at the column, note or weekday restriction kept |
| Other labels | "(대정여고 앞)", "5:50\n한라수목원" | time attributed to the label, never to the column |
| Alternate times | 455 "9:48\n(9:58)" with "(2일, 7일 오일장 경유)" | alternate kept; condition required |
| Demand-responsive | 721-2 "14:00 ~ 20:30 (실시간 호출형)" | a window, no timetable |
| Suspension notices | 369, 1112, 1113 | `no_timetable` with the reason |
| Midnight | 3001…5002 (심야) | 24:MM only in a late-night table |
| Seasonal rows | 43-1 "동절기" in the route column; 921 "11,12,1,2월 막차" | conditional; never a first or last bus |

Source conflicts (kept, reported, never served): summary first/last disagreeing with the trips (e.g. 325 막차 21:20 vs 21:05), times running backwards (645, 1111, 922), malformed times never corrected (415 "08;46", 741-1, 751-2), two sheets for one direction that differ (231/232 direction tables, 3001, 3005). Each is listed with its reason in the census report.

### Catalog (2026-10-03, run 37109317794)

Catalog `794f3bcb831d783e`: **989 route variants with ordered stops, 4,338 stops, 3 variants without a usable stop list** (777, 888-8 and 999: the provider lists one stop), 252 route numbers. Every stop has a position; none has road geometry. Types as the provider labels them: 간선 402, 급행 280, 지선 261, 순환 32, unlabelled 14. Topology: 931 linear, 42 revisiting a stop, 16 loops. Stops per variant: 2 to 193, median 49. Variants per number: 1 to 28 (346: 28, 202: 24, 232: 21, 201: 20).

- **Twins.** 32 pairs of variants share one number and one stop list under two route IDs (e.g. 202 `JEB405320213`/`JEB405320237`). Each reports its own buses, so they are never merged: the app numbers them ("같은 정류장을 도는 별도 운행 1/2") and tells the rider to come back and choose the other if their bus does not appear; the readiness report warns on both.
- **Virtual stops.** 156 variants include a 가상정류소 (provider-defined, not a kerbside stop); they are kept as listed and flagged.
- **Timetable coverage by number.** 247 of the 252 catalog numbers have a published BIS entry: 227 served, 18 source conflicts, 2 without a timetable; 5 have none (202-3, 358-2, 777, 888-8, 999). 9 published numbers are not in TAGO at all (369, 590, 888, 921, 922, 924, 1100, 1100-1, 1950): timetable only, no live tracking.
- **Discovery.** 266 queries: the unfiltered list failed (HTTP 504), 9 digit searches and 256 census numbers answered; 8 census numbers matched no TAGO route.

### Live probe (2026-10-03 09:32 UTC = 18:32 KST, a Saturday)

Every one of the 989 variants' vehicle endpoints answered HTTP 200. Buses were reporting on 245 variants (422 buses); 421 carried a stop sequence inside their route, and one bus on 431 (`JEB405243101`, a loop) carried none, so that variant is `UNSUPPORTED` until it is probed clean. Readiness (992 entries, with the 3 unavailable): **170 SUPPORTED, 818 SUPPORTED_WITH_WARNING, 4 UNSUPPORTED, 0 UNKNOWN.** The warnings are: no bus at probe time so the stop-sequence check could not run (744; for 580 variants the only reason), virtual stops (156), same-stop twins (64), stops revisited (42).

By TAGO route type, variants rideable / checked with a reporting bus / total: 간선 401/141/402, 급행 280/67/280, 지선 261/35/261, 순환 32/0/32, unlabelled 14/1/14. By shape, every linear (227) and revisiting (12) variant with a reporting bus passed; loops 5 of 6. A probe is one moment. TAGO's 순환버스 are the 14 late-night school routes 3001-3008 and 5001-5006, whose published tables run 22:00-23:37 with no day type stated; at 18:32 none runs. The workflow can now probe the committed catalog without rebuilding it and probe one route type first (`"probeOnly": true, "firstType": "순환버스"` in `ops/jeju-catalog/request.json`), so the 32 variants are read in the first two minutes. Next probe: Tuesday 2026-10-06 22:15 KST, the first school night after the 개천절 holidays (3 and 5 October).

## 7. Decisions

- **A catalog file, not a live call.** Destination search needs every stop name on the phone; a reviewed, versioned file keeps keystrokes local and spends no provider quota. It lives under `services/api/data/` because the API's Vercel project is rooted at `services/api`.
- **Identity is the provider's.** One variant per TAGO route ID, one stop per TAGO stop ID; "202" and "202-1" are never merged; only the compass marker ([동]/[서]/[남]/[북]) is dropped to group two poles of one place for search.
- **The destination is re-checked on the server's current list** before boarding is offered (same stop ID at the same provider sequence); otherwise the rider chooses again.
- **Timetable "today" is claimed only where the table's own day label covers the date.** 85% of services state no day type: they are shown as "요일 구분 없음", never as today's.
- **A contradiction withholds the service, never corrects it.** The one accepted contradiction (442) stays narrowly keyed; no new registry entries were added.
- **The demo stays for development and tests** behind `TapsoBuild.showsDemo` (Debug).
- *Rejected:* interpolating stop times from timepoints; treating "휴일" as Saturday too; correcting "07;35" to "07:35"; using `/v1/routes` without a number as the only discovery.

## 8. Reproduction

```bash
python3 scripts/timetables/fetch_jeju_bis.py fixtures/jeju/timetables/bis --reparse   # census from committed files
python3 scripts/timetables/build_bundle.py                                           # runtime bundle + report
python3 -m unittest discover -s scripts/timetables -p 'test_*.py'
node --experimental-strip-types scripts/journey/timetable-views.ts --check
node --experimental-strip-types scripts/route-coverage/production-readiness.ts      # needs the catalog
node --experimental-strip-types scripts/release-gates/jeju-v1.ts --check
npm --prefix services/api test
swift test --package-path packages/transit-core
```

Live data: `ops/jeju-catalog/request.json` (catalog + probe, on a topic branch) and `.github/workflows/jeju-timetables.yml` (download), both on GitHub; neither commits to `main`.

## 9. Release gates

`artifacts/release-gates/jeju-v1.md` is generated from the repository. CI fails on gates 1, 2 and 6; gates 3-5 and 7 report and name their blockers.

## 10. External blockers

1. **APNs** (gate 5): paid Apple Developer team, App ID with Push Notifications, `aps-environment` entitlement, `.p8` key; then `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT`, `APNS_PRIVATE_KEY` on the `tapso-api` Vercel project and `LIVE_ACTIVITY_TICK_URL`/`LIVE_ACTIVITY_TICK_TOKEN` on the Railway collector (`LIVE_ACTIVITY_PUSH.md`).
2. **Device** (gates 4, 5): a signed build on an iPhone with Dynamic Island.
3. **Review**: the data PRs the refresh workflows open need a human merge.

## 11. Real-device validation protocol

Per route class (express/급행, trunk/간선, branch/지선, a loop, a late-night route, a route with several variants of one number), with a Debug build (diagnostics) and then Release:

1. Search the destination by name and by initials; record which variants are offered and whether the right one is first in its group.
2. Choose the variant; confirm the stop list opens with the destination fixed and only earlier stops offered.
3. Read the timetable card; compare first/last with the BIS page that day.
4. Confirm the bus by plate; record the masked plate shown vs the real one.
5. Ride three stops with the app open, then lock the phone; record when the Lock Screen count changes vs the real stops, with and without push.
6. With `-tapsoHybridTracking`, repeat 5 in a tunnel or with airplane mode for 2 minutes; record LIVE/PREDICTED/LOST transitions from the Debug diagnostics (no coordinates are recorded).
7. Record the get-off warning time against arrival at the stop.

Evidence goes to `artifacts/device-validation/` as `hybrid-<route>-<date>.json` and `live-activity-push-<date>.json` (masked plates, no coordinates); gates 4 and 5 read them.

## 12. Progress log

- 2026-10-03: audit (§2); catalog pipeline and workflow pushed; first catalog run started (run 37106503237).
- 2026-10-03: first catalog run built `794f3bcb831d783e` in 43 minutes, then the old single-step workflow's 60-minute limit cut it during the probe and nothing was committed; the split workflow (run 37109317794) committed the same version. 32 same-stop twins found in it and numbered in the app (§6, catalog).
- 2026-10-03: live probe of all 989 variants committed by run 37109317794; readiness rerun with the twin rule; gate 3 now requires a checked bus per route family (it had counted unchecked variants), so it reads `PENDING_EVIDENCE` on 순환버스.
- 2026-10-03: parser v3 and census (§6); runtime timetable API and holiday calendar; Swift search index and timetable reading (232 Swift tests on Linux and macOS CI); iOS search, timetable card and Release demo gating; readiness audit and release gates.

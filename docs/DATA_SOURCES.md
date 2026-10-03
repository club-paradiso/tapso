# Data sources

## B551982 validation history

Public Data Portal resource `15157601` remains a supported candidate source. Its contract exposes:

- host `https://apis.data.go.kr/B551982/rte`
- `GET /mst_info` — route master
- `GET /ps_info` — route stops
- `GET /rtm_loc_info` — realtime vehicle locations

The authenticated Jeju validation on 2026-09-10 accepted the newly issued key but returned zero `/mst_info` rows for tested Jeju-oriented `stdgCd` values `50110`, `5011000000`, `50`, and `5000000000`. Do not keep guessing B551982 Jeju mappings in product code.

Because the authenticated route master returned no Jeju data, B551982 is no longer a TAPSO runtime provider. The old adapter and its environment overrides were removed so a missing selector cannot silently send Jeju requests to the wrong API.

## TAGO bus route and location APIs

The verified Jeju pilot source is the Ministry of Land, Infrastructure and Transport TAGO family:

- Route service: `https://apis.data.go.kr/1613000/BusRouteInfoInqireService`
  - `getRouteNoList` resolves route-number families to official route IDs.
  - `getRouteAcctoThrghSttnList` provides ordered route stops.
- Location service: `https://apis.data.go.kr/1613000/BusLcInfoInqireService`
  - `getRouteAcctoBusLcList` provides route-scoped live vehicle snapshots.

Authenticated official responses verified:

- Jeju `cityCode=39`.
- Route number `365` maps to six distinct official route IDs.
- Live location fields for Jeju Route 365 are `gpslati`, `gpslong`, `nodeid`, `nodenm`, `nodeord`, `routenm`, `routetp`, and `vehicleno`.
- The live location payload does not expose a provider observation timestamp or event-code field.
- `nodeord` is present and usable as stop-order evidence.
- All ten vehicles on the two full-length directions retained the same vehicle identity across a 24-sample bounded probe.

TAGO route records reported `routetp=급행버스` for all six 365 variants. Do not use that field alone as authoritative Jeju product classification; preserve route ID and endpoint/stop topology.

Requests use `serviceKey`, `_type=json`, and where applicable `cityCode`, `routeId`, `pageNo`, `numOfRows`. The city code is a TAGO identifier, not the former B551982 `stdgCd`. Do not infer one from the other. Resolve IDs from official live responses; no production city/route ID is hardcoded.

[Jeju Bus Information System](https://bus.jeju.go.kr/) remains the official passenger-facing corroboration source for route existence, schedule, endpoint, and local classification. No undocumented Jeju BIS endpoint is treated as a supported TAPSO product API.

## Jeju timetables: the last bus

TAGO's `getRouteInfoIem` carries no service day for Jeju. For all 58 variants of routes 102, 202, 282, 365 and 800 it sends no first or last departure, and a weekday headway `intervaltime` of `"0"` (`VERIFIED` 2026-10-01: `scripts/data-sources/route-info.ts`, data-source probe run 36911886895). Jeju's last buses therefore need Jeju's own timetables.

`scripts/data-sources/jeju-timetable-docs.ts` read what the official sources publish (data-source probe run 36913158370, 2026-10-01). The table below is `REPORTED-OFFICIAL`, quoted from the pages.

| Source | What it is | Terms | Fit |
|---|---|---|---|
| data.go.kr `3043887`, "제주특별자치도_제주버스시간표정보_20200918" | File dataset: "제주특별자치도 내 모든 운행 버스의 시간표 정보를 제공합니다", every bus type. "버스 타입을 선택한 후 노선을 클릭하면 시간표정보를 엑셀파일로 다운로드 할 수 있음". XLSX, provided as a download on the agency's own site (`bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule?viewtype=2`). Registered 2020-09-18, modified 2025-07-30, update cycle "수시 (1회성 데이터)" | 이용허락범위 **제한 없음**, free | The official timetable: one file per route, downloaded from the page; not an API |
| `bus.jeju.go.kr` timetable page | "Please select a bus type and select a route": a route's times appear only after it is chosen. The page also links fee tables and the route booklet "버스노선 책자 (2026년 1월 1일 기준)". It shows no copyright or terms notice | Those of the data.go.kr entry above | Where the files come from. The site sends its certificate without the Sectigo intermediate (`Sectigo Public Server Authentication CA DV R36`), so a client that does not fetch intermediates fails; the probe fetches it and verifies it against the system roots |
| data.go.kr `15058442`, "제주특별자치도_버스정보시스템" | Open API (type LINK, XML): facility data (CCTV, VMS, AVI, VDS) and node-link traffic information. Registered 2016-05-17 | 제한 없음 | No timetable |
| data.go.kr `15074254`, `15074255`, `15074257`–`15074262` | Open APIs (type LINK, JSON; operation approval by review): route basics ("노선번호, 버스번호, 시작정류소, 종점정류소, 노선명"), stop basics and ridership statistics | 제한 없음 | No timetable field in any description. The portal publishes no machine-readable contract for them |

Decision:
- No undocumented Jeju BIS endpoint becomes a TAPSO product API (unchanged).
- The timetable files may be used under their 제한 없음 terms only as a **dated, imported dataset**, labelled with the download date and never presented as live.
- The static page holds no per-route file link: the links appear once a route is chosen. Reproducing the page's own requests to fetch them would mean using an undocumented endpoint.
- So the first file comes from a person following the dataset's instructions. The parser is written against that real file.
- 2026-10-02: the format-independent half exists (`services/api/src/officialTimetable.ts`): the normalized dataset `tapso-jeju-timetable-v1` (since replaced by v2, below) (label `OFFICIAL_DATED`, source page and file name, SHA-256 of the file, download date, optional effective date, parser name and version, departures per starting stop and day type), its validator, and the staleness rule (`fresh` ≤ 30 days after download, `aging` ≤ 90, then `stale`; a future download or effective date is `unknown`; only `fresh` and `aging` give a last bus, always with its as-of date; the bounds are `ASSUMED`). The agent environment cannot reach `bus.jeju.go.kr` or `data.go.kr` (egress denied), so the Route 365 file must still come from the owner: put it at `fixtures/jeju/timetables/raw/365.xlsx` exactly as downloaded, with the download date in the commit message.
- 2026-10-03: **Route 365 is imported** (`VERIFIED` from the file; `OFFICIAL_DATED`).
  - The owner downloaded it from the timetable page on 2026-10-03 at 10:26 KST. The workbook was written by the server (Apache POI) at that minute and is committed unchanged at `fixtures/jeju/timetables/raw/365.xlsx` (SHA-256 `8eafd16b…6d07a4`).
  - The parser `scripts/timetables/jeju_xlsx.py` (standard library only) turns it into `fixtures/jeju/timetables/365.json`. Its tests are in `scripts/timetables/test_jeju_xlsx.py`; an independent read with openpyxl matched all 1 402 times.
  - Layout of the real file: one sheet per direction and day type ("평일" and "토,공휴일"); each sheet has a summary line (first and last bus, headway, operator), a 시행일, and a table of trips over named timepoints. A cell is `HH:MM`, `X` (not served), or a time with "(<place> 출발)" for a trip that starts before its first timepoint.
  - The schema follows the file: `tapso-jeju-timetable-v2` keeps one service per direction and day type, with its timepoints, trips and own 시행일. `lastDeparture` gives the 막차 and `lastTimeAt` the last time at a named timepoint. Between timepoints the table says nothing, and TAPSO does not interpolate.
  - The two day types have different 시행일 in the same file: weekday 2026-06-24, Saturday and holiday 2024-08-01. A service is used only once its 시행일 has passed.
  - "토,공휴일" becomes `saturday_sunday_holiday`: Sunday is a public holiday under 관공서의 공휴일에 관한 규정 제2조 제1호. Deciding which day type a date falls in needs a holiday calendar, which TAPSO does not have yet; nothing reads the dataset at runtime yet.
  - The parser fails closed: an unknown day label, a time past midnight, times out of order, or a summary 첫차 or 막차 that disagrees with the trips stops the import with the cell named.
- 2026-10-03: **Route 442 is imported** (`OFFICIAL_DATED`, downloaded by the owner at 10:36 KST, `fixtures/jeju/timetables/raw/442.xlsx`, SHA-256 `59038f87…67a0c2`). Its layout differs from 365's, and parser version 2 reads both:
  - One sheet titled "442번" with no day type. Its day type is `unstated`: it is not assumed to run every day, and only a lookup for `unstated` finds it.
  - A circular route: 제주대학교, 제주 별빛누리공원 and 제주여자 중고등학교 head two columns each. `lastTimeAt` treats a repeated name as ambiguous and takes a column index instead.
  - Blank cells mean "not served" (365 writes `X`). "5:55 (출발)" means the trip starts at that column's timepoint.
  - Header names wrapped over lines keep one space at the wrap ("제주여자 중고등학교").
  - **The file contradicts itself.** Its summary says "첫차(제주여고 출발) 05:50", but trip 1 reads "5:55 (출발)" under 제주여자중고등학교. The parser accepts this one conflict and no other (`KNOWN_SUMMARY_CONFLICTS`, keyed by route, sheet and the exact times, not by checksum: the site writes a fresh workbook on every download). It keeps the trips and records the conflict in `summaryConflicts`. Any other file still stops on a mismatch. Which time is right is `UNKNOWN`. The 막차 (21:40) agrees.
  - 시행일 2024-04-25. An independent openpyxl read matched all 124 times.

## Runtime provider

Government-specific DTOs stop inside the TAGO provider adapter:

- `services/api/src/tagoProvider.ts` — TAGO

The API always uses TAGO. `RouteRequest.cityCode` carries the official TAGO city identifier; request parsing deliberately rejects the old `stdgCd` and `regionCode` aliases.

## Passive collection paths

The rider-free passive collector (`scripts/passive-shadow/collect.ts`) reads through one of two paths and records which one as `providerPath` on the manifest and on every stream:

- `tago-direct`: TAGO through the one `TagoTransitProvider`, with `TAGO_SERVICE_KEY` from the environment.
- `tapso-public-api`: `TapsoPublicApiProvider` (`services/api/src/tapsoPublicApiProvider.ts`), a read-only adapter for TAPSO's own public `/v1/stops`, `/v1/vehicles` and `/v1/routes`. It is not a TAGO client and needs no credential; the deployment it reads reaches TAGO through `TagoTransitProvider`. `/v1/vehicles` is served through a 20 s shared cache, so receipts on this path do not have session cadence. A stream counts as live only when read from the production origin; any other base is recorded as `synthetic`.

The Passive Shadow v3 evidence of record (collection run `36098610702`) came through `tapso-public-api`.

## Evidence and retention rules

- Fixture files are synthetic and say so in-band.
- Never commit service keys.
- Raw vehicle identifiers stay out of Git; commit only sanitized, pseudonymised aggregates or deliberately minimized representative fixtures. Corrected 2026-09-29: raw evidence does not only stay local. Where the code and workflows keep it:
  - Command-line collectors and ride-capture tools write under ignored `work/` by default.
  - GitHub-hosted passive collection keeps raw streams only in the draft release `passive-evidence-vault`; draft assets are restricted to push-capable identities and an asset already stored is never replaced. TAPSO is public, so raw vehicle streams are never retained as Actions artifacts. On 2026-09-30 the evidence-of-record collection `pv3-20260925T052712Z-f096de91` was checksum-verified into the vault and the two plaintext raw Actions artifacts (`passive-shadow-v3-raw` and `matcher-evidence-raw-replayed`) were deleted after vault coverage was verified.
  - Field-validation and beta ride captures submitted through the Railway collector are stored raw (gzip + base64, chunked) with their sanitized report in Upstash Redis under `tapso:field-validation:v1:` (`services/api/src/fieldValidation.ts`). A beta ride in progress is journaled in the same database under `tapso:beta-tester:v1:` (`services/api/src/captureJournal.ts`).
- Capture request parameters, collection time, provider identity, and schema assumptions for live validation.
- TAGO snapshot acquisition time is not the same as provider update time. Measure cadence from content changes.

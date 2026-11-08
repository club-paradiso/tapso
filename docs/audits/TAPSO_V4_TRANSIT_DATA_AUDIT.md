# TAPSO V4 transit data audit

Date: 2026-11-08 (Asia/Seoul). No live provider call was made in this audit (`UNAVAILABLE`: no key, and egress to Jeju BIS / data.go.kr was recorded as denied in earlier sessions). Every row below cites repository evidence; nothing is newly observed from a provider.

## 1. Sources

| Source | Official documentation | Access terms | Update / timestamps | Coverage | Failure modes | Cost / quota | Status in TAPSO |
|---|---|---|---|---|---|---|---|
| TAGO `BusRouteInfoInqireService` (routes, ordered stops) | data.go.kr 15098529 (schema inspected, `docs/DATA_SOURCES.md`) | Public Data Portal key, server-side only | Static-ish; no version field | City 39; 989 variants, 4,338 stops (catalog `794f3bcb831d783e`, `OBSERVED` 2026-10-03) | Unfiltered list HTTP 504; number search not exact; 3 variants with one-stop lists; 32 duplicated stop lists under two IDs | Quota `UNKNOWN` | Runtime + weekly catalog build |
| TAGO `BusLcInfoInqireService` (vehicle positions) | data.go.kr 15098533 | same | **No provider observation timestamp** (`VERIFIED` 2026-09-11); TAPSO records receipt time only | Jeju verified on Route 365 and a two-probe all-route audit | Timeouts, 5xx, empty pages; cadence must be inferred from content change | Quota `UNKNOWN` | Runtime, sessions, passive collection |
| TAGO `getRouteInfoIem` (first/last bus, headway) | same family | same | — | **Empty for Jeju**: no first/last departure for 58 variants of 102, 202, 282, 365, 800 (`VERIFIED` 2026-10-01) | — | — | Read, answers "unknown" |
| TAGO `ArvlInfoInqireService` (stop arrival predictions) | data.go.kr 15098530 | Needs separate approval (`PRODUCT_V3_JEJU_NATIVE.md:154–157`) | `UNKNOWN` | Jeju coverage `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | **Not used** |
| Jeju BIS timetable files | data.go.kr 3043887; `bus.jeju.go.kr/publicTrafficInformation/generalBusSchedule` | 이용허락범위 제한 없음 (`REPORTED-OFFICIAL`) | Dated import; bundle `retrievedOn` 2026-10-03; per-sheet 시행일 | 235 census entries: 201 parsed, 30 source conflicts, 4 without a timetable | Self-contradictions; `;` typos; times running backwards; 85 % of services carry no day label | Free | `OFFICIAL_DATED`, served by `/v1/timetables` and `/v1/night-guard` |
| Jeju BIS live arrival pages | site only | No documented API | — | — | — | — | **Not used** (undocumented endpoints are not dependencies) |
| data.go.kr 15074254–15074262 (Jeju route/stop basics, ridership) | Portal descriptions only | Approval by review | — | No timetable field | No machine-readable contract published | Free | Not used |
| Kakao Local REST (place search) | Kakao developers | Server-side key | Per query | Jeju box only | 503 without key | 100k/day (read 2026-10-13) | Destination lookup only, never transit truth |
| Official disruption notices | `UNKNOWN`: no verified structured official feed found | — | — | — | — | — | Schema only (`transitEvidence.ts`), no ingestion |

### Independence

TAGO route, location and route-info services are one provider family; they are not independent evidence of each other. Jeju BIS timetable files and TAGO positions plausibly originate from the same provincial BIS (`ASSUMED`; not documented). TAPSO therefore never treats "timetable says scheduled" plus "TAGO shows a vehicle" as two independent confirmations of the rider's bus.

## 2. Timetable structure relevant to NightGuard (`OBSERVED`, bundle `e149eb7a24bd6723`)

| Day type | Services |
|---|---|
| unstated | 332 |
| weekday | 28 |
| saturday_sunday_holiday | 18 |
| holiday_saturday_unstated | 4 |
| saturday | 3 |
| sunday_holiday | 3 |

- Late-night families 3001–3008 and 5001–5006: every service `unstated`; 3001 and 3005 are `source_conflict` (3001's summary 막차 00:25 disagrees with its trips' 00:10). Several cross midnight (max table time 24:49).
- 800-1 carries the label "심야" and a 05:30–06:40 direction, also `unstated`.
- Services crossing midnight with a stated day type: **0**. The midnight fix (F-01) is preventive.
- Conditional trips (e.g. "11,12,1,2월 막차") are never a day's first or last bus; NightGuard reports them as `laterConditional` and returns `uncertain` rather than "last bus gone".

## 3. Evidence engine decisions (implemented)

| Question | Rule | Where |
|---|---|---|
| Is the bus operating? | Never asserted. Strongest claim: `vehicle_reported` (`OBSERVED`), which is not the rider's bus | `transitEvidence.ts` |
| No vehicles reported | `scheduled_not_observed` while the table schedules more — absence is not cancellation | same |
| Suspended? | Only a reviewed `OfficialNotice` in effect (mandatory `effectiveUntil`, https source, reviewer) | same |
| Old live answer | Receipts older than 60 s (`ASSUMED`) are not evidence about now | same |
| Vehicle long before first departure | `conflicting` (>60 min early, `ASSUMED`) | same |
| Observation time | `observedAt` is the provider's; TAGO's is `null`; receipt stays `receivedAt` | same |
| Service day after midnight | Previous day read until 06:00 for its 24:xx trips | `nightGuard.ts` |
| Stop-level times | Only at a published timepoint, matched by exact unique name; never interpolated | same |
| Self-contradicting table | Withheld: no times sent | same |

## 4. Matching (unchanged; summary of `VERIFIED` coverage)

`directed-route-progress-v1` (`services/api/src/matching.ts`): vehicles at offset ≥ +2 past the boarding stop are `departed` and never selectable (F1 regression tests); offsets 0/+1 are `boarding_stop_unresolved` and block selection (nodeord ambiguity); circular routes detected by first = last stop with seam handling; repeated boarding stops and conflicting sequences withhold. Residual hazard: late-appearing leaders (Issue #74). Readiness `READY_FOR_SHADOW`; rider confirmation remains required.

## 5. ETA

Not built. Preconditions from the spec are unmet: no authorised stop-arrival source, no observation timestamps, no independent ground truth. Required before any ETA work: authorise dataset 15098530, verify Jeju coverage and timestamp semantics, and collect ground truth under `docs/validation/TAPSO_V4_ACCURACY_PROTOCOL.md`. Metrics to report then: median and P90 absolute error, interval coverage, failure rate.

## 6. Open data actions

1. Merge a refreshed timetable import before 2026-12-31 (F-02).
2. Owner: request data.go.kr approval for 15098530 and record its terms.
3. Build a route variant ↔ timetable direction crosswalk (needed before live evidence and timetable entries can be joined per direction).
4. Identify an official, citable notice source; record notices by hand as reviewed `OfficialNotice` records until one exists.

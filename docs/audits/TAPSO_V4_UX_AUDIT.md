# TAPSO V4 UX audit

Date: 2026-11-08. Sources: code read of `apps/ios` and `packages/transit-core` (93 Swift files), `check_localization.py` / `check_brand.py` output, and a read-only metadata read of Figma file `kkx04GvqOzHje7Dw5ikO9X` (session of 2026-11-08). No simulator or device was run here (`UNAVAILABLE`: Linux container). No screenshots were produced, so there are no before/after images in this audit.

Principle under test: *one number when the rider needs to look; nothing unnecessary when they do not.*

## 1. Already right (`VERIFIED` by reading)

- Timetables always show the as-of date and "실시간 정보가 아니에요"; "today" is only claimed from a non-stale bundle (`OfficialTimetable.swift:141`); 24:xx times carry a 다음날 marker (`TimetableViews.swift:113–116`).
- A last-known count is dimmed and labelled; Reduce Motion is honoured across ride surfaces (`RideView.swift:51, 577`; `RideSurfaceComponents.swift:99, 230, 513`; `VehicleCheckView.swift:269`).
- Icon-only buttons have labels and 44 pt frames (`SetupViews.swift:55–61`, `BoardingFirstViews.swift:41–46`, `RideView.swift:98–101`).
- Localization: ko, en, zh-Hans, ja; 561 keys used, all present (zh-Hans and ja are machine-translated: `KNOWN_ISSUES.md:5`).

## 2. Findings, prioritised

| # | Severity | Screen / surface | Evidence | Rider impact | Change | Status |
|---|---|---|---|---|---|---|
| U-01 | P1 | Ride, Lock Screen, island | `RideGuidance.swift` returned an estimated `riding` before checking offline / lost | Offline phone keeps a mint "예상 위치" count | Offline and lost outrank an estimate | **Fixed on this branch** (CI-verified only) |
| U-02 | P1 | Boarding-first trip list | `TapsoAppModel.swift:876, 954–981`; `BoardingFirstViews.swift:303–322`: loads once, no as-of, "곧 도착" in mint, "버스 위치는 실시간이에요" | A bus that left reads as arriving, live | As-of age, grey after 60 s, `.task` polling while visible, "정류장 근처" instead of "곧 도착" | Planned PR 4 |
| U-03 | P2 | Estimated vs live, all surfaces | "~" only on some counts (`LiveActivitySurfaces.swift:265, 309, 314`); app hero never; VoiceOver omits "예상" (`RideSurfaceComponents.swift:695–697`) | Estimate reads as confirmed | One `isEstimated` presentation flag from the core, applied everywhere incl. VoiceOver | Planned PR 4 |
| U-04 | P2 | Trust qualifier | Estimated uses the broadcast glyph and journey colour (`LiveActivitySurfaces.swift:511, 517`; `TapsoTokens.swift:47–49`) | "Estimated" looks like "live" | Own glyph (e.g. `location.magnifyingglass`) and a muted role | Planned PR 4 |
| U-05 | P2 | Ride view logic | Trust derived by comparing a localisation key (`RideGuidance.swift:201`, `RideView.swift:429`) | Renaming a key silently turns estimate into live | Store `isEstimated` on `RideGuidance`; views read `trust` only | Planned PR 4 |
| U-06 | P2 | Return / last bus | `LastBus.swift:103–104` rejects ≥ 24 h, raw string still shown (`RideEndView.swift:361`); no 다음날 marker | "막차 24:30" next to "unknown" | Reuse `TimetableClock.display` | Planned PR 4 |
| U-07 | P2 | Return design vs data | Figma `09 Return / Rescue` › `193:3149` "돌아갈 때 막차" draws two populated `ReturnTripRow / V3` rows (`213:107`, `213:115`); in production TAGO gives no Jeju last bus and only 13–15 of 256 timetable routes can answer for a given evening (system audit F-03) | The designed happy path is the rare case; the common case (unknown) is undesigned | Add an `unknown` variant as the default state (see §4) | Instructions below |
| U-08 | P2 | Vehicle check | `TapsoAppModel.swift:1659` stops polling on a non-transient failure but leaves proposals tappable | Rider confirms a bus from an old list | Disable proposals and offer retry | Planned PR 4 |
| U-09 | P2 | Mint colour semantics | Mint means "data live" but also decorates the live badge, resume notice, "comfortable" last-bus state and home icons (`TapsoTokens.swift:47–49`) | Green implies certainty where none exists | Reserve mint for observed data; neutral tint for decoration | Planned PR 4 |
| U-10 | P3 | Dynamic Type | Fixed `.system(size:)` on Live Activity surfaces (`LiveActivitySurfaces.swift:187, 242, 263, 353, 359, 379, 512`), RouteBadge `size: compact ? 9 : 12` + `.fixedSize()` | Large-text users get small or clipped text | Scaled metrics within ActivityKit limits | Planned PR 4; needs simulator snapshots |
| U-11 | P3 | Timetable | Conditional trips marked only by " *" (VoiceOver reads "asterisk", `TimetableViews.swift:194–196`); footnote buttons likely < 44 pt (`:34`, `:91`, `ASSUMED`) | Screen-reader confusion; small targets | Accessibility label; `minHeight: 44` | Planned PR 4 |
| U-12 | P3 | Performance in `body` | Catalog scans in `body` (`BoardingFirstViews.swift:17, 191`); list re-sorts as arrivals change | List reorders under the rider's finger | Stable order; badges update in place | Planned PR 4 |
| U-13 | P3 | Dead component | `TrustBadge` with "실시간" label unused in code (`RideSurfaceComponents.swift:588`) but used in Figma (`195:3035`) | Design–code drift | Wire it to `RideTrust` or delete in both | Planned PR 4 |

## 3. NightGuard in the product (new)

The server now answers "what does the timetable say about the rest of tonight" (`GET /v1/night-guard`). Copy rules for the client (none implemented in Swift yet):

| `status` | Korean headline (draft) | Never say |
|---|---|---|
| `scheduled_departures_remain` | "시간표상 다음 출발 23:20 (기점 기준)" | "운행 중", "곧 와요" |
| `before_first_departure` | "시간표상 첫차 06:00" | — |
| `last_scheduled_departed` | "시간표상 막차가 기점을 출발한 시각이 지났어요. 늦게 오거나 아직 오는 중일 수 있어요." | "막차 끊김", "오늘 운행 종료" |
| `uncertain` | "오늘 운행 여부를 시간표로 확정할 수 없어요" + condition text | a time as if certain |
| `unknown` | "오늘 막차 정보 없음" + the table's own last time as a dated fact if `last` is present | a green or mint state |

Every NightGuard line carries the as-of date. Measured at a trip's start unless a timepoint is named.

## 4. Figma node-level instructions (not applied)

Figma write tools are available in this session, but no edit was made: the changes below alter shared components and should be reviewed first. **Figma is not synchronised with this branch.** `design/figma-sync-manifest.json` already reports `PENDING_MANUAL_WRITEBACK` and has no last-synced date.

1. `09 Return / Rescue` › `193:3149` (돌아갈 때 막차): add a variant property `state` to `ReturnTripRow / V3` with values `known` (current) and `unknown`. `unknown`: route badge, direction, text "막차 정보 없음 · 시간표 기준일 2026-10-03", no time numeral, no pin control, neutral (not mint) tint. Make `unknown` the first instance in the frame.
2. New frame on the same page, next to `199:3046`: `V4 / NightGuard · tonight's timetable`, 402 wide, five stacked rows, one per status in §3, each with as-of date footnote and a "기점 기준" chip.
3. `05 Live Activity · Dynamic Island`: no NightGuard surface is proposed for the island; the return countdown (`213:59`, `213:79`) remains the only after-ride island state.
4. `02 Components` › `TrustBadge / V2`: add variant `estimated` with the non-broadcast glyph (U-04).

### 4a. Applied in Figma (2026-11-08)

Written to the editable file through the Figma MCP, then checked with a screenshot. It reuses the file's own local variables (`color/text/*`, `color/background/secondary`, `brand/mint-deep`) and Noto Sans KR.
- Page `09 Return / Rescue` › frame `193:2956` › new column `343:134` "V4 / NightGuard · stale positions":
  - `NightGuardSection` card: one line per direction, the as-of footnote, never mint.
  - `TripsAge / current` (mint) and `TripsAge / stale (> 90 s)` (neutral, no "가장 가까이 있어요" badge), mapped to `BoardingFirstViews.swift` › `CatalogTripsContent`.
- All sample content is labelled SYNTHETIC.
- **Not done:** the `ReturnTripRow / V3` `state=unknown` variant (§4 item 1) and the `TrustBadge / V2` `estimated` variant (item 4). Both change shared components and are left for review. `design/figma-sync-manifest.json` is unchanged.

## 5. Figma-to-SwiftUI map (relevant subset)

| Figma | SwiftUI |
|---|---|
| `ReturnTripRow / V3` | `RideEndView.swift` return rows (`:352–362`) |
| `ReturnCountdown / Lock Screen V3`, `/ Island V3` | `ReturnActivitySurfaces.swift` |
| `RescueOption / V3` | Rescue list in `RideView.swift` (passed-destination moment) |
| `TrustBadge / V2` | `RideSurfaceComponents.swift:588` (unused) |
| `RideHero / passed · rescue` | `RideView.swift` hero for `.passedDestination` |

## 6. Accessibility test results

Not run (`UNAVAILABLE`: no simulator). Required before PR 4 merges: VoiceOver pass on ride, return and timetable screens; Dynamic Type at AX5 snapshots via `SnapshotEvidenceTests`; Reduce Motion; long stop names in ja and en.

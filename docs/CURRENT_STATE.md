# TAPSO: current state (2026-11-10)

Start here. This page describes what the app does on `main` today, where each part lives, what is proven and what is blocked, and where to pick up. When this page and an older document disagree, this page and the code win. Finished plans and superseded designs are in `docs/archive/`.

Reality labels as everywhere in the repository: `VERIFIED` (checked against the real thing), `OBSERVED` (seen in live data, a sample), `OFFICIAL_DATED` (official source with its download date), `ASSUMED`, `UNKNOWN`, `BLOCKED_*`.

## 1. What the app does

TAPSO (탑서) is an iPhone app for Jeju buses. The rider says where they get off, TAPSO finds the physical bus, the rider confirms it, and the ride is followed on the Lock Screen and in the Dynamic Island until the stop.

| Flow | Screens (`apps/ios/TapsoApp`) | Data |
|---|---|---|
| Home: "where are you getting off?" | `HomeView` (`HomeLayout` decides the order) | saved rides (`JourneyStore`) |
| Destination first | `CatalogSearchViews`, `SetupViews`, `BoardingFirstViews` | the Jeju catalog, searched on the phone |
| Route number first ("버스 번호로 타기") | `LiveRideSetupViews` | `/v1/routes`, `/v1/stops` |
| From a map app (share sheet, paste, screenshot, place search) | `ShareExtension`, `ScreenshotImportViews`, `PlaceLookupViews` | parsed on the phone; place search through `/v1/places` and Apple MapKit (`MKLocalSearch`) |
| Find and confirm the bus | `VehicleCheckView` | `/v1/vehicles`, journey session (`/v1/sessions`) |
| The ride | `RideView`; Lock Screen and Dynamic Island in `Shared/LiveActivitySurfaces.swift` | server session progress |
| After the ride | `RideEndView`: walk hand-off, tonight's timetable (NightGuard), 막차 rows, full timetable | `/v1/night-guard`, `/v1/route-info`, `/v1/timetables` |
| "돌아갈 시간" countdown | `Shared/ReturnActivitySurfaces.swift` | computed on the phone |
| Repeat a ride | `TapsoShortcuts`, `LiveActivity/RideAgainControl.swift` | saved rides |

Build configurations (`TapsoBuild.swift`): **Debug** has the synthetic sample ride; **Beta** adds field tools (ride record, stop mark, feedback); **Release** is real Jeju data only.

What the app deliberately does not do: automatic bus selection (the rider confirms; the server switch is off), arrival-time predictions (no authorised source), multi-ride journeys or transfers, continuous passenger GPS by default.

## 2. Code map

| Part | Where | Notes |
|---|---|---|
| iOS app | `apps/ios/TapsoApp` | SwiftUI; `TapsoAppModel` holds all state; `TapsoAPIClient` is the only network path |
| Shared by app and widgets | `apps/ios/Shared` | tokens (`TapsoTokens.swift`), ride surfaces, Live Activity policy |
| Widget extension | `apps/ios/LiveActivity` | Live Activities and the "다시 타기" control |
| Share extension | `apps/ios/ShareExtension` | reads a shared place on the phone |
| Swift core | `packages/transit-core` (`TapsoTransit`) | no SwiftUI; ride guidance (`RideGuidancePolicy`), ride state (`RideSession`, see `JOURNEY_STATE_MACHINE.md`), freshness, last bus (`LastBus` + `SafeReturn`), past-the-stop rescue (`PassedStopRescue` + `Rescue`), NightGuard decoding, catalog search, screenshot import, the hybrid position engine (off), and a demo-only matcher |
| Transit API | `services/api` | Vercel function `tapso-api`; TAGO adapter, sessions (Upstash), the matcher `directed-route-progress-v1`, timetables, NightGuard, operating status |
| Website | `apps/web` | marketing site and waitlist, not the product |
| Data | `services/api/data/` | catalog `c9eacac26d848f6a` (built 2026-11-08: 991 variants, 4,338 stops, 250 route numbers); timetable bundle downloaded 2026-11-05 (`OFFICIAL_DATED`) |
| Design | `design/tokens/tokens.json`, `docs/beta/DESIGN_DIRECTION.md`; Figma file `kkx04GvqOzHje7Dw5ikO9X` | Design System V3 "basalt"; mint means observed data only (`scripts/ios/check_colour_semantics.py`) |

API routes (`services/api/src/apiRouter.ts`): `/health`, `/v1/cities`, `/v1/routes`, `/v1/stops`, `/v1/vehicles`, `/v1/catalog`, `/v1/places`, `/v1/route-info`, `/v1/timetables`, `/v1/night-guard`, `/v1/operating-status`, `/v1/sessions`, `/v1/session`, `/v1/session-confirm`, `/v1/session-live-activity`, `/v1/matches`, `/v1/feedback`, and `/operator/*` (token-protected).

## 3. What is proven and what is not

| Area | State |
|---|---|
| Swift core, iOS build and tests | `VERIFIED` in CI on every push (jobs `transit-core`, `ios`; macOS only, no local Swift toolchain in the agent container) |
| API | `VERIFIED` by Node tests (1,052 on 2026-11-10) and live in production |
| Live data | TAGO positions have no observation time; TAPSO uses receipt time. TAGO refuses bursts (HTTP 429; at most 4 concurrent reads per instance is `ASSUMED`) |
| Timetables | `OFFICIAL_DATED` 2026-11-05; first-bus check 2026-11-09: 12 of 13 first departures matched (`docs/validation/TAPSO_V4_FIRST_BUS_CHECK_2026-11-09.md`). Goes stale after 2027-02-03; the release gate warns after 2027-01-04 |
| Release gates (`artifacts/release-gates/jeju-v1.md`) | 1 data, 2 search, 6 data quality: PASS. 3 live: PENDING, only routes 900 and 910 (village buses, daytime) never seen with a bus. 4 tracking: BLOCKED by a physical device. 5 background push: BLOCKED by a paid Apple account. 7 release: decided by CI |
| On a real iPhone | `UNVERIFIED`: no signed device build yet |
| APNs push, TestFlight | `BLOCKED_BY_APPLE_ACCOUNT`: needs the paid Apple Developer Program |
| Automatic matching | off; readiness `READY_FOR_SHADOW` (`docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md`) |

## 4. Specified but not built into the app

These exist as specifications and server code only. Do not assume the app does them.

- **Journey Contract** (`docs/product/JOURNEY_CONTRACT_V3.md`, `services/api/src/journeyContract.ts`): a vocabulary for multi-ride journeys. No endpoint uses it.
- **Transfer Guardian** (`docs/product/JEJU_SAFETY_LAYER_V3.md`, `assessTransfer` in `services/api/src/journeySafety.ts`): no endpoint uses it.
- **Hybrid position tracking** (`HybridPositionEngine`): built and tested, off behind `TRANSIT_HYBRID_TRACKING_ENABLED` until device evidence exists (gate 4).

The Swift copies of the first two, an unused `JourneyStateMachine`, and the never-placed `TrustBadge` were removed on 2026-11-10.

## 5. Open decisions for the owner

1. **The app-wide control tint is still mint** (`TapsoRootView` `.tint(mintDeep)`, primary buttons), so controls read as "live" too. Keep, or move controls to a neutral or brand colour.
2. **GitHub Actions may not open pull requests** in this repository, so the weekly catalog and timetable refreshes fail until Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" is enabled.
3. **Figma drift:** the `TrustBadge / V2` component, the NightGuard placement on `09 Return / Rescue`, the mint home tiles and the live badge still show the old design.
4. **The website** (`apps/web`) still draws a `TrustBadge` in its mock app screens, a badge the app does not have. Its 7 strings (`trust.vehicle.*`, `trust.data.*`) are kept in the iOS tables only because the website quotes them; drop both together.

## 6. Next steps, in order

1. Probe routes 900 and 910 on a weekday morning (gate 3). The probe orders by route type, and these two have none, so this needs a route-number option in `scripts/catalog/build-jeju-catalog.ts`.
2. Snapshot evidence of the return screen and NightGuard in Korean and English, at default size and AX5, then a VoiceOver checklist (V4 PR 4).
3. Repeat the first-bus check on two more weekdays before changing the 365 06:00 한라대 row (`CONFLICTED` in the official file).
4. A signed build on the owner's iPhone (free Personal Team, 7-day install) to start device evidence.

The detailed plan and progress log: `docs/exec-plans/TAPSO_V4_IMPLEMENTATION.md`. Audits: `docs/audits/`.

## 7. How to work on it

Commands are in `AGENTS.md` (Verification). The ones that run without macOS:

```bash
npm --prefix services/api install --omit=optional && npm --prefix services/api test
python3 scripts/ios/check_localization.py && python3 scripts/ios/check_brand.py
python3 scripts/ios/check_colour_semantics.py && python3 scripts/ios/sync_xcodeproj.py --check
node --experimental-strip-types scripts/release-gates/jeju-v1.ts --check
```

Rules that keep the app honest: never push to `main`; open a pull request and merge on green CI. Tests first for a behaviour change. Never show an estimate as live, or a timetable as a running bus. Never invent an endpoint, a limit or a time. After adding or removing a Swift file under `apps/ios`, run `python3 scripts/ios/sync_xcodeproj.py`.

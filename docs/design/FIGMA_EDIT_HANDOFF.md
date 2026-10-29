# TAPSO Design System V3 — Figma Edit & Handoff Specification

**Target Figma File:** `kkx04GvqOzHje7Dw5ikO9X` (`TAPSO — Product / Marketing Design System`)  
**Base Commit SHA:** `ca223b4` (incorporating PR #146, #147, #148, #149)  
**Status:** `PENDING_MANUAL_WRITEBACK`  
**Security / Tooling Notice:** The Antigravity Figma MCP integration is read-only. No unauthorized write requests are performed. This document provides the exact, node-by-node instruction set for Figma editors and plugins to sync the file with merged code reality.

---

## 1. Active Workspace Architecture

To eliminate ambiguity between active production designs, research proposals, and legacy iterations, organize pages into seven numbered groups without deleting historical component IDs:

```
├── 🟢 START HERE
│   └── 00 Cover / Index (46:2) — reality labels, version index, maintainer guide
├── 🎨 DESIGN SYSTEM V3
│   ├── 01 Foundations — tokens, typography, grid, layout rules
│   ├── 02 Components — generic core primitives
│   ├── 02F iOS Ride V2 (152:2) — ride components (JourneyRail, Dori, cards)
│   └── 02G iOS Product V3 (212:2) — return & rescue components
├── 📱 iOS CURRENT
│   ├── 03 iOS — GO (205:3310) — setup, destination search, boarding selection
│   ├── 04 iOS — RIDE (157:10) — confirmed vehicle, active ride, degraded states
│   └── 09 Return / Rescue (193:2956) — missed stop recovery, walk-back
├── ⚡ LIVE ACTIVITY
│   ├── 05 Live Activity · Dynamic Island (160:1208) — 9 moments + waiting row
│   └── 05B · Dynamic Island Coexistence V3 (275:2) — lock screen & island specs
├── 🌐 MARKETING CURRENT
│   └── 11 Marketing Web (3:4, 218:2, 314:12) — responsive web (360/390/768/1280/1440)
├── 🔬 LAB / ROADMAP
│   ├── 06 Roadmap · Future Workspaces (300:3)
│   ├── 07 Discover (205:4, 306:2)
│   ├── 08 Eat (205:5, 307:87)
│   ├── 10 Passport / Share (205:7, 307:182)
│   └── 12 Prototype (205:8)
└── 🗄️ ARCHIVE
    └── 13 Archive (102:2) — V1/V2 legacy boards, preserved with timestamp banners
```

---

## 2. Canonical Token Synchronisation (Figma Variables)

### 2.1 Collection: `TAPSO V2 Semantic` → Rename to `TAPSO V3 Semantic`
**Collection ID:** `VariableCollectionId:151:14`  
**Modes:** `Light`, `Dark`

Update existing variable values as follows (do NOT delete and recreate variables to avoid breaking bindings):

| Variable Name | Light Value (Current → **V3 Truth**) | Dark Value (Current → **V3 Truth**) | WCAG AA Ratio |
|---|---|---|---|
| `background/primary` | `#FFFFFF` → `#FFFFFF` | `#071923` → **`#0F171A`** | 18.1:1 on basalt ink |
| `background/secondary` | `#F5FAFB` → **`#F3F5F4`** (Shore) | `#0E222C` → **`#172124`** | Ink on shore: 16.6:1 |
| `background/elevated` | `#FFFFFF` → `#FFFFFF` | `#16303D` → **`#1F2B2F`** | Modal elevation |
| `text/primary` | `#071923` → **`#0F171A`** (Basalt) | `#FFFFFF` → **`#EEF2F1`** | 16.1:1 on dark basalt |
| `text/secondary` | `#566973` → **`#56636A`** (Stone) | `#B4C4CB` → **`#A9B6BA`** | 5.7:1 (L) / 8.7:1 (D) |
| `text/tertiary` | `#5F7079` → **`#5C686E`** | `#8599A2` → **`#8C999E`** | 5.2:1 (L) / 5.6:1 (D) |
| `text/on-accent` | `#071923` → **`#0F171A`** | `#071923` → **`#0F171A`** | Text on mint/amber/blue |
| `text/on-urgent` | `#FFFFFF` → `#FFFFFF` | `#071923` → **`#0F171A`** | 5.0:1 (L) / 7.1:1 (D) on coral |
| `text/on-dark-surface` | `#FFFFFF` → `#FFFFFF` | `#FFFFFF` → `#FFFFFF` | Text on basalt & Island |
| `line/separator` | `#DFE8EB` → **`#E1E6E4`** | `#274452` → **`#2A373B`** | Hairline borders |
| `identity/mint-ink` | `#0B7F6D` → **`#097666`** (mintDeep) | `#2FC7AA` → `#2FC7AA` | **5.1:1** on Shore (was 4.49:1) |
| `identity/basalt` | `#0F171A` → `#0F171A` | `#0F171A` → `#0F171A` | Identity fill |
| `identity/basalt-raised`| `#1A2528` → `#1A2528` | `#1A2528` → `#1A2528` | Raised container fill |
| `identity/tangerine` | `#F7972F` → `#F7972F` | `#F7972F` → `#F7972F` | Destination dot & pin |
| `identity/dolCheek` | `#FF7A6E` → `#FF7A6E` | `#FF7A6E` → `#FF7A6E` | Cheeks on calm moments |

---

## 3. Component Updates

### 3.1 `JourneyRail / V2` (`Node 154:233`) — Page `02F iOS Ride V2`
- **Context:** Merged PR #146 established waiting as a first-class state.
- **Specification:**
  1. Add property `waiting` (Boolean: `false` default, `true`).
  2. When `waiting = true`:
     - Render dashed zone before the boarding ring. Dash pattern: `[6, 4]`.
     - `DolRailMarker` marker offset sits in the dashed zone.
     - Marker stroke style switches to dashed (`dash: [4, 3]`).
  3. Code reference: `apps/ios/Shared/RideSurfaceComponents.swift` lines 490–515.

### 3.2 `돌이 RailMarker / V3` (`Node 295:1109`) — Page `02F iOS Ride V2`
- **Context:** Merged PR #149 added a smile expression for reliable moments.
- **Specification:**
  1. For variants where `role` is `.journeyActive`, `.journeyPrepare`, `.journeyNext`, or `.journeyArrival`:
     - Add vector arc representing the smile: `M 30,48 C 32,55 41,55 43,48` (within 72×72 artboard coordinates).
     - Stroke: `#FFFFFF`, lineWidth: `3.8 * unit` (approx 0.85 pt at 16 pt marker size), round cap.
  2. For variants where `role` is `.journeyDegraded` or `.journeyChecking`:
     - Degraded: squints (`DolFace.markerSquint` boxes), neutral mouth (no smile).
     - Checking: neutral mouth (no smile).
  3. Code reference: `apps/ios/Shared/RideSurfaceComponents.swift` lines 565–578.

### 3.3 `LiveActivity / Lock Screen V2` (`Node 156:420`) — Page `05 Live Activity`
- **Context:** Contrast audit identified that dimmed secondary copy on coral falls below WCAG AA.
- **Specification:**
  1. On the `moment=nextStop` variant (coral background `#C93C3C` in light, `#FF7A6E` in dark):
     - Secondary detail line (`RideText.detail`) MUST be drawn at **100% opacity** (`#FFFFFF` in light, `#0F171A` in dark).
     - Unit label (`정거장 남음`) MUST be drawn at **100% opacity**.
  2. Code reference: `apps/ios/Shared/LiveActivitySurfaces.swift` lines 34–45 (`secondaryOpacity = 1`).

---

## 4. Screen & Board Updates

### 4.1 Page `05 Live Activity · Dynamic Island` (`160:1208`)
- **Add Board:** `00 Waiting (오는 중)`
  - **State:** `RideGuidance.stopsBeforeBoarding != nil`
  - **Headline:** `365번 버스 오는 중`
  - **Numeral:** Number of stops until vehicle arrives at boarding stop (`state.stopsBeforeBoarding`)
  - **Detail line:** `탑승 정류장: 제주버스터미널`
  - **Rail:** Dashed waiting zone with dashed Dori marker.

### 4.2 Page `11 Marketing Web` (`Node 314:12`)
- **Update Hero Board:**
  - Verify Hero video frame reflects real Joham Coastal Road footage.
  - Credit text: `영상의 길은 조천–함덕 해안도로이며, 탑서 버스 주행 영상은 아닙니다.` (Source: Pixabay YounStudios).
  - Live Activity overlay: Labelled `앱 화면은 미리보기 · 합성 데이터`.
  - Rebind all color layers to the updated `TAPSO Web PR` variables.

---

## 5. Verification Checklist for Figma Editors

When manually applying these changes in Figma:
- [ ] Do not detach components. Maintain component inheritance across all screens.
- [ ] Verify that Pretendard (or Noto Sans KR fallback in Figma) text layers maintain Auto Layout without horizontal truncation.
- [ ] Check color contrast on Coral Lock Screen: white text on `#C93C3C` must measure ≥ 5.0:1.
- [ ] Export `marketing.json` using the local development plugin (`tools/figma-marketing`) to test variable integrity.
- [ ] Run `python3 scripts/design/validate_tokens.py` in the repo to verify that exported tokens match the canonical system.
- [ ] Mark sync status in `figma-sync-manifest.json` as `SYNCED` only after completing these steps.

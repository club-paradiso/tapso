# TAPSO Design System V3 Parity Audit

**Date:** 2026-10-29  
**Auditor:** Design System Consolidation Master Task  
**Reference Git Commit:** `ca223b4` (incorporating PR #146, #147, #148, #149)  
**Canonical Spec:** `docs/beta/DESIGN_DIRECTION.md`, `apps/ios/Shared/TapsoTokens.swift`, `RideSurfaceComponents.swift`, `LiveActivitySurfaces.swift`  
**Figma File:** `kkx04GvqOzHje7Dw5ikO9X` (`TAPSO — Product / Marketing Design System`)  

---

## 1. Executive Summary

This comprehensive audit catalogs discrepancies across the native iOS implementation, the marketing website (`apps/web`), and the Figma design specification following merged PRs #146 (Beta readiness & V3 basalt architecture), #147 (free-team field test harness), #148 (Jeju coastal-road film hero & Figma authoring pipeline), and #149 (Dori rail marker smile & live progress).

The current implementation in Swift (`TapsoTokens.swift`, `RideSurfaceComponents.swift`, `LiveActivitySurfaces.swift`) represents the authoritative ground truth for TAPSO V3.

| Severity | Count | Summary |
|---|---|---|
| **P0** (Critical truth / safety mismatch) | 4 | Old navy neutrals lingering in web tokens and marketing export; waiting state semantics missing in legacy Figma boards; contrast degradation on light surface mint labels; transit vehicle identity representation |
| **P1** (Parity / specification gap) | 6 | Dori PR #149 smile expression missing from Figma component; web theme.css hardcoded V2 dark mode hex values; Pretendard vs system font documentation in extensions; Figma V2 semantic collection naming drift; Lock Screen secondary opacity rules; snapshot evidence synchronization |
| **P2** (Polish / hygiene) | 5 | Stale V2 documentation headers; missing automated token validator script; email template inline color tokens; Figma node ID cross-reference map updates; legacy Figma archive status chips |

---

## 2. Discrepancy Matrix

### AUDIT-01: Neutral Palette Drift (Navy vs. Basalt/Shore/Stone)
- **Severity:** P0
- **Domain:** Color Tokens & Theming
- **Source Paths:**
  - `apps/ios/Shared/TapsoTokens.swift` (L15-25)
  - `apps/web/src/styles/tokens.css` (L14-20, L36-41)
  - `apps/web/src/styles/theme.css` (L8-19, L30-45)
  - `apps/web/src/design/marketing.json` (L4-5)
- **Figma Reference:** `TAPSO V2 Semantic` (`VariableCollectionId:151:14`), page `02F iOS Ride V2` (`152:2`), page `11 Marketing Web` (`218:2`)
- **Current Truth:**
  - In iOS V3: Neutral background is Basalt `#0F171A` (light `#FFFFFF`, dark `#0F171A`). Shore `#F3F5F4` (light) / `#172124` (dark) for secondary surfaces. Stone `#56636A` (light) / `#A9B6BA` (dark) for secondary copy. Separator is `#E1E6E4` (light) / `#2A373B` (dark). Text primary dark is `#EEF2F1`.
  - In Web: `tokens.css`, `theme.css`, and `marketing.json` still define `--ink: #071923`, `--mist: #f5fafb`, `--night: #071923`, `--separator: #dfe8eb` / `#274452`, `--text-secondary: #566973` / `#b4c4cb`.
- **Proposed Fix:**
  - Update `apps/web/src/styles/tokens.css` and `theme.css` to canonical V3 Basalt/Shore/Stone tokens.
  - Update `apps/web/src/design/marketing.json` to canonical V3 hex values.
  - Specify Figma variable collection update from `TAPSO V2 Semantic` to `TAPSO V3 Semantic` with exact hex mapping.

---

### AUDIT-02: Mint Text Contrast on Shore (mintDeep)
- **Severity:** P0
- **Domain:** Accessibility & Contrast Compliance
- **Source Paths:**
  - `apps/ios/Shared/TapsoTokens.swift` (L58)
  - `apps/web/src/styles/tokens.css` (L23)
  - `docs/beta/DESIGN_DIRECTION.md` (L22)
- **Figma Reference:** Variable `identity/mint-ink`
- **Current Truth:**
  - In iOS V3: `mintDeep` was adjusted to `#097666` (light) / `#2FC7AA` (dark) because the previous `#0B7F6D` on Shore `#F3F5F4` yielded only 4.49:1 (below WCAG AA 4.5:1). `#097666` yields 5.1:1 (compliant).
  - In Web: `--mint-ink: #0b7f6d` still exists in `tokens.css` (L23) and `theme.css` (L43).
  - In Figma: `identity/mint-ink` is documented as `#0B7F6D`.
- **Proposed Fix:**
  - Reconcile web `--mint-ink` to `#097666`.
  - Specify Figma token update for `identity/mint-ink` to `#097666` in light mode.

---

### AUDIT-03: JourneyRail Waiting Zone & Dori Smile Parity
- **Severity:** P1
- **Domain:** iOS UI & Dynamic Island Components
- **Source Paths:**
  - `apps/ios/Shared/RideSurfaceComponents.swift` (L365, L509-514, L551-580)
  - `docs/exec-plans/DORI_RAIL_ACTIVITYKIT.md`
- **Figma Reference:** `JourneyRail / V2` (`154:233`), `돌이 RailMarker / V3` (`295:1109`), page `02F iOS Ride V2`
- **Current Truth:**
  - In iOS (PR #146 & #149):
    1. `JourneyRail` features a dedicated dashed waiting zone before the boarding ring when `stopsBeforeBoarding != nil`. The rail marker uses a dashed rim (`waiting = true`).
    2. PR #149 added a subtle smile (`markerSmile` arc: `x0: 30, x1: 43, y: 48, cx: 36.5, cy: 55`) to `DolRailMarker` for reliable states (`role != .journeyDegraded && role != .journeyChecking`). Degraded states remain neutral or squinting.
  - In Figma:
    - Figma `JourneyRail / V2` variants only have `early`, `late`, `next` without explicit waiting zone dashed variants.
    - Figma `돌이 RailMarker / V3` does not yet show the PR #149 smile vector path.
- **Proposed Fix:**
  - Create Figma specification for `JourneyRail` waiting variant (`waiting=true`) with dashed track and dashed marker rim.
  - Provide exact vector instructions for adding `markerSmile` to `돌이 RailMarker / V3`.

---

### AUDIT-04: First-Class Waiting State vs Bus-to-Destination Miscount
- **Severity:** P0
- **Domain:** Transit Guidance Domain & Safety
- **Source Paths:**
  - `apps/ios/Shared/RideSurfaceComponents.swift`
  - `apps/ios/Shared/LiveActivitySurfaces.swift`
  - `packages/transit-core/Sources/TapsoTransit/JourneyContract.swift`
- **Figma Reference:** `03 iOS — GO › iOS — GO · Product V2 + V3` (`205:3310`), `05 Live Activity` (`160:1208`)
- **Current Truth:**
  - Merged PR #146 contract mandates that prior to vehicle arrival at the boarding stop, every surface (in-app ride hero, Lock Screen, Dynamic Island compact/minimal/expanded) displays stops before boarding (`stopsBeforeBoarding`), never the bus-to-destination count.
  - Legacy Figma boards in `04 iOS — RIDE` and early `05 Live Activity` showed the destination remaining count even when the bus was approaching the pickup point.
- **Proposed Fix:**
  - Document the required update to Figma `05 Live Activity` to reflect the "오는 중" waiting state row with dashed rail and boarding countdown.

---

### AUDIT-05: Pretendard Font Registration and Fallback Rules
- **Severity:** P1
- **Domain:** Typography Specification
- **Source Paths:**
  - `apps/ios/Shared/TapsoTokens.swift` (L115-185)
  - `docs/beta/DESIGN_DIRECTION.md` (L37-51)
  - `docs/product/DESIGN_SYSTEM_V2.md` (L84-90)
- **Figma Reference:** `01 Foundations`, `00 Cover / Index`
- **Current Truth:**
  - Pretendard 1.3.9 (SIL OFL 1.1) is bundled strictly in the main app target.
  - In extensions (Live Activity, Share), Pretendard is NOT registered; system fonts (SF Pro / SF Pro Rounded) are used intentionally for tight memory budgets and rendering stability.
  - In Figma: Noto Sans KR and Inter are used as stand-ins because SF fonts render with zero width in this Figma runtime.
- **Proposed Fix:**
  - Add explicit note in token manifest and Figma handoff documenting the target-specific font boundary: App target = Pretendard; Extensions = SF Pro Rounded / System.

---

### AUDIT-06: Lock Screen Contrast Escalation & Secondary Text Opacity
- **Severity:** P1
- **Domain:** Surface Accessibility
- **Source Paths:**
  - `apps/ios/Shared/LiveActivitySurfaces.swift` (L10-53)
  - `docs/beta/DESIGN_DIRECTION.md` (L24-35)
- **Figma Reference:** `LiveActivity / Lock Screen V2` (`156:420`), page `05 Live Activity`
- **Current Truth:**
  - `RideSurfacePalette`:
    - Normal (riding, prepare, degraded): Basalt background `#0F171A`, text `#FFFFFF`, secondary opacity `0.70` (contrast 9.3:1).
    - Next Stop: Coral background `#C93C3C` (light) / `#FF7A6E` (dark), text on urgent, secondary opacity **1.0** (full strength, because 0.70 dropped below 4.5:1).
    - Arrival: Tangerine background `#F7972F`, text `#0F171A`, secondary opacity `0.72` (contrast 4.8:1).
  - Count unit label is `1.0` (full strength) across all surfaces.
  - Figma components in `156:420` occasionally carry 70% opacity uniformly across coral, violating WCAG AA on light mode.
- **Proposed Fix:**
  - Explicitly specify Figma Lock Screen coral variant layers to have 100% opacity for secondary copy and count labels.

---

### AUDIT-07: Hero Film Licensing and Distinction Truthfulness
- **Severity:** P0
- **Domain:** Marketing Website & Honesty Contract
- **Source Paths:**
  - `apps/web/src/sections/Hero.tsx`
  - `apps/web/src/content/media.ts`
  - `docs/product/WEB_MEDIA_SOURCES.md`
- **Figma Reference:** `11 Marketing Web` › `Web PR / Coast film hero`
- **Current Truth:**
  - Merged PR #148 hero footage is real aerial drone footage of a car on Joham Coastal Road (조천–함덕 해안도로), Jeju, licensed from YounStudios via Pixabay Content License.
  - It is NOT a TAPSO bus ride. The site explicitly displays: "영상의 길은 조천–함덕 해안도로이며, 탑서 버스 주행 영상은 아닙니다."
  - The drawn Lock Screen overlaid on the film is a synthetic preview of Route 365.
  - Previous AI-generated liquid lens assets (`jeju-journey.mp4`, `jeju-coast.webp`) have been fully retired.
- **Proposed Fix:**
  - Ensure marketing documentation, token export, and Figma web boards reflect the exact Pixabay licensing terms and non-bus attribution disclosure.

---

### AUDIT-08: Marketing Responsive Breakpoints Audit
- **Severity:** P1
- **Domain:** Web Front-End
- **Source Paths:**
  - `apps/web/src/styles/coast.css`
  - `apps/web/src/styles/sections.css`
  - `apps/web/src/styles/surfaces.css`
- **Figma Reference:** `11 Marketing Web` (`218:2`): `1440` (`219:2`), `1280` (`231:2`), `390` (`241:2`), `360` (`258:2`)
- **Current Truth:**
  - Breakpoints tested: 360 px, 390 px, 768 px, 1280 px, 1440 px.
  - 360/390 px mobile: Persistent Dynamic Island docks at bottom above home indicator (`env(safe-area-inset-bottom)`). Hero video switches to portrait crop (`joham-coast-portrait.mp4`).
  - Reduced-motion: Video disabled, still poster WebP displayed, auto-play stopped.
- **Proposed Fix:**
  - Verify that all CSS media queries in `coast.css` and `theme.css` align with the four Figma frame widths and 768 px tablet.

---

### AUDIT-09: Token Manifest & Automated Drift Detection
- **Severity:** P2
- **Domain:** Tooling & Governance
- **Source Paths:**
  - Currently missing single machine-readable canonical token JSON that generates or validates Swift, CSS, and Figma tokens.
- **Figma Reference:** `TAPSO V2 Semantic` / `TAPSO Web PR`
- **Current Truth:**
  - Tokens are manually coordinated across `TapsoTokens.swift`, `tokens.css`, `marketing.json`, and Figma variables.
- **Proposed Fix:**
  - Establish `packages/transit-core/Sources/TapsoTransit/Resources/tapso-tokens.json` or `tools/tokens/tokens.json` as canonical token schema.
  - Implement validation script `scripts/design/validate_tokens.py` to prevent token drift between Swift, web CSS, and marketing JSON.

---

### AUDIT-10: V2 Legacy Documentation Clarification
- **Severity:** P2
- **Domain:** Documentation Hygiene
- **Source Paths:**
  - `docs/product/DESIGN_SYSTEM_V2.md`
  - `docs/product/FIGMA_IMPLEMENTATION_MAP_V2.md`
- **Figma Reference:** `13 Archive`, `00 Cover / Index`
- **Current Truth:**
  - Headers mention 2026-10-20 basalt supersession, but readers may be confused by lingering V2 hex tables.
- **Proposed Fix:**
  - Add explicit notice banners at the top of V2 documentation files, clearly pointing to V3 canonical specs and marking historical sections.

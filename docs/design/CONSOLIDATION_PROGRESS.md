# TAPSO Design System V3 Consolidation — Progress Tracker

**Date:** 2026-10-29  
**Mission:** Unify the implementation-backed TAPSO V3 design system across the native iOS app, Figma specification, and marketing website.  
**Branch:** `design/v3-system-consolidation`  
**Base Commit:** `ca223b4` (incorporating PR #146, #147, #148, #149)  

---

## Verification & Status Summary

| System / Component | Status | Verification Method & Evidence |
|---|---|---|
| **Canonical Token Manifest** | `IMPLEMENTED` | `design/tokens/tokens.json` validated by `scripts/design/validate_tokens.py` |
| **iOS Swift App & Extensions** | `VERIFIED_SIMULATOR` | `xcodebuild` iOS Simulator (iPhone 16) test suite passed (135 tests, 0 failures) |
| **Transit Core Engine** | `IMPLEMENTED` | `swift test --package-path packages/transit-core` passed (371 tests, 0 failures) |
| **iOS Physical Hardware** | `NOT_TESTED` | Physical device testing requires personal team/hardware field protocol (Gates 4 & 5) |
| **APNs Live Activity Delivery** | `BLOCKED` | Awaiting paid Apple Developer Team enrollment and `.p8` key from repository owner |
| **Marketing Website (apps/web)** | `IMPLEMENTED` | 132/132 tests passed; Vercel typecheck passed; SSR production build passed |
| **Figma Workspace & Updates** | `PENDING_MANUAL_WRITEBACK` | Full specification generated in `FIGMA_EDIT_HANDOFF.md` and `figma-sync-manifest.json` |

---

## Phase Execution Checklist

### Phase 1 — Discovery & Worktree Setup
- [x] Clean worktree audit, fetch origin/main, verify merged PR #146, #147, #148, #149.
- [x] Create dedicated feature branch `design/v3-system-consolidation`.
- [x] Read core design & strategy documents (`DESIGN_DIRECTION.md`, `DESIGN_SYSTEM_V2.md`, `FIGMA_IMPLEMENTATION_MAP_V2.md`, `MARKETING_SITE_V3.md`, `WEB_MEDIA_SOURCES.md`, `RELEASE_DECISION.md`).
- [x] Complete discrepancy audit across tokens, typography, basalt palette, rail, Dori, iOS states, marketing web, and Figma.
- [x] Produce `docs/design/DESIGN_PARITY_AUDIT.md`.

### Phase 2 — Canonical Design Contract
- [x] Establish canonical machine-checkable token manifest in `design/tokens/tokens.json`.
- [x] Preserve light/dark semantics, contrast ratios (AA compliance), Pretendard registration, SF Pro Rounded extension fallback.
- [x] Implement automated drift validation script `scripts/design/validate_tokens.py`.
- [x] Mark superseded V2 documentation in `docs/product/DESIGN_SYSTEM_V2.md` and `docs/product/FIGMA_IMPLEMENTATION_MAP_V2.md`.

### Phase 3 — iOS Parity
- [x] Audit and reconcile iOS SwiftUI components with V3 contract (`JourneyRail`, `DolBuddy`, `DolRailMarker` smile from PR #149, waiting states, degraded states).
- [x] Validate multilingual layout & review flags (`check_localization.py`: 561 keys across ko, en, zh-Hans, ja).
- [x] Validate Korean UX copy with `kolint` (0 findings, 0 blocking).
- [x] Execute XcodeGen sync (`sync_xcodeproj.py --check` passing).
- [x] Run iOS simulator builds and tests (`xcodebuild` on iPhone 16 simulator: 135 tests passed, 0 failures).
- [x] Accurately record verification status (`VERIFIED_SIMULATOR` vs `NOT_TESTED` for physical hardware).

### Phase 4 — Marketing Website Parity
- [x] Reconcile `apps/web` tokens (`marketing.json`, `tokens.css`, `theme.css`) to canonical V3 Basalt/Shore/Stone/Separator and mintDeep palette.
- [x] Preserve PR #148 real Joham coastal road film hero, responsive sources, licensing, and reduced-motion behavior.
- [x] Preserve PR #149 Dori rail marker refinements.
- [x] Audit responsive breakpoints (360, 390, 768, 1280, 1440 px), contrast, keyboard navigation, synthetic labels.
- [x] Run web tests (132 passed), typechecks, and production SSR build.

### Phase 5 — Figma Handoff
- [x] Inventory and map Figma structure across all pages and boards.
- [x] Produce node-level editing specification (`docs/design/FIGMA_EDIT_HANDOFF.md`).
- [x] Generate machine-readable `design/figma-sync-manifest.json`.
- [x] Detail 7-part workspace organization plan (START HERE, DESIGN SYSTEM V3, iOS CURRENT, LIVE ACTIVITY, MARKETING CURRENT, LAB / ROADMAP, ARCHIVE).

### Phase 6 — Governance & Automation
- [x] Update GitHub Actions CI (`.github/workflows/ci.yml`) to include `validate_tokens.py`.
- [x] Create pull request template (`.github/pull_request_template.md`) with design parity and token compliance gates.
- [x] Tie snapshots and handoffs to git commit SHAs.

### Phase 7 — Full Validation
- [x] Complete end-to-end execution of verification commands. All checks green.
- [x] Document hardware and account blockers honestly without fabrication.

### Phase 8 — Deliver
- [ ] Commit verified changes to feature branch `design/v3-system-consolidation`.
- [ ] Open GitHub Pull Request with file-by-file summary, test outputs, risks, and blockers.
- [ ] Deliver autonomous master mission report.

# Mobile-first marketing landing page

## Outcome and scope
Make TAPSO understandable on a phone with a compact cinematic hero, four-stage interactive journey and progressive disclosure. Preserve desktop narrative, existing product states, all detailed information, approved campaign copy and development caveats. No iOS/backend changes.

## Baseline / reality
Base main: dfb5f6bb85da86be4c029ed283ffab92e908a551; production READY at this SHA. Existing mobile: two-row header, 720px minimum hero, 11 beats in five chapters, repeated inline phones, full 10-item status timeline, support and 12 FAQ rows. Status data and honesty tests remain authoritative. No physical iPhone or bus validation exists.

## Milestones
- [x] Inspect live page, architecture and repository rules.
- [x] Capture six viewport baselines and section heights.
- [x] Implement mobile navigation, four-stage reuse and disclosures.
- [x] Validate interactions, themes, reduced-motion JS simulation, anchors/back, no-JS and desktop.
- [x] Pass 199 web tests, deployed-surface typecheck and production build.
- [ ] Review diff, create PR, wait for CI/preview, merge and verify production.

## Decisions
Mobile uses the existing beat renderer; no second ride simulation. Native details preserve no-JS content. A responsive details wrapper opens automatically on desktop but defaults closed on mobile. Direct links into hidden detail open ancestor disclosures. Native anchor history is preserved. Counts come from STATUS_ITEMS and keep levels separate.

## Validation and evidence
Use cloud-browser screenshots and DOM layout measurements. The cloud tool has no resize API, so a temporary local QA harness frames the actual production URL at 320×568, 375×812, 390×844, 430×932, 768×1024, 1440×900. The same harness frames local/preview after changes. Harness is removed before commit. No real-device or performance gain claims from desktop emulation.

Commands: npm --prefix apps/web test; npm --prefix apps/web run typecheck:vercel; npm --prefix apps/web run build. No lint or E2E script exists in package.json; rendered interaction QA supplements unit/source guards.

## Progress / next action
Implementation and cloud-browser QA complete. All six CSS viewport sizes were measured in frames (classic scrollbar takes 15px; 430/768/1440 screenshots scaled to fit the outer browser). Default document heights before → after: 320: 17,609 → 4,202; 375: 16,825 → 4,041; 390: 16,623 → 3,994; 430: 16,468 → 3,972; 768: 15,235 → 3,623; 1440: 12,597 → 12,598. Desktop journey stays 6,201px. 390px journey: 8,849 → 1,044px. Seven main sections remain; default walkthrough previews 11 → 1 and FAQ rows 12 → 3. All four stages require three optional stage selections after the initial stage; no autoplay or scroll hijacking.

Verified native menu Enter/Escape/focus return/Tab exit, all stage screens and ride views, full 10-item status, all 12 FAQ answers, theme switch, deep #trust reveal and browser Back to #how. 200% root text at 320px: 305px client width and scroll width, no overflow. No-JS prerender: four-stage text and all 11 detailed beats accessible. Reduced-motion matchMedia test fixture: both video elements paused, opacity zero and no source; this is a JS environment simulation, not a physical OS/device test. Touch controls measured ≥44px. Canonical token contrast validator passed; full assistive-technology audit is not claimed.

Additional validation: API and evidence-tooling TypeScript checks, localization/brand/Xcode membership checks passed. No lint/E2E package script exists. Main JS gzip 84.01 → approximately 86.1kB; CSS gzip 16.57 → 17.98kB. Do not describe page-height reduction as a runtime speed gain. CLS and mobile Safari performance were not benchmarked.

Next action: review complete diff, push feature branch, open PR, verify green CI and Vercel preview before merge; then confirm production READY at merge SHA. QA-only harness/fixtures must never enter commit or dist.

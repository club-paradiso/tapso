# Marketing reality audit — 2026-10-30

## Outcome and scope
Align the existing marketing page with observed product and release evidence, retaining its visual journey and media. iOS, matching and transit behavior are out of scope.

## Evidence and decisions
- Production `GET https://tapso-api.vercel.app/health` on 2026-10-30: Redis sessions enabled, shadow matching, automatic selection disabled, Live Activity push and hybrid tracking disabled. This is a configuration observation, not a passenger ride test. `docs/DEVICE_TEST_PLAN.md` still describes sessions as unavailable; that statement predates the production switch.
- App and simulator paths exist, including optional location-based keep-alive (`RideKeepAlive.swift`); `artifacts/device-validation/` contains only README and template. `docs/beta/RELEASE_DECISION.md` records no physical ride or APNs evidence and no paid team. Public TestFlight availability is not evidenced.
- Place search, map sharing, missed-stop and last-bus logic are implemented. Share extension and ride behavior are not physically verified; TAGO Jeju route metadata lacks last-departure values, so no actual time can be promised from it.
- Vercel production environment listing contains public support settings but no Supabase or Resend settings. Waitlist storage and delivery cannot be established; the form is removed until end-to-end operation is verified. Native support config reports unavailable. Buy Me a Coffee page returns HTTP 200; no payment was made. Toss deep link and bank recipient exist but transfer completion was not tested.
- PRs #170–173 preserve the wordmark, avoid negative map comparison, restore boarding text and retain mobile navigation and accessibility.

## Milestones
- [x] Inspect source, live health, configuration, recent changes and release evidence.
- [x] Replace unavailable preorder promises, correct permission claims, condense status and add guards.
- [x] Verify web tests, build, Korean lint, rendering and controls.
- [x] Preview, PR and required checks; merge only if all release gates pass.

## Verification record (2026-10-30, head `a65e4f7`)
- iOS CI failure cause: PR #170 draws the web wordmark as `TAPS` plus a same-font `O` span with a CSS macron, so `Header.tsx` and `Footer.tsx` no longer contain the literal `TAPSŌ` that `scripts/ios/check_brand.py` searched for. The check now verifies that structure (split O span or literal, accessible name `TAPSO`, no Korean suffix, `.brand-word-o` font and `::after` macron rules); negative controls are in `scripts/ios/test_check_brand.py` and run in CI.
- Local Xcode 26.3, iPhone 17 simulator created on iOS 26.3: `xcodebuild build` succeeded; the test run executed `TapsoTests` with 0 failures, then the machine ran out of disk (`No space left on device`) before xcodebuild printed its final line. The CI `ios` job is the complete pass. This is simulator evidence only, not an iPhone or a ride.
- Preview of the head, opened in the built-in browser with no authentication change: no console errors; four hero films play and cross-fade; no horizontal page overflow at 320, 360, 390, 430, 768, 1280, 1440 px (the nav list and one segmented control scroll on purpose); 19 in-page anchors all resolve; no form, no external link, no payment CTA; the status, FAQ (last bus) and Dynamic Island demo respond; focus ring is a 3 px solid outline; axe-core 4.10.2 reports 0 violations in light and dark (contrast on text over the film is not machine-decidable and was checked by eye on sampled frames).
- Reduced Motion and Save-Data were emulated in a same-origin frame by patching `matchMedia` and `navigator.connection`: with Reduced Motion the film is paused on its first frame and does not rotate; with Save-Data no film source loads. These are emulations, not the operating-system setting.
- Still unverified: a real iPhone, a real ride, APNs, waitlist storage and mail, a completed support payment.


## Risks / next action
A working payment and physical iPhone cannot be inferred from URLs or simulator tests. Recheck current CI and Vercel Preview before merging. Verify waitlist storage and email using an owner-controlled address before restoring its CTA. Document any failed verification rather than treating it as complete.

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
- [ ] Verify web tests, build, Korean lint, rendering and controls.
- [ ] Preview, PR and required checks; merge only if all release gates pass.

## Risks / next action
A working payment and physical iPhone cannot be inferred from URLs or simulator tests. Recheck current CI and Vercel Preview before merging. Verify waitlist storage and email using an owner-controlled address before restoring its CTA. Document any failed verification rather than treating it as complete.

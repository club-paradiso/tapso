# Mobile Web UX — TAPSO marketing site (tapso-nu.vercel.app)

## 1. User-visible outcome

On iPhone-width screens (320–430px) a visitor can:

- reach every in-page section from the header (타는 법 / 흔들릴 때 / 개발 현황 /
  후원하기 / FAQ) without scrolling to the footer first;
- read the hero status line and film credit without squinting, and tap every
  control with a ≥44px target, including the Dynamic Island demo;
- complete the 사전예약 (waitlist) form with the first invalid field focused
  automatically when submission is blocked;
- use the 후원 (support) bottom sheet with scroll chaining contained, a
  screen-reader announcement when the 제주은행 account number is copied, and
  an explicit error when a custom amount is out of range;
- keep content clear of the notch / home indicator via safe-area insets.

Non-goals: no copy changes to the journey steps (recent commits deliberately
tuned them, incl. the stop/address/building destination wording); no hero
film controls or height changes (guarded by `calmMotion.test.ts`); no new
fixed/sticky bars; KakaoPay is not reintroduced (guarded by
`supportTransferLinks.test.ts`); desktop layout and the Figma token system
are unchanged except where a rule is provably mobile-only.

## 2. Verified constraints (audit of origin/main 6c16346 + live page)

- Header nav was `display: none` below 960px — mobile had no in-page nav.
- Header row (brand 32px mark + wordmark, icon-only theme toggle, 사전예약
  CTA) is within ~4px of overflowing a 320px viewport.
- `.dock-button` (Dynamic Island demo) inherited the island's own height:
  ≈28–32px tall, below the 44px touch minimum (`--touch-min`).
- `.container` ignored `env(safe-area-inset-*)`; the footer ignored the
  bottom inset. The support sheet already respected the bottom inset.
- Waitlist submit blocked on an invalid email/consent but never moved focus
  to the offending field; the support dialog's custom amount failed silently
  (button stayed disabled, no error text, no `aria-invalid`).
- The bus-view segmented control wrapped its longest tab ("비슷한 버스가 있을
  때") onto two lines on narrow screens.
- Hero status line dropped to 13px and the film credit to 11px on mobile.
- `theme-color` was a single static `#ffffff`, so a dark-mode phone still
  painted the browser chrome white.
- Already correct and preserved: IslandDock is an in-flow demo (not a fixed
  overlay); hero film honours `prefers-reduced-motion` + Save-Data and
  pauses off-screen; form inputs are 16px (no iOS focus zoom); the support
  sheet is a native `<dialog>` bottom sheet with safe-area padding; Toss
  one-tap transfer, 제주은행 account copy and Buy Me a Coffee are the only
  support routes.

## 3. Milestones

1. Mobile header: nav becomes a horizontally scrollable second row in the
   sticky header (≤959px); the header stays opaque on mobile so the row is
   readable over the hero film; anchors get matching `scroll-padding-top`.
2. Safe areas + touch targets + hero/segmented readability fixes (CSS only).
3. Waitlist focus management; support-dialog copy announcement, custom
   amount error, overscroll containment.
4. `test/mobileUx.test.ts` guards the new behaviour in the existing
   `npm test` suite; local Playwright pass at 320/375/390/430px, light and
   dark, exercising nav, form errors, FAQ and the support sheet.
5. PR with green CI → merge → verify the Vercel production deployment.

## 4. Decisions

- Scrollable nav strip over a hamburger menu: no hidden state, no extra
  focus trap to build, every destination visible with one swipe, and the
  existing `<nav>`/NAV_ITEMS DOM (and its tests) stay untouched.
- Mobile header is opaque even over the film (desktop keeps the transparent
  over-film treatment): the taller two-row header cannot stay in sync with
  the hero's fixed -64px overlap, and white text over a light strip would
  be unreadable. The hero film overlap is removed on ≤959px instead.
- No hero pause button: `calmMotion.test.ts` records the deliberate product
  decision that the film has no on-page controls; reduced-motion and
  Save-Data visitors already get the still poster.

## 5. Verification

```bash
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
npm --prefix apps/web run build
# + local Playwright screenshots/interactions at 320/375/390/430 (light/dark)
```

## 6. Progress

- 2026-10-30: audit complete (code + live page text); implementation in
  progress on `feat/mobile-ux-20261030`.
- 2026-10-30: implementation complete. Two extra defects found by the
  browser pass and fixed here: the theme toggle rendered 39px wide (icon-
  only at ≤959px), and the island dock note printed a literal "$" before
  접기/펼쳐보기 (a `${...}` typed as JSX text). Axe also flagged the dock
  button with label-content-name-mismatch (serious): the aria-hidden
  island's visible text "3655정거장" can never appear inside its spoken
  label, so the toggle now overlays the graphic on a `.dock-stage` that
  carries the 44px minimum instead of wrapping the graphic's text.
- 2026-10-30: verification evidence (local build with dummy public env):
  - `npm test` 174/174 (164 existing + 10 new mobileUx guards);
    `typecheck:vercel`, transit-API and scripts typechecks, `npm run
    build`, and the CI Figma Code Connect parse dry-run all pass.
  - Playwright at 320/375/390/430px: horizontal overflow 0 everywhere;
    header 102px with 44px nav links; CTA inside the viewport (right edge
    304 at 320px); anchor jumps land at the 124px scroll padding; journey
    segmented tabs one line at 44px; dock stage/button 169×44; FAQ opens;
    waitlist empty submit focuses the email field, email-only submit
    focuses the consent checkbox; support sheet is a bottom sheet with
    44×44 close, Toss/copy/Buy Me a Coffee present, KakaoPay absent, copy
    writes the account number and flips the label, Escape closes.
  - Axe (full page, island expanded): 0 violations in light and dark.
  - Desktop 1280px regression: header 65px and transparent over the film,
    nav inline, hero overlap -64px preserved, overflow 0.
  - Reduced motion: hero video has no src, stays paused at opacity 0.
- 2026-10-30 (follow-up from the live-site audit): the support sheet's
  title and close button scrolled away with its content. The header now
  sits outside the scrolling body (`[open]` flex column; body is the
  scroller) — verified in the browser: after scrolling the sheet body
  409px at 390px (366px on desktop) the 44px close button stays inside
  the dialog and still closes it, and axe stays at 0 violations with the
  dialog open. The audit's other small-target worries measured fine:
  footer links are 44px tall, FAQ rows 64–88px, and the waitlist consent
  label's clickable area is 44×318px (tapping it toggles the box).

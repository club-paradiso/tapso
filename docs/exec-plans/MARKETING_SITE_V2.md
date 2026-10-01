# ExecPlan: Marketing site V2

Spec and design record: `docs/product/MARKETING_SITE_V2.md`. This plan tracks the work.

## Outcome and non-goals

A first-time visitor understands in seconds that TAPSO is an iPhone companion that watches the bus they are on and tells them when to get off, and in a minute how a ride works, why the physical bus is confirmed, what the Lock Screen and Dynamic Island show, how uncertainty is handled, and how TAPSO sits next to KakaoMap and NAVER Map; then joins the TestFlight waitlist.

Non-goals: a browser version of TAPSO; any change to the iOS app, the Swift core, the transit API or the matcher; enabling payments; a framework migration; analytics.

## Verified constraints (reality labels)

- `IMPLEMENTED` Product V2 on synthetic data; `READY_FOR_SHADOW` matcher readiness, automatic selection off; APNs `BLOCKED_BY_CREDENTIALS`; TestFlight `BLOCKED_BY_PAID_MEMBERSHIP` (README, `KNOWN_ISSUES.md`).
- `BLOCKED_BY_CREDENTIALS` waitlist persistence and mail; `NOT ENABLED` support payment (`WAITLIST_SUPPORT_SETUP.md`).
- Map hand-off: paste intake and a NAVER Map name search are built; KakaoMap is not offered (`MAP_APP_HANDOFF_V2.md`).
- The authoring environment reached GitHub, npm and Figma's API, but not `*.vercel.app`, jsDelivr or Figma's upload host.

## Milestones

1. **Audit** — V1 findings classified P0–P2 with evidence. Done (spec › Audit).
2. **Architecture and tokens** — V2 tokens, section components, pure demo models. Done.
3. **Sections and demos** — hero, ride story, bus identity, native surfaces, attention, trust, maps, privacy, status, waitlist, support, FAQ, footer. Done.
4. **Honesty** — product copy from the iOS string table, moment table from the Swift policy, claim guard in tests and in the build, fail-closed waitlist and support states. Done.
5. **Quality** — rendered review at 375, 390, 430, 768, 1024, 1280, 1440, 1728 with no horizontal overflow; interaction, keyboard, reduced-motion and axe passes; Lighthouse. Done locally.
6. **Delivery** — branch `feat/marketing-site-v2`, draft pull request, CI, Vercel Preview. Preview check is open (see Progress).

## Decisions

- **Prerender at build time** (`vite build --ssr` + `scripts/prerender.mjs`) rather than migrating to a framework: the page is static content with small demos, and the stack stays React 19 + Vite.
- **Stepper demos, not scroll-driven animation**: every state is a button, so keyboard, screen reader and Reduced Motion users get the same demo.
- **Quote, don't paraphrase**: product strings are keyed to `Localizable.strings` and tested.
- **Support moved out of the waitlist form** into its own section so the form has one action; the support sheet itself is unchanged.
- **Figma**: an IA and code-mapping board on `03 Web` instead of a hand-redrawn duplicate of the page; V1 frames marked superseded. Rejected: rebuilding the whole page as Figma components, which would duplicate the code's responsive layout without adding a source of truth.

## Reproduction

```bash
cd apps/web
npm ci
npm test                    # 118 tests, including productParity, demoStory, siteHonesty
npm run typecheck:vercel
npm run build               # includes prerender and the rendered-text claim guard
npx vite preview            # http://localhost:4173
npx --yes --package=@figma/code-connect@2.0.0 figma connect parse --config figma.config.json --dry-run
```

## Progress

- [x] Audit, IA, tokens, components, sections.
- [x] Tests: product parity (mutation-checked: a changed count presentation and a changed string both fail), demo invariants, honesty.
- [x] Rendered QA at eight widths, interactive states, keyboard order, dialog focus, Reduced Motion, axe (0 violations across all states), Lighthouse (local).
- [x] Figma `03 Web` board; V1 frames labelled superseded; Code Connect parse passes.
- [ ] Vercel Preview: confirm build, `/api/waitlist` 503 path in the browser, `/api/support/config` `unavailable`, social card, fonts. Not reachable from the authoring environment.
- [x] ~~Place 1440/390 captures from the Preview in Figma section `165:54`.~~ Superseded on 2026-10-01 by the V3 frames (`docs/product/MARKETING_SITE_V3.md`); `165:54` is archived.

## Risks and next action

Next action: open the Vercel Preview for the pull request and run the checks above. Risk: the page describes the intended experience ("폰은 넣어두고") ahead of the APNs path; the FAQ and status carry the current limit, and must be updated when remote updates ship.

# Marketing site V3

The public page at [tapso-nu.vercel.app](https://tapso-nu.vercel.app), built from `apps/web`. V3 replaces the hero and the five product sections of V2 (ride story, bus identity, Lock Screen and island, phone away, trust) with **one ride told by the Dynamic Island**. Sections 06–11 (map apps, privacy, status, waitlist, support, FAQ) and every backend are V2's, unchanged (`MARKETING_SITE_V2.md`).

The page still presents TAPSO; it is not TAPSO. Every phone, Lock Screen and island is a labelled re-drawing on synthetic data.

## Audit of V2 (2026-10-01, `main` at `cd806f6`)

Severity as in V2: **P0** misrepresents the product; **P1** blocks understanding or quality; **P2** polish.

| # | Finding | Status |
|---|---|---|
| P0-1 | The hero's floating island sat beside a Lock Screen phone. On iPhone a Live Activity shows on the Lock Screen *or* in the island (another app in front), not both on one screen | `FIXED`: the hero shows two phones, Lock Screen and Home Screen, each drawing its own surface |
| P0-2 | The social card (`public/og.png`) still carried the V1/V2 headline and the old demo destination (제주출입국·외국인청), renamed in #69 | `FIXED`: re-rendered from the page's own components by `scripts/render-og.mjs`; social titles follow the hero |
| P1-1 | Twelve sections with five separate demos (stepper, bus road, moment rail, glance chart, trust chips), each with its own state: the ride was explained five times rather than told once | `FIXED`: one journey, chapters 01–05, read top to bottom |
| P1-2 | The island lived in one static card; it was not the storytelling device the product makes it | `FIXED`: a persistent island follows the ride across the page (below) |
| P1-3 | The page never showed *when* the Live Activity starts. It starts at the rider's confirmation (`TapsoAppModel.confirmVehicle` → `startLiveActivity`), and that is the product's promise: nothing before the rider says which bus | `FIXED`: the island is empty through chapters 01–02 and appears at the confirmation step; pinned by a test that reads the Swift |
| P1-4 | 390 px: the ten story steps were a horizontal rail wider than the screen (contained, but most steps off screen) | `FIXED`: steps are ordinary content, each with its own picture on narrow screens |
| P1-5 | The header turned grey over the dark bands (86 % white); secondary text fell to 4.27:1 | `FIXED`: 95 % (≥ 5.2:1) |
| P2-1 | Coral, blue and slate on the black island used their light-surface values (coral 4.19:1) | `FIXED`: dark-surface values on the island, as on the Lock Screen |
| P2-2 | Tilted phones and gradient blobs read as a template | `FIXED`: upright devices; the only glow is the current moment's colour |

## Concept

> 버스를 확인한 순간부터, 아일랜드가 탑니다.

The page is one synthetic ride on 365 from 제주버스터미널 to 제주시청(아라방면). The island is its narrator: empty while the rider plans and confirms, alive from the confirmation, counting down, honest when the data is shaky, escalating at two stops, the next stop and arrival, and gone when the ride ends.

## Island Story Engine

| Piece | File | Role |
|---|---|---|
| Model | `src/story/beats.ts` | 11 beats in 5 chapters. A beat says where the phone is (`app`, `lock`, `home` with an island form) and what TAPSO's Live Activity shows (`null` or a moment and a count). How a moment looks comes from `presentMoment`, the web mirror of `RideGuidancePolicy` |
| Words | `src/story/journeyCopy.ts` | Chapter and step copy, and the trust notes; product strings themselves come from `rideCopy.ts` (the iOS string table) |
| Store | `src/story/storyStore.ts` | Which beat is being read, the visitor's picks, whether the hero is on screen. Every mirror subscribes here, so the sticky phone, the step pictures and the island cannot disagree |
| Tracking | `useStoryTracking` | The last step whose top has passed a reading line at 56 % of the viewport, recomputed per animation frame after scroll or resize. Reading only: the page is never scrolled, pinned or slowed |
| Island | `components/NativeSurfaces.tsx` › `Island` | One shape that morphs between idle (the bare hardware), compact, expanded and minimal (TAPSO detached as a circle while another app holds the island), sized in em so it fits a drawn phone and the dock |
| Dock | `components/IslandDock.tsx` | The persistent island |

Rules pinned by `test/islandStory.test.ts`:

- the story starts with where to get off, and chapters never go back;
- no Live Activity before the rider confirms the bus, and the app starts one only from `confirmVehicle` (for a live ride through the private `confirmLiveVehicle`, once the server has accepted the rider's confirmation) or resumes it in `resumeIfNeeded`, read from `TapsoAppModel.swift`;
- the app in front never shows its own activity in the island;
- stops only count down: 2 at prepare, 1 at the next stop, 0 at arrival, riding only with 3 or more;
- each milestone is told once, and only milestones alert;
- shaky data never alerts and never shows a fresh count;
- the persistent island signals each milestone once however the visitor scrolls (the web mirror of `alertedMilestones`);
- until pushed updates are shown on a device (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`, milestone 6 `DONE`), the page says the Lock Screen updates only with the app open (step note and FAQ).

## Information architecture

| Part | Phone (wide screens: sticky; narrow: in the step) | Island |
|---|---|---|
| Hero | Home Screen with the island + Lock Screen, playing riding 6 → 2 → next → arrival | in the Home Screen phone |
| 01 정하기 · 내릴 곳, 타는 곳 | app: destination search, boarding stop | empty |
| 02 확인하기 · 같은 번호, 이 버스?, 확인 | app: searching (with the bus-road picture), proposed, confirmed | empty → **appears at 확인** |
| 03 타고 가기 · 6정거장, 다른 앱 | Lock Screen; Home Screen with compact / long-press / two-activities picker | 365 · 6 → 5 |
| 04 흔들릴 때 · 버스와 정보 | Lock Screen with 정보 지연 / 버스 놓침 / 오프라인 / 다시 확인 중 picker and the two-signal table | 지연, 찾는 중, 오프라인, 확인 중 |
| 05 내릴 때 · 2정거장, 다음 하차, 도착 | Lock Screen escalating basalt → coral → tangerine, "알림 한 번" | opens once per milestone |
| 06–11 | V2 | gone: the ride has ended |

Navigation: 타는 법 (`#how`), 흔들릴 때 (`#trust`), 개발 현황, FAQ, and the TestFlight CTA.

## The persistent island

- **Where.** From 900 px, in the middle of the header, where the hardware sits on a phone; between 900 and 1 280 px the nav steps aside while it shows. Below 900 px, floating above the bottom of the viewport (`env(safe-area-inset-bottom)`): on an iPhone the top edge belongs to the real island and the browser, so a second island there would collide with both.
- **When.** Only while the story has a Live Activity (from 확인 to 도착) and the hero, which has its own devices, is off screen.
- **Interaction.** A button: hover (mouse), keyboard focus or tap opens it the way a long press does on iPhone; Escape closes it. Its label says "iPhone 미리보기" and gives the app's own spoken summary; when open, a visible "iPhone 미리보기 · 합성 데이터" note sits under it.
- **Milestones.** Reaching 2정거장, 다음 하차 or 도착 for the first time opens it for 2.6 s on wide screens, the way an alert opens the island; on narrow screens it only glows, to keep the page clear. Never under reduced motion.

## Motion

Every movement shows a state change: the island's morph (420 ms, emphasis curve), a count rolling to the next stop, the Lock Screen surface changing colour, the sticky phone changing screen, the glow taking the moment's colour, the hero loop (3.4 s / 2.6 s per moment, starts after 1.2 s, pauses off screen, with a pause button and a step rail). With `prefers-reduced-motion: reduce` nothing animates or plays by itself; every state stays reachable by scrolling and by the buttons.

## Accessibility

- axe-core 4.10 (WCAG 2.0/2.1 A and AA): **0 violations** at 1 440 × 900 and 390 × 844, at the top and at every beat, plus maps, status, waitlist and FAQ (local build, 2026-10-01). Two contrast defects found and fixed on the way (header over dark bands; coral on the island).
- Steps are headings and paragraphs in reading order. The sticky phone and the step pictures are hidden from assistive technology; each step carries one visually hidden sentence describing its picture in the app's own words.
- Keyboard: skip link → brand → nav → CTA → hero CTAs → hero rail → pause → journey controls; the island joins the tab order only while visible (`inert` otherwise).
- Targets ≥ 44 px; focus visible on light and dark bands.

## Performance

Local production build: JS 277 kB (86 kB gzip, V2 273 / 84), CSS 70 kB (14 kB gzip, V2 65 / 13), prerendered HTML 61 kB. No new dependency. Tracking reads eleven rectangles per animation frame only while scrolling.

## Honesty

Unchanged rules (`forbiddenClaims.ts`, checked on sources and on the prerendered HTML) plus: the hero says development status and that TestFlight is not open; the 6정거장 step says the current build updates the Lock Screen only while the app runs; the island and every device are labelled previews. Nothing claims automatic bus detection: the bus step says the rider confirms, and two plausible buses are a question.

## Verification

```bash
npm --prefix apps/web test            # 125 tests, incl. islandStory, productParity, siteHonesty
npm --prefix apps/web run build       # typecheck, prerender, claim guard
node apps/web/scripts/render-og.mjs   # after a build; needs Playwright and Pretendard
```

Captures (local build, Chromium, Pretendard installed locally): `docs/design/marketing/v3/`.

## Known limitations

- Figma has no V3 frames yet; the V2 marketing frames are superseded (`FIGMA_IMPLEMENTATION_MAP_V2.md`).
- The device pictures are drawings: real island size, truncation and alert presentation need hardware.
- Light theme only; Pretendard still loads from jsDelivr.
- The Vercel preview was not opened from the authoring environment.

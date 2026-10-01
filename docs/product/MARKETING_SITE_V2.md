# Marketing site V2

The public page at [tapso-nu.vercel.app](https://tapso-nu.vercel.app), built from `apps/web`. It presents TAPSO; it is not TAPSO. The native iOS app is the product. Every phone, Lock Screen and Dynamic Island on the page is a labelled re-drawing on synthetic data, and the page says so where each one appears.

## Purpose and audience

| Visitor | Needs to leave knowing |
|---|---|
| Jeju resident or visitor who rides buses | What TAPSO does for them on a bus, that it needs no location permission, how to get the beta |
| Someone who knows KakaoMap / NAVER Map | That TAPSO does not replace them; it takes over after boarding |
| Apple-platform or mobility engineer | That Lock Screen and Dynamic Island are the primary surface, and that uncertainty is designed, not hidden |
| Potential supporter, press, GitHub visitor | What is done, what is not, and that no date or availability is claimed |

Five-second answer (hero): **타고, 폰은 넣어두고, 제때 내리세요.** — a Jeju bus companion for iPhone, in development. One-minute answer: the ride story, the physical-bus problem, the native surfaces, the trust model, and the map-app relationship, in that order.

## Audit of the V1 page (2026-09-30, `main` at `bb80f87`)

Severity as in `UX_AUDIT_V2.md`: **P0** misrepresents the product; **P1** blocks understanding, conversion or quality; **P2** polish and maintenance.

| # | Finding | Status |
|---|---|---|
| P0-1 | Hero body said TAPSO "제주 버스의 물리 차량을 확인하고" — reads as automatic identification. Automatic selection is off (`KNOWN_ISSUES.md`); the rider confirms the bus | `FIXED`: "탄 버스를 한 번 함께 확인하면"; the bus-check section and FAQ state that the rider confirms |
| P0-2 | Island copy "제주 바람 따라 잘 가고 있어요." — the V1 line Product V2 removed as copy that answers nothing (`UX_AUDIT_V2.md` P2-4); "정류장" where the app says "정거장" | `FIXED`: every quoted product string now comes from `ko.lproj/Localizable.strings`, enforced by a test |
| P0-3 | Stop names differed between desktop and mobile (용문사거리/서문시장 vs 관덕정/광양), and 용문사거리 is not a stop on the demo route | `FIXED`: one synthetic trip from `DemoFixtures.route` everywhere |
| P1-1 | The page was Header → Hero → three feature cards → Waitlist: no explanation of how a ride works, the physical-bus problem, the Lock Screen, trust states, privacy, status or FAQ | `FIXED`: twelve-part story (below) |
| P1-2 | `IslandExperience.tsx` (an interactive island demo) and `Icons.tsx` were never rendered; `styles.css` (2,010 lines) was not imported; three V1 simulator JPEGs were unused | `FIXED`: removed; replaced by V2 components |
| P1-3 | A 1.2 MB PNG (`dori.png`) loaded above the fold | `FIXED`: a 60 KB WebP, lazy, below the fold; the source moved to `docs/design/marketing/dori-source.png` |
| P1-4 | The page rendered only after JavaScript (empty `#root`), hurting first paint and crawlers | `FIXED`: build-time prerender, then hydration |
| P1-5 | CTA "계속하기" did not say what continues; nav item "안전한 매칭" claimed safety | `FIXED`: "TestFlight 사전예약", "어떻게 작동하는지 보기"; nav names places, not claims |
| P1-6 | The waitlist's `unavailable` answer showed the same generic error as a server fault | `FIXED`: "지금은 사전예약을 받을 수 없어요. 입력한 내용은 저장되지 않았어요." |
| P1-7 | No canonical URL, social image, Twitter card, robots or sitemap; the favicon was a 98 KB PNG | `FIXED` |
| P1-8 | 제주어 headline ("와리지 말앙 혼저 탑서.") above the fold did not say what the product is to a visitor unfamiliar with Jejueo | `FIXED`: plain-Korean promise in the hero; 제주어 kept, translated, in the waitlist heading, FAQ and footer |
| P2-1 | Emoji as feature icons (🚌 ◉ ✓): platform-dependent, read aloud by screen readers | `FIXED`: SVG icons paired with words |
| P2-2 | Waitlist asked "하영 홍보해줍서" (please promote us) before explaining anything | `FIXED`: the ask comes after the story |
| P2-3 | "후원하기" sat beside the primary submit, splitting the main conversion | `FIXED`: support has its own section; the form has one action |

Kept: the waitlist and support backends, their state machines and fail-closed behaviour, the `SupportDialog` (native `<dialog>`), the support-return banner, Pretendard, the React 19 + Vite + Vercel stack.

## Information architecture

| # | Section (`id`) | Question it answers | Interaction |
|---|---|---|---|
| — | Hero (`top`) | What is it? | Static Lock Screen preview (riding, 6) and compact island |
| 01 | 이렇게 작동해요 (`how`) | How does a ride go? | Ten-step stepper, optional autoplay |
| 02 | 실제 버스 확인 (`bus`) | Why confirm the physical bus? | Three views of three 365 buses |
| 03 | 잠금 화면 · 다이나믹 아일랜드 (`live`) | What do I see without opening the app? | One moment rail drives Lock Screen, compact, expanded and minimal |
| 04 | 휴대폰은 주머니에 (`away`) | Do I have to keep watching? | Illustration (labelled as such) |
| 05 | 데이터가 흔들릴 때 (`trust`) | What if the data is wrong or late? | Six states, two signals side by side |
| 06 | 지도 앱과 함께 (`maps`) | Is this a map app? | Flow; built / not built / planned list |
| 07 | 개인정보 (`privacy`) | Does it track me? | — |
| 08 | 개발 현황 (`status`) | How far along is it? | — |
| 09 | TestFlight 사전예약 (`waitlist`) | What do I get if I sign up? | The form |
| 10 | 응원하기 (`support`) | Can I help? | Server-driven status; the sheet |
| 11 | 자주 묻는 질문 (`faq`) | Remaining doubts | Native `<details>` |

CTA rhythm: header (always), hero, the waitlist section, and the footer. No section in between repeats the CTA; the visitor is asked to join after understand → believe → experience → trust.

## Relationship to Product V2

- **Copy.** Product strings are quoted, not paraphrased: `src/demo/rideCopy.ts` holds only keys from `apps/ios/Resources/ko.lproj/Localizable.strings`, and `test/productParity.test.ts` fails on any drift.
- **States.** `src/demo/rideMoments.ts` mirrors `RideGuidancePolicy`: colour role, count presentation (live / last known / hidden), symbol, milestone, Lock Screen surface (basalt → coral → tangerine), and the two trust signals. The test parses `RideGuidance.swift` and compares.
- **Surfaces.** `NativeSurfaces.tsx` re-draws `LiveActivitySurfaces.swift` (Lock Screen, compact leading/trailing, minimal, expanded) and `RideParts.tsx` the V2 components (돌이, RouteBadge, JourneyRail, TrustBadge, count or symbol). `AppScreens.tsx` re-draws Home, route, boarding, vehicle check and ride screens.
- **Data.** One synthetic trip: route 365, 제주버스터미널 → 제주시청(아라방면), 8 stops, from `DemoFixtures.route`; plates such as `••0001` are invented.
- **Tokens.** `src/styles/tokens.css` carries the `TAPSO V2 Semantic` colours with the same names; web-only additions are layout, type, motion and one warm paper tone (`--sand`). No other stylesheet introduces a raw hex value.

The web does not redefine the product. It changes nothing under `apps/ios`, `packages/transit-core` or `services/api`.

## Design direction

Calm mobility instrument with Jeju warmth. White and mist editorial bands, a warm sand band for the two "problem" sections, and two basalt/night bands for the native surfaces and privacy. Mint is the action colour (ink text, 8.4:1), mint-ink the text accent, tangerine the destination motif: every section eyebrow is a small journey rail ending in a tangerine dot. Type is Pretendard, heavy and tight in headings, `word-break: keep-all` for Korean. 돌이 appears small and state-reactive inside the surfaces (as in V2), and once large, as a brand moment in the waitlist.

The site is more expressive than the app, but never decorates a surface the app keeps plain: the phone screens carry no ornaments the app does not have.

## Interaction model

- **Every demo is buttons, not scroll-jacking.** State is chosen with `button` elements (`aria-pressed` / `aria-current="step"`), so keyboard and screen-reader users drive the same demos; nothing depends on scroll position or hover.
- **Each device is one image with one sentence.** Phones and islands have `role="img"` and an `aria-label` in the shape of the app's own VoiceOver summary (`a11y.ride.*`).
- **Changes are announced once.** Each demo has a polite live region describing the new state.
- **Autoplay only on request.** The ride story advances on its own only after "자동 재생", stops at the end, and pauses when the section leaves the viewport.
- **Mobile.** The ride-story steps become a horizontal rail under the phone that keeps the current step in view; the Lock Screen moment rail becomes sticky so its control stays in reach while the surfaces below change.
- **Reduced Motion.** All transitions and the two looping animations (search caret, searching pulse) collapse to instant; every state is reachable and legible without motion.

## Waitlist reality

Unchanged backend (`apps/web/api`, `docs/WAITLIST_SUPPORT_SETUP.md`): validation, honeypot, fill-time check, rate limiting, duplicate detection, persistence in Supabase and confirmation mail through Resend. Supabase and Resend are `BLOCKED_BY_CREDENTIALS`, so the endpoint answers `503 unavailable`.

The form now says, for `unavailable`, that nothing was stored (`src/lib/waitlistMessages.ts`; `test/siteHonesty.test.ts`). Only `created` reads as a registration. The section lists what the visitor gets (one confirmation mail, a TestFlight notice when it opens, no advertising) and a disclosure with what is and is not collected. The consent sentence is unchanged, so `PRIVACY_CONSENT_VERSION` stays `2026-08-26`. No retention period is stated, because none has been decided.

## Support reality

`NOT ENABLED`: no merchant account exists. The section asks `/api/support/config` when it comes near the viewport and shows "결제 준비 중" unless the answer is `live`; a network failure also reads as not open. The button opens the existing sheet, whose continue button stays disabled with the reason. The section states that TAPSO is not a non-profit and issues no donation receipt or tax deduction. Nothing in the payment path changed.

## Analytics

None is installed, and none was added. If measurement becomes necessary, prefer a cookieless, first-party count (for example Vercel Web Analytics) and only these events, with no email, IP or free text attached:

| Event | When |
|---|---|
| `hero_cta` | Hero "TestFlight 사전예약" pressed |
| `product_demo_started` | First interaction with the ride story |
| `dynamic_island_state_changed` | A moment chosen on the Lock Screen rail (moment name only) |
| `trust_state_changed` | A trust state chosen (state id only) |
| `waitlist_started` | First focus in the email field |
| `waitlist_submitted` | Server answered, with the response status only |
| `support_opened` | Support sheet opened |
| `github_clicked` | Any GitHub link followed |

## Accessibility

Semantic landmarks and one `h1`, then one `h2` per section; skip link to `main`; visible focus on every control; 44 px minimum targets; every state named in words and a symbol, never by colour alone; native `<details>` for the FAQ and disclosures; native `<dialog>` for support (focus moves in, Escape closes, focus returns). axe-core (WCAG 2.1 A/AA) reports no violation at 1440 and 390 in the initial state and after every demo state change (4 Lock Screen moments, 3 bus views, 6 trust states, 10 story steps). Two contrast defects were found and fixed on the way: 70 % white on the coral next-stop surface (3.3:1) and the neutral route badge on the tangerine arrival surface.

## Performance

- Prerendered HTML (51 kB) with hydration: content paints before JavaScript.
- JavaScript 273 kB / 84 kB gzip in one chunk (React 19 is most of it); the support sheet and the payment glue stay in lazy chunks. CSS 65 kB / 13 kB gzip.
- No animation library, no third-party script. Pretendard is fetched without blocking the first paint.
- Images: one lazy 60 kB WebP; every device and icon is HTML/SVG, so nothing rasterised scales badly.
- Lighthouse 12, mobile emulation, local production build: Performance 100, Accessibility 100, SEO 100, Best Practices 96 (the one miss is the font CDN, which the audit environment could not reach). LCP 1.4 s, TBT 10 ms, CLS 0. Re-measure on the Vercel Preview; the local numbers exclude real network and font loading.

## SEO and sharing

Korean title and description, canonical URL, Open Graph and Twitter card with a 1200 × 630 image (`public/og.png`, rendered from the page's own components and labelled 제품 미리보기), SVG favicon, `robots.txt` (API excluded), `sitemap.xml`, and a `SoftwareApplication` JSON-LD whose description says the app is in development and not yet distributed. No text claims availability.

## Claim guard

`src/content/forbiddenClaims.ts` lists claims the page must not make (download now, App Store, launched, TestFlight open, try it in the browser, confidence numbers or percentages, automatic bus identification, receipts or tax deduction, non-profit status, internal matcher terms, invented user counts, Android availability). `test/siteHonesty.test.ts` checks the sources, and `scripts/prerender.mjs` checks the rendered page text and fails the build on a match.

## Figma

`03 Web` (`3:4`) now holds a section **Web / Marketing V2 · 2026-09-30** (`165:54`) with the information architecture and its code mapping; the V1 frames `9:2` and `10:20` are renamed as superseded. Visual captures of the built page could not be uploaded from the authoring environment (Figma's upload host was not reachable); place 1440 and 390 captures from the Vercel Preview in that section. Code Connect: `JourneyCard.figma.ts` and `DynamicIsland.figma.ts` were removed with the V1 markup they described; the form, button, result, dialog and banner templates remain valid.

## Known limitations

- The page describes the product being built. Today's iOS build runs on synthetic data and advances only while the app is running; the FAQ and status say so. "앱을 닫아도 이어지는 안내" needs APNs (`BLOCKED_BY_CREDENTIALS`).
- Device drawings approximate iOS: the island is drawn, SF Pro Rounded is replaced by Pretendard numerals, and only a device shows real sizes (`KNOWN_ISSUES.md`).
- Pretendard comes from jsDelivr. Self-hosting would remove the third-party request but means committing the subset font files or adding the `pretendard` package (98 MB unpacked, per `npm view`) to every install; not done.
- Light theme only. The page declares `color-scheme: light`.
- Vercel Preview could not be reached from the authoring environment; preview verification is listed in the pull request.
- The iOS Lock Screen draws its secondary text on coral at 70 % white (`RideSurfacePalette.secondaryText`), which computes to about 3.2:1 from the token values (the web's 72 % measured 3.28:1 in axe); the web draws it opaque. Recorded in `KNOWN_ISSUES.md` for the app, not changed here.

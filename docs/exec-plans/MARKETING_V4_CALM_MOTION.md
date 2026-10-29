# TAPSO Marketing V4: Calm Motion & User-Chosen Scenes

Implementation branch: `design/v4-calm-motion-hero` (not production until PR review and merge).

## What V4 changes

- **No scroll hijacking.** The Joham Coast footage stays a normal hero background instead of shrinking into a simulated iPhone as visitors scroll through a 290svh scene. The hero is ordinary document flow.
- **Two intentional modes.** '제주 풍경' shows the licensed coast video; '앱 미리보기' pauses the video and shows a manually controlled Lock Screen synthetic preview. Stops 6 → 2 → next → arrival only change when the visitor presses a labelled button.
- **No pop-up island.** The floating Dynamic Island no longer auto-expands or signals on milestone changes. Only activating its button expands it, and Escape collapses it.
- **No re-entrance effects.** The journey phone no longer flies or fades in on every scroll-derived state change. Numeric changes in the island have no rolling or blur animation.
- **Motion switch for visitors.** '움직임 줄이기' is independent of OS settings, persists in local storage and disables motion throughout the site. OS `prefers-reduced-motion`, reduced-data, 2G, paused states, and still fallback continue to be respected.
- **Not changed.** Brand semantic colors, licensing and truthfulness of media, TestFlight readiness disclaimers, preview/synthetic-data labels, waitlist/support/API endpoints and core iOS behavior.

## Additional footage (discovery only, NOT shipped)

The user requested the ability to add another video. These two real Jeju coastal candidates have been found, but no downloaded, optimized, hash-verified local assets are available in the repository at this commit:

- Jeju Udo beach, somedaywish: https://pixabay.com/videos/korea-jeju-beach-sea-island-262066/ (Pixabay Content License)
- Jeju Jungmun waves, Life_Vitamin: https://pixabay.com/videos/wave-sea-ocean-jeju-289799/ (Pixabay Content License)

**Do not invent MP4 CDN URLs, embed unrelated places as Jeju, or silently hotlink unverified footage.** To add a second film, obtain the clip lawfully, cut a short slow-motion-free 720p landscape loop (and vertical crop if needed), strip audio, prepare WebP posters, check size and license, store optimized files in `apps/web/public/media/hero/`, update `apps/web/src/content/media.ts` and `docs/product/WEB_MEDIA_SOURCES.md`, and extend the same user-operated scene picker. The original existing video remains the only actual footage in V4.

## Acceptance criteria and manual checks

1. At 360, 390, 768, 1280, and 1440 CSS pixel widths, the hero is readable, controls are keyboard reachable and no overlay prevents reaching the waitlist.
2. Scroll freely; the coast video must not clip into an iPhone, and the page should not hold a visitor for 2–3 viewport heights.
3. Select product preview: the film pauses. Manually switch each of the four states; there must be no timer or automatic countdown. Select coast again: honor an earlier manual pause.
4. Open the dock and close via Escape; it should never expand on scroll by itself.
5. Toggle site motion setting, navigate/refresh, and confirm persistence. Repeat with OS reduced motion and network Save Data.
6. Test mobile landscape and Safari/iOS Low Power Mode to confirm photo fallback, no horizontal overflow and accessible playback controls.
7. Run `npm test --workspace @tapso/marketing-site` and `npm run build --workspace @tapso/marketing-site` (or repo-defined CI equivalent); no skipped/disabled checks.

Any later Figma V4 board must remain PROPOSED until the web build is reviewed and merged.

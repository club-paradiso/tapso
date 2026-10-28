# Coast film hero and Figma authoring

Started as "Liquid lens marketing" (a refractive sphere over generated Jeju stills, PR #148). The owner rejected the droplet effect and the moving-still clip on 2026-10-28; this plan replaces both.

## Outcome

The first screen is real footage of a Jeju coastal road, full bleed, with the promise, the waitlist button and the development status readable over it in both themes. Scrolling cuts the same film down to an iPhone screen, where TAPSO's Lock Screen Live Activity (the existing web re-drawing, synthetic ride) counts down 6 stops → 2 → next stop → arrival. Then the page continues into how to ride, trust, development status, waitlist, support and FAQ, unchanged.

Reference: deepmind.google/models/genie — full-bleed film, little text, scroll-driven change, nothing copied (no assets, code or wording).

## Constraints

- Only footage whose licence and source are recorded (`docs/product/WEB_MEDIA_SOURCES.md`). The film is labelled as what it is: a real drone shot of a car, not a TAPSO ride and not a bus window.
- App surfaces are the existing `NativeSurfaces` drawings, labelled preview on synthetic data. No unreleased behaviour shown as working.
- Muted, looping, pausable. Not loaded before hydration; not autoplayed under reduced motion, data saver or 2G; smallest file on 3G and on tall screens; paused off screen and in a hidden tab; still image on any error.
- Reduced motion: nothing tied to scrolling; the film moment and the Lock Screen moment are stacked.
- Waitlist, support, FAQ, status and their API calls unchanged.

## Milestones

1. Media: find licensed footage, cut a seamless loop in three sizes plus stills, record licence. Done.
2. `Hero.tsx` (sticky stage, clip-path driven by scroll), `useHeroFilm.ts`, `coast.css`, `theme.css` (header see-through over the film). Remove `LiquidLens`, `JourneyFilm`, generated media. Done.
3. Tests: `test/media.test.ts`; existing suites. Build and prerender claim check.
4. Browser checks: desktop and mobile, light and dark, reduced motion, failed load, horizontal overflow, console.
5. Figma: hero board on `11 Marketing Web`, tokens in `TAPSO Web PR`.
6. PR #148 retitled and described; no merge before green CI.

## Validation

```bash
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
npm --prefix apps/web run build
```

## Progress

- 2026-10-28: footage found (Pixabay 339975, YounStudios, Joham Coastal Road); no footage of a Jeju bus ride exists in any source searched, listed as missing in WEB_MEDIA_SOURCES.md. Hero implemented and checked in the browser at 1440×900 and 375×812, light and dark, with a forced load failure.

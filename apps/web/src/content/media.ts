/**
 * Every moving picture on the page, with where it came from. The page prints
 * `credit` next to the film, and `docs/product/WEB_MEDIA_SOURCES.md` keeps the
 * licence record; `test/media.test.ts` checks the two agree and that the files
 * exist.
 *
 * The hero film is real footage of a real Jeju coastal road, but it is an
 * aerial shot of a car, not a TAPSO ride and not the view from a bus seat.
 * Nothing on the page may present it as either.
 */
export const HERO_FILM = {
  files: {
    wide: "/media/hero/joham-coast-1080.mp4",
    medium: "/media/hero/joham-coast-720.mp4",
    portrait: "/media/hero/joham-coast-portrait.mp4",
  },
  stills: {
    wide: "/media/hero/joham-coast-poster.webp",
    portrait: "/media/hero/joham-coast-poster-portrait.webp",
  },
  place: "제주 조함해안도로(조천–함덕)",
  kind: "실제 촬영 · 드론",
  author: "YounStudios",
  source: "https://pixabay.com/videos/jeju-island-south-korea-339975/",
  licence: "Pixabay Content License",
  licenceUrl: "https://pixabay.com/service/license-summary/",
  /** What the page says under the film. */
  credit: "영상: 제주 조함해안도로 실제 드론 촬영(YounStudios, Pixabay). 탑서 승차 장면이 아니에요.",
} as const;

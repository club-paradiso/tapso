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


/** Uploaded source clip IDs: Pixabay 262066 (Udo) and 289799 (Jungmun). */
export const EXTRA_FILMS = [
  {
    id: "udo",
    label: "우도 해변",
    film: {
      files: {
        wide: "/media/hero/udo-720.mp4",
        medium: "/media/hero/udo-720.mp4",
        portrait: "/media/hero/udo-portrait.mp4",
      },
      stills: {
        wide: "/media/hero/udo-poster.webp",
        portrait: "/media/hero/udo-poster-portrait.webp",
      },
      place: "제주 우도 해변",
      kind: "실제 촬영 · 해변",
      author: "somedaywish",
      source: "https://pixabay.com/videos/korea-jeju-beach-sea-island-262066/",
      licence: "Pixabay Content License",
      licenceUrl: "https://pixabay.com/service/license-summary/",
      credit: "영상: 제주 우도 해변 실제 촬영(somedaywish, Pixabay). 탑서 승차 장면이 아니에요.",
    },
  },
  {
    id: "jungmun",
    label: "중문 파도",
    film: {
      files: {
        wide: "/media/hero/jungmun-720.mp4",
        medium: "/media/hero/jungmun-720.mp4",
        portrait: "/media/hero/jungmun-portrait.mp4",
      },
      stills: {
        wide: "/media/hero/jungmun-poster.webp",
        portrait: "/media/hero/jungmun-poster-portrait.webp",
      },
      place: "제주 중문 해안",
      kind: "실제 촬영 · 파도",
      author: "Life_Vitamin",
      source: "https://pixabay.com/videos/wave-sea-ocean-jeju-289799/",
      licence: "Pixabay Content License",
      licenceUrl: "https://pixabay.com/service/license-summary/",
      credit: "영상: 제주 중문 해안 파도 실제 촬영(Life_Vitamin, Pixabay). 탑서 승차 장면이 아니에요.",
    },
  },
] as const;

export const FILM_SCENES = [
  { id: "coast", label: "조함해안도로", film: HERO_FILM },
  ...EXTRA_FILMS,
] as const;

export type HeroFilmSource = (typeof FILM_SCENES)[number]["film"];
export type FilmSceneId = (typeof FILM_SCENES)[number]["id"];

/**
 * The new MP4 binaries are intentionally NOT assumed present on a PR branch.
 * Detect all actual assets first, with a matching MIME type to guard against
 * SPA catch-all HTML responses which can return 200 for missing files.
 * When the committed files land in public/, the choices become available
 * without another deployment flag or hardcoded switch.
 */
export async function filmAssetsExist(
  film: HeroFilmSource,
  head: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  const files = [...new Set(Object.values(film.files)), ...Object.values(film.stills)];
  try {
    const checks = await Promise.all(files.map(async (path) => {
      const response = await head(path, { method: "HEAD" });
      if (!response.ok) return false;
      const mediaType = response.headers.get("content-type")?.toLowerCase() ?? "";
      return path.endsWith(".mp4")
        ? mediaType.startsWith("video/mp4")
        : mediaType.startsWith("image/webp");
    }));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

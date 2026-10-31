/**
 * Four user-provided, AI-generated scenes of young people riding Jeju buses.
 * They are visual illustrations, not recordings of actual passengers or
 * evidence of real routes, locations, schedules, or working TAPSO screens.
 * Credits stay visible and provenance lives in WEB_MEDIA_SOURCES.md.
 */
function generatedFilm(
  slug: string,
  source: string,
  place: string,
  durationSeconds: number,
) {
  return {
    files: {
      wide: `/media/hero/${slug}.mp4`,
      medium: `/media/hero/${slug}.mp4`,
      portrait: `/media/hero/${slug}-portrait.mp4`,
    },
    stills: {
      wide: `/media/hero/${slug}-poster.webp`,
      portrait: `/media/hero/${slug}-poster-portrait.webp`,
    },
    durationSeconds,
    place,
    kind: "AI 생성 연출",
    author: "사용자 제공 Gemini 영상",
    source,
    licence: "사용자가 제공한 AI 생성 영상",
    credit: "AI 제작 연출 영상",
  } as const;
}

export const HERO_FILM = generatedFilm(
  "ai-rural-city",
  "gemini_generated_video_AB86876C.MP4",
  "제주 외곽과 시가지의 버스 이용 장면을 연출",
  10,
);

/** All four new video assets are committed locally; legacy Pixabay films
 * remain archived on disk but are not in the live hero playlist. */
export const EXTRA_FILMS = [
  {
    id: "coastal-rider",
    label: "제주 해안도로 버스",
    film: generatedFilm(
      "ai-coast-man",
      "gemini_generated_video_A3BF8643.MP4",
      "제주 해안도로 버스 승객 연출",
      10,
    ),
  },
  {
    id: "city-woman",
    label: "제주 시내 버스",
    film: generatedFilm(
      "ai-city-woman",
      "gemini_generated_video_93419BE5.MP4",
      "제주 시내 버스 승객 연출",
      10,
    ),
  },
  {
    id: "city-man",
    label: "제주 도심 이동",
    film: generatedFilm(
      "ai-city-man",
      "gemini_generated_video_B2799913.mov",
      "제주 도심 버스 승객 연출",
      5,
    ),
  },
] as const;

export const FILM_SCENES = [
  { id: "rural-city", label: "제주 외곽과 시가지", film: HERO_FILM },
  ...EXTRA_FILMS,
] as const;

export type HeroFilmSource = (typeof FILM_SCENES)[number]["film"];
export type FilmSceneId = (typeof FILM_SCENES)[number]["id"];

/** Check actual published media, not an SPA HTML fallback with status 200. */
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

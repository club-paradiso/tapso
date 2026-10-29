/** Source fidelity, complete local media and provenance of new TAPSO hero. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HERO_FILM, EXTRA_FILMS, FILM_SCENES, filmAssetsExist } from "../src/content/media.ts";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const record = readFileSync(new URL("../../../docs/product/WEB_MEDIA_SOURCES.md", import.meta.url), "utf8");
const films = [HERO_FILM, ...EXTRA_FILMS.map(({ film }) => film)];

test("only the four actual user-supplied Gemini films appear in the hero", () => {
  assert.equal(FILM_SCENES.length, 4);
  assert.deepEqual(films.map((film) => film.durationSeconds), [10, 10, 10, 5]);
  assert.ok(films.every((film) => film.kind === "AI 생성 연출"));
  for (const { film } of FILM_SCENES) {
    assert.doesNotMatch(film.files.medium, /joham|udo|jungmun/);
    assert.match(film.credit, /AI 제작/);
    assert.match(film.credit, /실제.*촬영물이 아/);
  }
});

test("all 16 landscape and portrait video/poster assets are present and optimized", () => {
  for (const film of films) {
    const paths = [...new Set(Object.values(film.files)), ...Object.values(film.stills)];
    assert.equal(paths.length, 4, film.source);
    for (const path of paths) {
      assert.ok(existsSync(publicDir + path), `${path} is missing`);
      const limit = path.endsWith(".mp4") ? 7_000_000 : 500_000;
      assert.ok(statSync(publicDir + path).size > 0, `${path} is empty`);
      assert.ok(statSync(publicDir + path).size <= limit, `${path} exceeds ${limit} bytes`);
      assert.ok(record.includes(path), `${path} lacks source documentation`);
    }
    assert.ok(record.includes(film.source), `${film.source} is undocumented`);
  }
});

test("hero remains paused with real stills on reduced-motion or slow connections", async () => {
  const good = async (path: string) => new Response(null, {
    status: 200,
    headers: { "content-type": path.endsWith(".mp4") ? "video/mp4" : "image/webp" },
  });
  assert.equal(await filmAssetsExist(HERO_FILM, good), true);
  assert.equal(await filmAssetsExist(EXTRA_FILMS[0]!.film, good), true);
  assert.equal(await filmAssetsExist(HERO_FILM, async () => new Response("<html />", {
    status: 200, headers: { "content-type": "text/html" },
  })), false);
  assert.equal(await filmAssetsExist(HERO_FILM, async () => new Response(null, {
    status: 404, headers: { "content-type": "video/mp4" },
  })), false);
});

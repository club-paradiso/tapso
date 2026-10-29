/**
 * The hero film: every file the page asks for exists, the licence record in
 * docs names the same source and author, and the words under the film never
 * pass it off as a TAPSO ride or as the view from a bus seat.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HERO_FILM, EXTRA_FILMS, filmAssetsExist } from "../src/content/media.ts";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const record = readFileSync(new URL("../../../docs/product/WEB_MEDIA_SOURCES.md", import.meta.url), "utf8");

test("every hero file exists and stays small enough for a first screen", () => {
  for (const path of [...Object.values(HERO_FILM.files), ...Object.values(HERO_FILM.stills)]) {
    assert.ok(existsSync(publicDir + path), `${path} is missing`);
    const limit = path.endsWith(".mp4") ? 7_000_000 : 500_000;
    assert.ok(statSync(publicDir + path).size <= limit, `${path} is over ${limit} bytes`);
  }
});

test("the licence record matches what the page credits", () => {
  for (const value of [HERO_FILM.source, HERO_FILM.author, HERO_FILM.licence, HERO_FILM.licenceUrl]) {
    assert.ok(record.includes(value), `docs/product/WEB_MEDIA_SOURCES.md does not mention ${value}`);
  }
  for (const path of Object.values(HERO_FILM.files)) assert.ok(record.includes(path), `${path} is not recorded`);
});

test("the credit says what the film is and what it is not", () => {
  assert.match(HERO_FILM.credit, /실제/);
  assert.match(HERO_FILM.credit, /탑서 승차 장면이 아니/);
  assert.match(HERO_FILM.credit, new RegExp(HERO_FILM.author));
  assert.doesNotMatch(HERO_FILM.credit, /버스\s*(창밖|안에서|에서\s*찍)/);
});

test("additional Jeju films have accurate credits and documented routes", () => {
  for (const { film } of EXTRA_FILMS) {
    for (const detail of [film.source, film.author, film.licence, film.licenceUrl]) {
      assert.ok(record.includes(detail), `Missing source metadata: ${detail}`);
    }
    assert.match(film.credit, /실제/);
    assert.match(film.credit, /탑서 승차 장면이 아니/);
    for (const path of [...new Set(Object.values(film.files)), ...Object.values(film.stills)]) {
      assert.ok(record.includes(path), `Unrecorded optional media: ${path}`);
    }
  }
});

test("additional video files are all-or-nothing, size-limited assets", () => {
  for (const { film } of EXTRA_FILMS) {
    const files = [...new Set(Object.values(film.files)), ...Object.values(film.stills)];
    const present = files.filter((path) => existsSync(publicDir + path));
    // The V4 PR may contain code before binary assets are uploaded. The
    // feature is hidden until every required local file is published.
    if (present.length === 0) continue;
    assert.equal(present.length, files.length, "Incomplete Jeju film upload");
    for (const path of files) {
      assert.ok(statSync(publicDir + path).size <= (path.endsWith(".mp4") ? 7_000_000 : 500_000), path);
    }
  }
});

test("the film gate rejects missing files or SPA HTML content", async () => {
  const film = EXTRA_FILMS[0]!.film;
  const good = async (path: string) => new Response(null, {
    status: 200,
    headers: { "content-type": path.endsWith(".mp4") ? "video/mp4" : "image/webp" },
  });
  assert.equal(await filmAssetsExist(film, good), true);
  assert.equal(await filmAssetsExist(film, async () => new Response("<html />", {
    status: 200, headers: { "content-type": "text/html" },
  })), false);
  assert.equal(await filmAssetsExist(film, async () => new Response(null, {
    status: 404, headers: { "content-type": "video/mp4" },
  })), false);
});

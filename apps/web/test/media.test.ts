/**
 * The hero film: every file the page asks for exists, the licence record in
 * docs names the same source and author, and the words under the film never
 * pass it off as a TAPSO ride or as the view from a bus seat.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HERO_FILM } from "../src/content/media.ts";

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

/**
 * The Swift core decodes `fixtures/journey/timetable-views-v1.json` and tests
 * what the rider reads for each view (`OfficialTimetableTests.swift`). Those
 * views are only evidence while they are what this server produces from the
 * committed bundle, so the generator must reproduce the committed file exactly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("the committed timetable views are what the server's routeTimetableView produces today", () => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/journey/timetable-views.ts", "--check"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /timetable views match/);
});

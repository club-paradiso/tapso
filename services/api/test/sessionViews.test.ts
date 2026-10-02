/**
 * The Swift core decodes `fixtures/journey/session-views-v1.json` and tests
 * what the app shows for each payload (`LiveSessionInterpreterTests.swift`).
 * Those payloads are only evidence while they are what this server actually
 * produces, so the generator must reproduce the committed file exactly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("the committed session payloads are what the server's coordinator produces today", () => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/journey/session-views.ts", "--check"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /session views current \(\d+ scenarios\)/);
});

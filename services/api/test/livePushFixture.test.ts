import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LIVE_PUSH_FIXTURE, livePushFixture } from "../scripts/livePushFixture.ts";

test("the committed Live Activity push fixture is what the sender would build", () => {
  assert.equal(readFileSync(LIVE_PUSH_FIXTURE, "utf8"), livePushFixture(),
    "regenerate with: node --experimental-strip-types services/api/scripts/livePushFixture.ts");
  assert.equal(JSON.parse(livePushFixture()).synthetic, true);
});

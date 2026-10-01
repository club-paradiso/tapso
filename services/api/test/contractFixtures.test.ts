/**
 * The iOS client decodes `fixtures/transit/api-contract/*.json` in its own
 * tests (`packages/transit-core/Tests/TapsoTransitTests/LiveAPITests.swift`).
 * Those files are what this server answers; regenerate them with
 * `node --experimental-strip-types services/api/scripts/contractFixtures.ts`
 * when the wire shape changes on purpose, and review the Swift side with them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONTRACT_DIRECTORY, generateContractFixtures, serialize } from "../scripts/contractFixtures.ts";

test("the committed API contract fixtures are exactly what the server answers", async () => {
  const generated = await generateContractFixtures();
  const committed = readdirSync(CONTRACT_DIRECTORY).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(committed, Object.keys(generated).map((name) => `${name}.json`).sort(), "the fixture set changed");
  for (const [name, exchange] of Object.entries(generated)) {
    assert.equal(readFileSync(join(CONTRACT_DIRECTORY, `${name}.json`), "utf8"), serialize(exchange), `${name}.json drifted; regenerate it`);
  }
});

test("every contract fixture is labelled synthetic and carries no credential", async () => {
  for (const exchange of Object.values(await generateContractFixtures())) {
    assert.equal(exchange.synthetic, true);
    assert.doesNotMatch(JSON.stringify(exchange), /synthetic-key|serviceKey|TAGO_SERVICE_KEY/);
  }
});

test("the ride the fixtures record never selects a bus without the rider", async () => {
  const fixtures = await generateContractFixtures();
  const created = fixtures["session-created"]!.body as { selectedVehicleId?: string; matchingMode: string };
  assert.equal(created.selectedVehicleId, undefined);
  assert.equal(created.matchingMode, "shadow");
  const confirmed = fixtures["session-confirmed"]!.body as { selectionMode?: string };
  assert.equal(confirmed.selectionMode, "explicit");
});

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { resolveBetaTesterMode } from "../src/betaHttp.ts";
import { betaHarness, CITY, OPERATOR, ROUTE, BOARDED } from "./syntheticBeta.ts";

test("BETA_TESTERS_ENABLED is off unless explicitly true, and Upstash alone never turns it on", () => {
  const cases: Array<[Record<string, string | undefined>, boolean, string]> = [
    [{}, true, "disabled"],
    [{ BETA_TESTERS_ENABLED: "" }, true, "disabled"],
    [{ BETA_TESTERS_ENABLED: "false" }, true, "disabled"],
    [{ BETA_TESTERS_ENABLED: "0" }, true, "disabled"],
    [{ BETA_TESTERS_ENABLED: "yes" }, true, "disabled"],
    [{ BETA_TESTERS_ENABLED: "true" }, false, "unconfigured"],
    [{ BETA_TESTERS_ENABLED: "true" }, true, "enabled"],
    [{ BETA_TESTERS_ENABLED: " TRUE " }, true, "enabled"],
    [{ BETA_TESTERS_ENABLED: "1" }, true, "enabled"],
  ];
  for (const [env, storage, mode] of cases) {
    assert.equal(resolveBetaTesterMode(env, storage).mode, mode, JSON.stringify(env));
  }
  assert.match(resolveBetaTesterMode({ BETA_TESTERS_ENABLED: "yes" }, true).problem!, /stays disabled/);
});

const BETA_ROUTES: Array<[string, string, boolean]> = [
  ["POST", "/beta/session", true],
  ["GET", "/beta/me", false],
  ["POST", "/beta/rides", true],
  ["GET", "/beta/rides/00000000-0000-0000-0000-000000000000", false],
  ["POST", "/beta/rides/00000000-0000-0000-0000-000000000000/finish", true],
  ["GET", "/beta/invites", false],
  ["POST", "/beta/invites", true],
  ["POST", "/beta/invites/inv_abc/revoke", true],
  ["GET", "/beta/campaign", false],
];

for (const mode of ["disabled", "unconfigured"] as const) {
  test(`with beta ${mode}, every beta route fails closed and the operator flow is untouched`, async () => {
    const h = await betaHarness({ betaMode: mode });
    try {
      for (const token of [undefined, OPERATOR, `tbt_${"a".repeat(43)}`]) {
        for (const [method, route, hasBody] of BETA_ROUTES) {
          const response = await h.call(method, route, { ...(token ? { token } : {}), ...(hasBody ? { body: {} } : {}) });
          assert.equal(response.status, 503, `${method} ${route}`);
          assert.equal(response.json.error, mode === "disabled" ? "BETA_DISABLED" : "BETA_UNCONFIGURED");
        }
      }
      // Nothing was written anywhere.
      assert.equal(h.betaStore.values.size, 0);
      assert.equal(h.journal!.open.size, 0);

      // The operator flow still works end to end.
      const started = await h.call("POST", "/capture/start", {
        token: OPERATOR,
        body: { routeId: ROUTE, cityCode: CITY, boardedVehicleId: BOARDED, boardingStopSequence: 3, destinationStopSequence: 10 },
      });
      assert.equal(started.status, 201);
      const id = started.json.sessionId as string;
      assert.equal((await h.call("POST", `/capture/${id}/marker`, { token: OPERATOR, body: { stopSequence: 3 } })).status, 200);
      assert.equal((await h.call("GET", `/capture/${id}`, { token: OPERATOR })).status, 200);
      assert.equal((await h.call("GET", "/field-validation/campaign", { token: OPERATOR })).status, 200);
      assert.equal(h.journal!.open.size, 0, "operator rides are never journaled");
    } finally {
      await h.close();
    }
  });
}

test("/health reports the beta status from the real collector wiring", async () => {
  const saved = { ...process.env };
  const cases: Array<[Record<string, string>, string]> = [
    [{ UPSTASH_REDIS_REST_URL: "https://synthetic-upstash.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic" }, "disabled"],
    [{ BETA_TESTERS_ENABLED: "true" }, "unconfigured"],
    [{ BETA_TESTERS_ENABLED: "true", UPSTASH_REDIS_REST_URL: "https://synthetic-upstash.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic" }, "enabled"],
  ];
  try {
    for (const [index, [env, expected]] of cases.entries()) {
      for (const key of ["BETA_TESTERS_ENABLED", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[key];
      Object.assign(process.env, { NODE_ENV: "test", ...env });
      const { backgroundServer } = await import(`../src/backgroundServer.ts?case=${index}`);
      backgroundServer.listen(0, "127.0.0.1");
      await once(backgroundServer, "listening");
      const { port } = backgroundServer.address();
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      assert.equal(health.betaTesters, expected, JSON.stringify(env));
      assert.equal(health.betaRestartRecovery, expected === "enabled" ? "durable_journal" : "not_applicable");
      const me = await fetch(`http://127.0.0.1:${port}/beta/me`);
      assert.equal(me.status, expected === "enabled" ? 401 : 503, "no credential; no store call needed");
      await new Promise<void>((resolve) => backgroundServer.close(() => resolve()));
    }
  } finally {
    process.env = saved;
  }
});

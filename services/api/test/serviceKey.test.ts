import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SERVICE_KEY_ENV,
  DEPRECATED_SERVICE_KEY_ENV,
  resolveTagoServiceKey,
  serviceKeyWarning,
} from "../src/serviceKey.ts";

test("the canonical name is the one production is meant to carry", () => {
  assert.equal(CANONICAL_SERVICE_KEY_ENV, "TAGO_SERVICE_KEY");
  assert.ok(
    !CANONICAL_SERVICE_KEY_ENV.startsWith("PUBLIC_"),
    "a PUBLIC_ prefix is a framework public-variable prefix and cannot hold a Sensitive secret",
  );
});

test("the canonical variable wins wherever it is set", () => {
  for (const env of [
    { TAGO_SERVICE_KEY: "canonical" },
    { TAGO_SERVICE_KEY: "canonical", PUBLIC_DATA_SERVICE_KEY: "old" },
    { VERCEL: "1", TAGO_SERVICE_KEY: "canonical", PUBLIC_DATA_SERVICE_KEY: "old" },
  ]) {
    const resolved = resolveTagoServiceKey(env);
    assert.equal(resolved.key, "canonical");
    assert.equal(resolved.source, "canonical");
  }
});

test("the deprecated name is a local fallback only", () => {
  const local = resolveTagoServiceKey({ PUBLIC_DATA_SERVICE_KEY: "legacy" });
  assert.equal(local.key, "legacy");
  assert.equal(local.source, "deprecated_local_fallback");

  const serverless = resolveTagoServiceKey({ VERCEL: "1", PUBLIC_DATA_SERVICE_KEY: "legacy" });
  assert.equal(serverless.key, "", "a serverless deployment must not read the retired name");
  assert.equal(serverless.source, "missing");
  assert.equal(serverless.deprecatedNamePresent, true);
});

test("absent, blank, and non-string values all resolve to missing", () => {
  for (const env of [
    {},
    { TAGO_SERVICE_KEY: "" },
    { TAGO_SERVICE_KEY: "   " },
    { TAGO_SERVICE_KEY: undefined },
    { TAGO_SERVICE_KEY: "  ", PUBLIC_DATA_SERVICE_KEY: "  " },
  ]) {
    const resolved = resolveTagoServiceKey(env);
    assert.equal(resolved.key, "");
    assert.equal(resolved.source, "missing");
  }
});

test("surrounding whitespace is trimmed off either name", () => {
  assert.equal(resolveTagoServiceKey({ TAGO_SERVICE_KEY: "  key  " }).key, "key");
  assert.equal(resolveTagoServiceKey({ PUBLIC_DATA_SERVICE_KEY: "\tkey\n" }).key, "key");
});

test("the warning names the migration, and stays silent when there is nothing to say", () => {
  const fallback = serviceKeyWarning(resolveTagoServiceKey({ PUBLIC_DATA_SERVICE_KEY: "legacy" }));
  assert.match(fallback ?? "", /deprecated/);
  assert.match(fallback ?? "", new RegExp(CANONICAL_SERVICE_KEY_ENV));

  const ignored = serviceKeyWarning(resolveTagoServiceKey({ VERCEL: "1", PUBLIC_DATA_SERVICE_KEY: "legacy" }));
  assert.match(ignored ?? "", /ignored on this deployment/);
  assert.match(ignored ?? "", new RegExp(DEPRECATED_SERVICE_KEY_ENV));

  assert.equal(serviceKeyWarning(resolveTagoServiceKey({ TAGO_SERVICE_KEY: "canonical" })), undefined);
  assert.equal(serviceKeyWarning(resolveTagoServiceKey({})), undefined);
});

test("no resolution result carries the credential outside its key field", () => {
  const resolved = resolveTagoServiceKey({ TAGO_SERVICE_KEY: "super-secret" });
  const { key, ...rest } = resolved;
  assert.equal(key, "super-secret");
  assert.ok(!JSON.stringify(rest).includes("super-secret"));
  assert.ok(!(serviceKeyWarning(resolved) ?? "").includes("super-secret"));
});

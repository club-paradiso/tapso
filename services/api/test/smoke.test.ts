import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { readTransitApiConfig, type ServerEnv } from "../src/apiConfig.ts";
import { createTransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";

/**
 * Synthetic fixtures only: an invented provider behind the real handler, so
 * the production smoke test (`scripts/smoke.ts`) runs its credentialed path
 * against the current API contract. A smoke test that drifts from the API it
 * checks fails every scheduled production run; this catches that in CI.
 */

function deployment(env: ServerEnv, events: string[] = []): Server {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key", VERCEL: "1", ...env }, { nodeVersion: "v22.0.0" });
  const upstream = {
    async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
      return Array.from({ length: 5 }, (_, index) => ({ stopId: `SYN-${index + 1}`, name: `Synthetic ${index + 1}`, sequence: index + 1 }));
    },
    async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
      return [{
        vehicleId: "SYNTHETIC-1",
        routeId: request.routeId,
        observedAt: new Date(0).toISOString(),
        receivedAt: new Date().toISOString(),
        timestampSource: "unavailable",
        stopSequence: 2,
        receiveType: "TAGO_SNAPSHOT",
      }];
    },
  };
  const provider = new CachedTransitProvider(upstream, { stopTtlMs: 1_000, vehicleTtlMs: 1_000 });
  const discovery = {
    async cities() {
      return [{ cityCode: "39", name: "Synthetic city" }];
    },
    async routes(cityCode: string, routeNumber: string) {
      return [
        { routeId: "JEB405136521", routeNumber, startStopName: `${cityCode}-A`, endStopName: "B" },
        { routeId: "JEB405136522", routeNumber, startStopName: "B", endStopName: `${cityCode}-A` },
      ];
    },
  };
  const handler = createTransitApiHandler({
    config,
    discovery: discovery as unknown as Parameters<typeof createTransitApiHandler>[0]["discovery"],
    provider,
    sessions: new JourneySessionCoordinator(provider, { automaticMatchingEnabled: config.matching.automaticMatchingEnabled }),
    log: (_level, event) => { events.push(event); },
  });
  return createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const method = request.method ?? "GET";
    const result = await handler(new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
      method,
      headers: request.headers as Record<string, string>,
      ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
    }), { clientAddress: "127.0.0.1" });
    const headers: Record<string, string> = {};
    result.headers.forEach((value, name) => { headers[name] = value; });
    response.writeHead(result.status, headers);
    response.end(Buffer.from(await result.arrayBuffer()));
  });
}

async function smoke(env: ServerEnv, events: string[] = [], script = "scripts/smoke.ts", extra: string[] = []): Promise<{ code: number | null; output: string }> {
  const server = deployment(env, events);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", script, `http://127.0.0.1:${port}`, ...extra], {
        cwd: new URL("../", import.meta.url),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the production smoke test passes end to end against the current API contract", async () => {
  const { code, output } = await smoke({});
  assert.equal(code, 0, output);
  assert.match(output, /17 passed, 0 warned, 0 blocked by credentials, 0 failed/);
  assert.match(output, /PASS +session store +memory store; sessions disabled because a serverless deployment would lose rides on scale-out/);
  assert.match(output, /PASS +matching posture +shadow; matcher directed-route-progress-v1; demonstrated readiness READY_FOR_SHADOW/);
  assert.match(output, /PASS +vehicles .*matching shadow_only_pending_matching_readiness/);
});

test("the production smoke test warns when an operator's automatic-matching opt-in is refused", async () => {
  const { code, output } = await smoke({ TRANSIT_AUTOMATIC_MATCHING_ENABLED: "true" });
  assert.equal(code, 0, output);
  assert.match(output, /WARN +matching posture +TRANSIT_AUTOMATIC_MATCHING_ENABLED=true is set and refused at demonstrated readiness READY_FOR_SHADOW/);
});

test("the smoke test never creates a journey session, even where sessions are enabled", async () => {
  const events: string[] = [];
  const { code, output } = await smoke({ TRANSIT_SESSIONS_ENABLED: "true" }, events);
  assert.equal(code, 0, output);
  assert.match(output, /PASS +sessions policy +sessions enabled; the write-free probe was rejected by input validation, nothing created/);
  assert.equal(events.includes("journey_session_created"), false, events.join(", "));
});

test("the session smoke creates one session, reads it, confirms a bus, ends it and leaves nothing behind", async () => {
  const events: string[] = [];
  const { code, output } = await smoke({ TRANSIT_SESSIONS_ENABLED: "true" }, events, "scripts/session-smoke.ts", ["--interval-ms", "0"]);
  assert.equal(code, 0, output);
  for (const name of ["preconditions", "route", "create", "reads persist", "concurrent reads", "confirm", "end", "unknown and malformed ids"]) {
    assert.match(output, new RegExp(`PASS +${name} `), `${name}\n${output}`);
  }
  assert.match(output, /0 failed/);
  // Each request is logged through the handler; one create and one end, and the end really removed the row.
  assert.ok(events.length > 0);
  assert.match(output, /PASS +end +DELETE 204, then the session reads 404 and a second DELETE is 404/);
  assert.ok(!output.includes("SYNTHETIC-1"), "no vehicle id is printed");
});

test("the session smoke skips a deployment whose sessions are disabled, and fails it when told they must be on", async () => {
  const skipped = await smoke({}, [], "scripts/session-smoke.ts", ["--interval-ms", "0"]);
  assert.equal(skipped.code, 0, skipped.output);
  assert.match(skipped.output, /SKIP +sessions enabled +sessions are disabled on this deployment/);
  const required = await smoke({}, [], "scripts/session-smoke.ts", ["--interval-ms", "0", "--require-enabled"]);
  assert.equal(required.code, 3, required.output);
});

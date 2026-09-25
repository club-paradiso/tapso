/**
 * Passive Shadow Validation v3 — bounded live collection, no rider.
 *
 *   node --experimental-strip-types scripts/passive-shadow/collect.ts --yes \
 *     --provider=tago-direct|tapso-public-api [--api-base=https://tapso-api.vercel.app] \
 *     [--city=39] [--routes=JEB405136521,JEB405136522] [--route-numbers=365] \
 *     [--max-routes=3] [--interval-ms=5000] [--minutes=30] [--max-calls=1080] \
 *     [--out=work/passive-shadow]
 *
 * `tago-direct` reads TAGO through the one `TagoTransitProvider` with
 * TAGO_SERVICE_KEY from the environment (never printed, never written).
 * `tapso-public-api` reads TAPSO's own public API and needs no credential.
 *
 * Output (raw vehicle numbers; ignored by Git): <out>/<collectionId>/
 *   streams/<streamId>.json, manifest.json. Nothing is written to Upstash.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TransitProvider } from "../../services/api/src/provider.ts";
import { resolveTagoServiceKey } from "../../services/api/src/serviceKey.ts";
import { TagoTransitProvider } from "../../services/api/src/tagoProvider.ts";
import { TapsoPublicApiProvider } from "../../services/api/src/tapsoPublicApiProvider.ts";
import { collectPassiveStreams, preflightRoutes, type RouteDiscovery } from "../../services/api/src/passiveShadowCollector.ts";
import { PASSIVE_SHADOW_POLICY_VERSION, streamSha256, type PassiveObservationStream } from "../../services/api/src/passiveShadow.ts";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key!, rest.join("=") || "true"];
}));

if (args.get("yes") !== "true" || !["tago-direct", "tapso-public-api"].includes(args.get("provider") ?? "")) {
  console.error("Usage: collect.ts --yes --provider=tago-direct|tapso-public-api [options]; see the header of this file.");
  process.exit(2);
}

const providerPath = args.get("provider") as "tago-direct" | "tapso-public-api";
const cityCode = args.get("city") ?? "39";
const routeIds = list(args.get("routes") ?? "JEB405136521,JEB405136522");
const routeNumbers = list(args.get("route-numbers") ?? "");
const maxRoutes = integer("max-routes", 3, 1, 8);
const intervalMs = integer("interval-ms", providerPath === "tago-direct" ? 5_000 : 10_000, 3_000, 60_000);
const minutes = integer("minutes", 30, 1, 90);
// The one documented TAGO budget: a 90-minute 5 s ride is ≤ 1 080 location
// calls (docs/exec-plans/RIDE_CAPTURE.md). A direct run may not exceed it.
const maxCalls = integer("max-calls", 1_080, 1, providerPath === "tago-direct" ? 1_080 : 5_000);
const outRoot = path.resolve(process.cwd(), args.get("out") ?? "work/passive-shadow");

const serviceKey = providerPath === "tago-direct" ? resolveTagoServiceKey(process.env).key : "";
if (providerPath === "tago-direct" && !serviceKey) {
  console.error("BLOCKED_BY_CREDENTIALS: tago-direct needs TAGO_SERVICE_KEY in the environment.");
  process.exit(3);
}

let provider: TransitProvider;
let discovery: RouteDiscovery | undefined;
if (providerPath === "tago-direct") {
  const tago = new TagoTransitProvider({ serviceKey });
  provider = tago;
  discovery = { routes: (city, number) => tago.routes(city, number) };
} else {
  const api = new TapsoPublicApiProvider({ baseUrl: args.get("api-base") ?? "https://tapso-api.vercel.app" });
  provider = api;
  discovery = api;
}

const collectionId = `pv3-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
const directory = path.join(outRoot, collectionId);
await mkdir(path.join(directory, "streams"), { recursive: true, mode: 0o700 });

const preflight = await preflightRoutes({ provider, discovery, cityCode, routeIds, routeNumbers, maxRoutes, maxCalls: Math.min(40, maxCalls) });
log(`preflight: ${preflight.preflight.map((row) => `${row.routeId}=${row.vehicles ?? `error(${row.error})`}`).join(" ")}`);
if (preflight.selected.length === 0) {
  await writeManifest({ stopReason: "NO_ROUTE_WITH_VEHICLES", streams: [], preflight: preflight.preflight, providerCalls: preflight.calls, failedCalls: 0, incidents: [] });
  log("no route reported an active vehicle; nothing collected");
  process.exit(4);
}
log(`collecting ${preflight.selected.map((route) => route.routeId).join(",")} for ${minutes} min every ${intervalMs} ms via ${providerPath}`);

let stopRequested = false;
process.once("SIGINT", () => { stopRequested = true; log("stop requested; finishing the current tick"); });
process.once("SIGTERM", () => { stopRequested = true; });

const result = await collectPassiveStreams({
  provider,
  providerPath,
  collectorEngine: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local-cli",
  collectionId,
  routes: preflight.selected,
  intervalMs,
  durationMs: minutes * 60_000,
  maxProviderCalls: maxCalls - preflight.calls,
  shouldStop: () => stopRequested,
  checkpoint: async (streams) => { for (const stream of streams) await writeStream(stream); },
  log: (line) => { if (/calls=\d*0 /.test(line)) log(line); },
});
await writeManifest({ ...result, preflight: preflight.preflight, providerCalls: result.providerCalls + preflight.calls });
log(`done: ${result.stopReason}; ${result.providerCalls + preflight.calls} provider calls (${result.failedCalls} failed); ${result.streams.map((stream) => `${stream.routeId}:${stream.snapshots.length}`).join(" ")}`);
console.log(directory);

async function writeStream(stream: PassiveObservationStream): Promise<void> {
  await writeAtomic(path.join(directory, "streams", `${stream.streamId}.json`), JSON.stringify(stream));
}

async function writeManifest(value: {
  stopReason: string;
  streams: PassiveObservationStream[];
  preflight: unknown;
  providerCalls: number;
  failedCalls: number;
  incidents: unknown[];
}): Promise<void> {
  await writeAtomic(path.join(directory, "manifest.json"), JSON.stringify({
    policyVersion: PASSIVE_SHADOW_POLICY_VERSION,
    collectionId,
    providerPath,
    cityCode,
    createdAt: new Date().toISOString(),
    stopReason: value.stopReason,
    providerCalls: value.providerCalls,
    failedCalls: value.failedCalls,
    incidents: value.incidents,
    preflight: value.preflight,
    budget: { maxCalls, intervalMs, minutes, maxRoutes },
    streams: value.streams.map((stream) => ({ streamId: stream.streamId, routeId: stream.routeId, snapshots: stream.snapshots.length, sha256: streamSha256(stream) })),
  }, null, 2));
}

async function writeAtomic(file: string, content: string): Promise<void> {
  if (serviceKey && content.includes(serviceKey)) throw new Error("output contains the credential; refusing to write");
  await writeFile(`${file}.tmp`, content, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = args.get(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`--${name} must be an integer in [${min}, ${max}]`);
    process.exit(2);
  }
  return value;
}

function log(line: string): void {
  console.error(`[${new Date().toISOString()}] ${line}`);
}

/**
 * Shared by every offline passive-evidence CLI: the network guard, the raw
 * tree hash, and checksum-verified loading of a collection directory.
 *
 * A collection directory is exactly what `collect.ts` writes: `manifest.json`
 * and `streams/<streamId>.json`. It holds raw vehicle numbers, so it lives in
 * ignored `work/` storage or the private draft-release evidence vault, never in Git or a public Actions artifact.
 */

import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import { existsSync, realpathSync } from "node:fs";
import net from "node:net";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { streamSha256, validatePassiveStream, type PassiveObservationStream } from "../../services/api/src/passiveShadow.ts";

export interface NetworkGuard {
  readonly attempts: number;
}

/**
 * Replaces `fetch`, outbound TCP/TLS socket connects (which every HTTP client
 * in Node ends in), DNS lookups and UDP sockets for the rest of the process.
 * Every attempt throws and is counted; callers refuse to report when the count
 * is not zero. Worker threads get fresh globals and are not covered; nothing
 * offline starts one.
 */
export function installNetworkGuard(tool: string): NetworkGuard {
  const state = { attempts: 0 };
  const refuse = (what: string): never => {
    state.attempts += 1;
    throw new Error(`${tool} is offline: ${what} was attempted`);
  };
  globalThis.fetch = (async () => refuse("a network call")) as typeof fetch;
  net.Socket.prototype.connect = function guardedConnect(): never {
    return refuse("a socket connection");
  } as typeof net.Socket.prototype.connect;
  dns.lookup = (() => refuse("a DNS lookup")) as unknown as typeof dns.lookup;
  dns.resolve = (() => refuse("a DNS query")) as unknown as typeof dns.resolve;
  dns.promises.lookup = (async () => refuse("a DNS lookup")) as unknown as typeof dns.promises.lookup;
  dns.promises.resolve = (async () => refuse("a DNS query")) as unknown as typeof dns.promises.resolve;
  dgram.createSocket = (() => refuse("a UDP socket")) as unknown as typeof dgram.createSocket;
  return { get attempts() { return state.attempts; } };
}

export interface RawTree {
  sha256: string;
  files: Array<{ file: string; sha256: string }>;
}

/**
 * The stream files of a collection. A window that found no vehicle has an empty
 * `streams/`, and an artifact upload drops empty directories, so a missing
 * `streams/` reads as empty; the manifest's stream count still has to match.
 */
async function streamFiles(root: string): Promise<string[]> {
  const directory = path.join(root, "streams");
  if (!existsSync(directory)) return [];
  return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
}

/** sha256 over the raw evidence files only: manifest.json and streams/*.json. */
export async function rawTree(root: string): Promise<RawTree> {
  const names = ["manifest.json", ...(await streamFiles(root)).map((name) => `streams/${name}`)];
  const files: Array<{ file: string; sha256: string }> = [];
  for (const name of names) {
    files.push({ file: name, sha256: createHash("sha256").update(await readFile(path.join(root, name))).digest("hex") });
  }
  return { sha256: createHash("sha256").update(files.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")).digest("hex"), files };
}

export interface CollectionManifest {
  collectionId: string;
  providerPath: string;
  requestedProviderPath?: string;
  providerCalls: number;
  failedCalls: number;
  stopReason: string;
  createdAt?: string;
  streams: Array<{ streamId: string; routeId?: string; sha256: string }>;
}

export interface StreamCheck {
  streamId: string;
  routeId: string;
  providerPath: string;
  manifestSha256: string;
  recomputedSha256: string;
}

/**
 * Loads every stream, refusing on any checksum mismatch, any provider-path
 * disagreement with the manifest, or a stream count that differs from it.
 */
export async function loadVerifiedCollection(directory: string): Promise<{
  manifest: CollectionManifest;
  streams: PassiveObservationStream[];
  checks: StreamCheck[];
}> {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as CollectionManifest;
  const expected = new Map(manifest.streams.map((entry) => [entry.streamId, entry.sha256]));
  const streams: PassiveObservationStream[] = [];
  const checks: StreamCheck[] = [];
  for (const file of await streamFiles(directory)) {
    const stream = JSON.parse(await readFile(path.join(directory, "streams", file), "utf8")) as PassiveObservationStream;
    validatePassiveStream(stream);
    const recomputed = streamSha256(stream);
    const recorded = expected.get(stream.streamId);
    checks.push({ streamId: stream.streamId, routeId: stream.routeId, providerPath: stream.providerPath, manifestSha256: recorded ?? "MISSING", recomputedSha256: recomputed });
    if (recorded !== recomputed) {
      throw new Error(`stream ${stream.streamId} does not match its manifest checksum; refusing to evaluate`);
    }
    if (stream.providerPath !== manifest.providerPath) {
      throw new Error(`stream ${stream.streamId} was collected via ${stream.providerPath} but the manifest says ${manifest.providerPath}`);
    }
    streams.push(stream);
  }
  if (streams.length !== manifest.streams.length) {
    throw new Error(`manifest lists ${manifest.streams.length} streams but ${streams.length} were found`);
  }
  return { manifest, streams, checks };
}

/** Outputs must never land inside the raw collection. */
export function assertOutsideRaw(directory: string, output: string, flag: string): void {
  // Compared through symlinks: an output reached through a link into the raw
  // directory is still inside it.
  const raw = realpathSync(directory);
  const resolved = realExistingPrefix(path.resolve(output));
  if (resolved === raw || resolved.startsWith(`${raw}${path.sep}`)) {
    throw new Error(`${flag} must be outside the raw collection directory`);
  }
}

/** The path with its longest existing prefix resolved through symlinks. */
function realExistingPrefix(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(realpathSync(existing), ...rest);
}

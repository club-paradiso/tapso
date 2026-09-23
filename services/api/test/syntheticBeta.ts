/**
 * Synthetic beta-tester rides for tests. Invented vehicle numbers, an invented
 * route, and a coordinate grid that is not a place. Nothing here is a real ride.
 *
 * Not a test file: the runner only picks up `*.test.ts`.
 */

import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { createBackgroundRequestHandler } from "../src/backgroundHttp.ts";
import { BackgroundRideCaptureCoordinator } from "../src/backgroundRideCapture.ts";
import { BetaService } from "../src/betaService.ts";
import { MemoryBetaTesterStore } from "../src/betaTester.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { MemoryFieldValidationStore, type FieldValidationStore } from "../src/fieldValidation.ts";

export const OPERATOR = "synthetic-operator-token-0123456789";
export const CITY = "999";
export const ROUTE = "SYN-BETA-ROUTE";
export const BOARDED = "제주79자9999";
export const DECOY = "제주79자8888";
export const TWIN = "제주79자7777";
export const BOARDING = 3;
const EPOCH = new Date(0).toISOString();

export const stops: StopOnRoute[] = Array.from({ length: 30 }, (_, index) => ({
  stopId: `SYN-${index + 1}`,
  name: `Synthetic ${index + 1}`,
  sequence: index + 1,
  latitude: 33.5 + index * 0.01,
  longitude: 126.5,
}));

/**
 * `clean`     the boarded bus leaves the boarding stop and advances a stop every
 *             second poll; a decoy idles far down the route.
 * `wrong`     a decoy leaves the boarding stop; the boarded bus idles far away.
 * `ambiguous` the boarded bus and a twin move in lockstep from the boarding
 *             stop, so the matcher never has a margin and never commits.
 */
export type BetaRideKind = "clean" | "wrong" | "ambiguous";

export function syntheticProvider(now: () => Date, kind: () => BetaRideKind) {
  let calls = 0;
  const observation = (routeId: string, vehicleId: string, stopSequence: number): VehicleObservation => ({
    vehicleId,
    routeId,
    observedAt: EPOCH,
    receivedAt: now().toISOString(),
    timestampSource: "unavailable",
    stopId: `SYN-${stopSequence}`,
    stopSequence,
    latitude: stops[stopSequence - 1]!.latitude,
    longitude: stops[stopSequence - 1]!.longitude,
    directionCode: "1",
    receiveType: "TAGO_SNAPSHOT",
  });
  return {
    get calls() { return calls; },
    reset() { calls = 0; },
    async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
      return stops;
    },
    async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
      const moving = Math.min(BOARDING + Math.floor(calls / 2), stops.length);
      calls += 1;
      switch (kind()) {
        case "wrong":
          return [observation(request.routeId, DECOY, moving), observation(request.routeId, BOARDED, 27)];
        case "ambiguous":
          return [observation(request.routeId, BOARDED, moving), observation(request.routeId, TWIN, moving)];
        default:
          return [observation(request.routeId, BOARDED, moving), observation(request.routeId, DECOY, 28)];
      }
    },
  };
}

export interface BetaHarnessOptions {
  fieldValidation?: FieldValidationStore;
  betaStore?: MemoryBetaTesterStore;
  allowedOrigins?: string[];
}

export async function betaHarness(options: BetaHarnessOptions = {}) {
  let nowMs = Date.parse("2026-09-23T09:00:00.000Z");
  let rideKind: BetaRideKind = "clean";
  const now = () => new Date(nowMs);
  const provider = syntheticProvider(now, () => rideKind);
  const fieldValidation = options.fieldValidation ?? new MemoryFieldValidationStore();
  const betaStore = options.betaStore ?? new MemoryBetaTesterStore();
  const logs: string[] = [];
  let beta: BetaService | undefined;
  const coordinator = new BackgroundRideCaptureCoordinator(provider, {
    now,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
    cancel: () => {},
    onComplete: async ({ sessionId, mode }) => {
      if (mode === "field") await beta?.onCaptureComplete(sessionId);
    },
  });
  beta = new BetaService({ store: betaStore, fieldValidation, captures: coordinator, provider, now, log: (line) => logs.push(line) });

  const server: Server = createServer(createBackgroundRequestHandler({
    captures: coordinator,
    operator: { configured: true, token: OPERATOR },
    allowedOrigins: options.allowedOrigins ?? [],
    health: () => ({ ok: true }),
    log: (line) => logs.push(line),
    fieldValidation: { store: fieldValidation },
    beta,
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("no address");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(method: string, route: string, { token, body, headers = {} }: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, text, json };
  }

  async function invite(body: Record<string, unknown> = {}) {
    const created = await call("POST", "/beta/invites", { token: OPERATOR, body });
    if (created.status !== 201) throw new Error(`invite failed ${created.status} ${created.text}`);
    const secret = String(created.json.invitePath).split("#invite=")[1]!;
    return { ...created.json, secret };
  }

  async function tester(body: Record<string, unknown> = {}) {
    const created = await invite(body);
    const session = await call("POST", "/beta/session", { body: { invite: created.secret } });
    if (session.status !== 201) throw new Error(`redeem failed ${session.status} ${session.text}`);
    return { inviteId: created.inviteId as string, secret: created.secret as string, credential: session.json.credential as string };
  }

  function startBody(overrides: Record<string, unknown> = {}) {
    return {
      routeId: ROUTE,
      cityCode: CITY,
      routeNo: "365",
      plateSuffix: "9999",
      boardingStopSequence: BOARDING,
      ...overrides,
    };
  }

  async function startRide(credential: string, overrides: Record<string, unknown> = {}) {
    provider.reset();
    return call("POST", "/beta/rides", { token: credential, body: startBody(overrides) });
  }

  /** The collector's own polling, driven by hand. */
  async function poll(sessionId: string, times: number) {
    for (let index = 0; index < times; index += 1) {
      nowMs += 5_000;
      await coordinator.pollNow(sessionId);
    }
  }

  return {
    call,
    invite,
    tester,
    startRide,
    startBody,
    poll,
    coordinator,
    beta,
    betaStore,
    fieldValidation,
    provider,
    logs,
    advance(ms: number) { nowMs += ms; },
    setKind(kind: BetaRideKind) { rideKind = kind; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

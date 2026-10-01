/**
 * The API contract the iOS client decodes, produced by the real request
 * handler rather than written by hand.
 *
 *   node --experimental-strip-types services/api/scripts/contractFixtures.ts
 *
 * writes `fixtures/transit/api-contract/*.json`. Each file is one exchange with
 * the production router and session coordinator, driven by a SYNTHETIC
 * provider (invented plates and coordinates on the app's demo stop names) and a
 * fixed clock, so the output is byte-stable. `packages/transit-core` decodes
 * every file in its tests, and `test/contractFixtures.test.ts` fails when the
 * committed files no longer match what the server would answer: a change to the
 * wire shape cannot reach main without the Swift side seeing it.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readTransitApiConfig } from "../src/apiConfig.ts";
import { createTransitApiHandler, type TransitApiHandler } from "../src/apiRouter.ts";
import { CachedTransitProvider } from "../src/cachedTransitProvider.ts";
import type { RouteRequest, StopOnRoute, VehicleObservation } from "../src/domain.ts";
import { JourneySessionCoordinator } from "../src/journeySession.ts";
import { ProviderConfigurationError, type TransitProvider } from "../src/provider.ts";

const CITY = "39";
const ROUTE = "JEB405136521";
const EPOCH = new Date(0).toISOString();
const START = Date.parse("2026-10-01T08:00:00.000Z");

/** SYNTHETIC: the demo route's stop names with invented, evenly spaced coordinates. */
const STOP_NAMES = [
  "제주버스터미널", "용문마을", "용담사거리", "서문시장", "관덕정",
  "중앙로", "동문로터리", "제주여자상업고등학교", "제주시청(아라방면)", "국립제주박물관",
];
const STOPS: StopOnRoute[] = STOP_NAMES.map((name, index) => ({
  stopId: `SYN-${index + 1}`,
  name,
  sequence: index + 1,
  latitude: 33.5 + index * 0.002,
  longitude: 126.52 + index * 0.002,
}));
const RIDER_BUS = "제주70자0001";
const OTHER_BUS = "제주70자0417";

class SyntheticProvider implements TransitProvider {
  /** Stop sequence of each synthetic bus at the next read; absent = not in the feed. */
  positions = new Map<string, number>([[RIDER_BUS, 1], [OTHER_BUS, 4]]);
  failing = false;

  private readonly clock: () => Date;

  constructor(clock: () => Date) {
    this.clock = clock;
  }

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return STOPS.map((stop) => ({ ...stop }));
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    if (this.failing) throw new ProviderConfigurationError("synthetic outage");
    const receivedAt = this.clock().toISOString();
    return [...this.positions].map(([vehicleId, sequence]) => {
      const stop = STOPS[sequence - 1]!;
      return {
        vehicleId,
        routeId: request.routeId,
        observedAt: EPOCH,
        receivedAt,
        timestampSource: "unavailable" as const,
        stopId: stop.stopId,
        stopName: stop.name,
        stopSequence: sequence,
        latitude: stop.latitude,
        longitude: stop.longitude,
        receiveType: "TAGO_SNAPSHOT",
      };
    });
  }
}

type Exchange = { synthetic: true; request: string; status: number; body: unknown };

function harness(env: Record<string, string>, clock: () => Date, provider: SyntheticProvider): TransitApiHandler {
  const config = readTransitApiConfig({ TAGO_SERVICE_KEY: "synthetic-key", ...env }, { nodeVersion: "v22.0.0" });
  const cached = new CachedTransitProvider(provider, { stopTtlMs: 0, vehicleTtlMs: 0 });
  let next = 0;
  return createTransitApiHandler({
    config,
    discovery: {
      async cities() {
        return [{ cityCode: CITY, name: "제주특별자치도" }];
      },
      async routes(_cityCode: string, routeNumber: string) {
        return [
          { routeId: "JEB405136521", routeNumber, startStopName: "제주버스터미널", endStopName: "국립제주박물관" },
          { routeId: "JEB405136522", routeNumber, startStopName: "국립제주박물관", endStopName: "제주버스터미널" },
        ];
      },
    },
    provider: cached,
    ...(config.sessions.enabled
      ? {
          sessions: new JourneySessionCoordinator(provider, {
            now: clock,
            idFactory: () => `synthetic-session-${++next}`,
            automaticMatchingEnabled: config.matching.automaticMatchingEnabled,
          }),
        }
      : {}),
    now: clock,
    log: () => {},
  });
}

async function call(handler: TransitApiHandler, method: string, path: string, body?: unknown): Promise<Exchange> {
  const response = await handler(new Request(`http://api.test${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }));
  const text = await response.text();
  return { synthetic: true, request: `${method} ${path}`, status: response.status, body: text ? JSON.parse(text) : null };
}

/** Every exchange, keyed by fixture name. Deterministic: same input, same bytes. */
export async function generateContractFixtures(): Promise<Record<string, Exchange>> {
  let now = START;
  const clock = () => new Date(now);
  const provider = new SyntheticProvider(clock);
  const api = harness({ TRANSIT_SESSIONS_ENABLED: "true" }, clock, provider);
  const out: Record<string, Exchange> = {};

  out["routes"] = await call(api, "GET", `/v1/routes?cityCode=${CITY}&routeNo=365`);
  out["stops"] = await call(api, "GET", `/v1/stops?routeId=${ROUTE}&cityCode=${CITY}`);
  out["vehicles"] = await call(api, "GET", `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);

  // The rider waits at 제주버스터미널 (1) for 제주시청(아라방면) (9).
  provider.positions = new Map([[RIDER_BUS, 1], [OTHER_BUS, 4]]);
  out["session-created"] = await call(api, "POST", "/v1/sessions", {
    routeId: ROUTE, cityCode: CITY, boardingStopSequence: 1, destinationStopSequence: 9,
  });
  const id = (out["session-created"].body as { id: string }).id;

  now += 10_000;
  out["session-confirmed"] = await call(api, "POST", `/v1/sessions/${id}/confirm`, { vehicleId: RIDER_BUS });

  // The bus moves on; three reads ten seconds apart make its cadence fresh.
  for (const sequence of [2, 3]) {
    now += 10_000;
    provider.positions = new Map([[RIDER_BUS, sequence], [OTHER_BUS, 5]]);
    out["session-tracking"] = await call(api, "GET", `/v1/sessions/${id}`);
  }
  for (const [name, sequence] of [["session-approaching", 7], ["session-next-stop", 8], ["session-arrived", 9]] as const) {
    now += 10_000;
    provider.positions = new Map([[RIDER_BUS, sequence]]);
    out[name] = await call(api, "GET", `/v1/sessions/${id}`);
  }

  now += 10_000;
  provider.positions = new Map();
  out["session-vehicle-missing"] = await call(api, "GET", `/v1/sessions/${id}`);

  now += 10_000;
  provider.failing = true;
  out["session-provider-failed"] = await call(api, "GET", `/v1/sessions/${id}`);
  provider.failing = false;

  out["session-ended"] = await call(api, "DELETE", `/v1/sessions/${id}`);
  out["error-session-not-found"] = await call(api, "GET", `/v1/sessions/${id}`);
  out["error-invalid-input"] = await call(api, "POST", "/v1/sessions", { routeId: ROUTE, cityCode: CITY });

  const disabled = harness({ VERCEL: "1", TRANSIT_SESSION_STORE: "memory" }, clock, provider);
  out["error-sessions-unavailable"] = await call(disabled, "POST", "/v1/sessions", {
    routeId: ROUTE, cityCode: CITY, boardingStopSequence: 1, destinationStopSequence: 9,
  });

  const outage = new SyntheticProvider(clock);
  outage.failing = true;
  const blocked = harness({ TRANSIT_SESSIONS_ENABLED: "true" }, clock, outage);
  out["error-provider-unavailable"] = await call(blocked, "GET", `/v1/vehicles?routeId=${ROUTE}&cityCode=${CITY}`);

  return out;
}

export const CONTRACT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/transit/api-contract");

export function serialize(exchange: Exchange): string {
  return `${JSON.stringify(exchange, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixtures = await generateContractFixtures();
  await mkdir(CONTRACT_DIRECTORY, { recursive: true });
  for (const [name, exchange] of Object.entries(fixtures)) {
    await writeFile(join(CONTRACT_DIRECTORY, `${name}.json`), serialize(exchange));
  }
  console.log(`wrote ${Object.keys(fixtures).length} SYNTHETIC contract fixtures to fixtures/transit/api-contract`);
}

/**
 * The one wiring point shared by every transport.
 *
 * Module scope is deliberate: on a warm serverless instance the provider cache
 * and the burst limiter survive between invocations, which is exactly the reuse
 * they are there for. Nothing here is per-request state.
 */

import { readTransitApiConfig, readUpstashCredentials, type ServerEnv, type TransitApiConfig } from "./apiConfig.ts";
import { createTransitApiHandler, type TransitApiHandler } from "./apiRouter.ts";
import { ApnsLiveActivitySender, describeApns, Http2ApnsTransport, readApnsConfig } from "./apns.ts";
import { ActiveRideSnapshotProvider } from "./activeRideSnapshot.ts";
import { CachedTransitProvider } from "./cachedTransitProvider.ts";
import { JourneySessionCoordinator } from "./journeySession.ts";
import { LiveActivityPusher } from "./liveActivityPusher.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
import { logProviderRequest, ProviderHealth } from "./providerHealth.ts";
import { createBurstLimiter } from "./rateLimit.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "./serviceKey.ts";
import { readSessionKeyPrefix } from "./sessionKeyPrefix.ts";
import { MemoryJourneySessionStore, type JourneySessionStore } from "./sessionStore.ts";
import { fileStaticTransitData } from "./staticTransitData.ts";
import { TagoTransitProvider } from "./tagoProvider.ts";
import { UpstashJourneySessionStore } from "./upstashSessionStore.ts";

export interface TransitApi {
  config: TransitApiConfig;
  handler: TransitApiHandler;
  upstream: TagoTransitProvider;
  provider: CachedTransitProvider;
}

export function createTransitApi(env: ServerEnv = process.env as ServerEnv): TransitApi {
  const config = readTransitApiConfig(env);

  // Emitted once per process, at wiring time, so a deployment reading the
  // retired variable name says so in its runtime log instead of just answering
  // 503 and leaving the operator to guess.
  const credential = resolveTagoServiceKey(env);
  const warning = serviceKeyWarning(credential);
  if (warning) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "transit_credential_name",
      message: warning,
    }));
  }

  // Same once-per-process rule: an operator who set the automatic-matching
  // flag learns from the runtime log, not only from `/health`, that the
  // demonstrated readiness refused it.
  if (config.matching.automaticMatchingRequested && !config.matching.automaticMatchingEnabled) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "automatic_matching_refused",
      message: `TRANSIT_AUTOMATIC_MATCHING_ENABLED=true is refused: release gate ${config.matching.readiness.gate} `
        + `has demonstrated ${config.matching.readiness.demonstrated}, and automatic selection needs `
        + `${config.matching.readiness.requiredForAutomaticMatching}`,
    }));
  }

  // Passed explicitly so this function honours the `env` it was given rather
  // than reaching back into `process.env` through the provider's own default.
  // One record per logical TAGO request: a structured log line, and this
  // instance's rolling summary in `/health` (`providerHealth.ts`).
  const providerHealth = new ProviderHealth();
  const upstream = new TagoTransitProvider({
    serviceKey: credential.key,
    onRequest: (record) => {
      providerHealth.record(record);
      logProviderRequest(record);
    },
  });
  const provider = new CachedTransitProvider(upstream, {
    stopTtlMs: config.cachePolicy.stopTtlMs,
    vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
  });
  // `readTransitApiConfig` already refused a `redis` store without usable
  // credentials, so this re-read should always find them. It is checked again
  // rather than asserted: wiring that silently produced a store with an empty
  // token would fail on every request instead of at boot.
  const sessionStore = createSessionStore(config, env);
  // Journey sessions never read the shared 20 s vehicle cache. Server-observed
  // cadence is only evidence if consecutive reads are genuinely consecutive;
  // that cache would hand one rider the same receipt on several polls. Their
  // own path shares a route snapshot only below the fastest foreground poll,
  // keeps each row's original receipt time (which the cadence history records
  // at most once) and bounds upstream reads per instance (`activeRideSnapshot.ts`).
  const activeRideReads = new ActiveRideSnapshotProvider(upstream);
  const sessions = new JourneySessionCoordinator(activeRideReads, {
    automaticMatchingEnabled: config.matching.automaticMatchingEnabled,
    store: sessionStore,
  });
  // Push needs the APNs key, team and bundle id (`apns.ts`); without all of
  // them nothing is pushed and `/health` names what is missing.
  const apns = readApnsConfig(env);
  const limiter = config.rateLimit.enabled
    ? createBurstLimiter(config.rateLimit.limit, config.rateLimit.windowSeconds)
    : undefined;

  const operator = resolveOperatorToken(env);
  if (operator.problem) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "ride_capture_operator_token",
      message: operator.problem,
    }));
  }
  // A limit of zero is an explicit operator choice to run unlimited; anything
  // else gets its own window so a ride and the public API never share a budget.
  const operatorLimiter = config.operator.rateLimitPerMinute > 0
    ? createBurstLimiter(config.operator.rateLimitPerMinute, 60)
    : undefined;

  return {
    config,
    upstream,
    provider,
    handler: createTransitApiHandler({
      config,
      discovery: upstream,
      provider,
      // As `directProvider`, the uncached provider reaches exactly one route:
      // the authenticated operator snapshot. It also backs discovery and,
      // through `activeRideReads`, the session coordinator above.
      directProvider: upstream,
      sessions,
      activeRideReads,
      liveActivityPush: describeApns(apns),
      ...(apns.enabled
        ? { liveActivityPusher: new LiveActivityPusher(new ApnsLiveActivitySender(apns, new Http2ApnsTransport()), sessions) }
        : {}),
      providerHealth,
      staticData: fileStaticTransitData(),
      ...(limiter ? { limiter } : {}),
      ...(operatorLimiter ? { operatorLimiter } : {}),
      ...(operator.configured ? { operatorToken: operator.token } : {}),
    }),
  };
}

function createSessionStore(config: TransitApiConfig, env: ServerEnv): JourneySessionStore {
  if (config.sessions.store !== "redis") return new MemoryJourneySessionStore();
  const credentials = readUpstashCredentials(env);
  if (!credentials) {
    throw new RangeError(
      "TRANSIT_SESSION_STORE=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }
  return new UpstashJourneySessionStore({ ...credentials, keyPrefix: readSessionKeyPrefix(env) });
}

/** The process-wide instance every entry point serves from. */
export const transitApi = createTransitApi();

export const handleTransitRequest: TransitApiHandler = (request, context) =>
  transitApi.handler(request, context);

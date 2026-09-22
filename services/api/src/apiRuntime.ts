/**
 * The one wiring point shared by every transport.
 *
 * Module scope is deliberate: on a warm serverless instance the provider cache
 * and the burst limiter survive between invocations, which is exactly the reuse
 * they are there for. Nothing here is per-request state.
 */

import { readTransitApiConfig, type ServerEnv, type TransitApiConfig } from "./apiConfig.ts";
import { createTransitApiHandler, type TransitApiHandler } from "./apiRouter.ts";
import { CachedTransitProvider } from "./cachedTransitProvider.ts";
import { JourneySessionCoordinator } from "./journeySession.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
import { createBurstLimiter } from "./rateLimit.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "./serviceKey.ts";
import { TagoTransitProvider } from "./tagoProvider.ts";

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

  // Passed explicitly so this function honours the `env` it was given rather
  // than reaching back into `process.env` through the provider's own default.
  const upstream = new TagoTransitProvider({ serviceKey: credential.key });
  const provider = new CachedTransitProvider(upstream, {
    stopTtlMs: config.cachePolicy.stopTtlMs,
    vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
  });
  // Journey sessions need uncached consecutive provider reads so Task C can\n  // establish source freshness from server-observed cadence rather than from the public 20 s cache.\n  const sessions = new JourneySessionCoordinator(upstream);
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
      // The uncached provider reaches exactly one place: the authenticated
      // operator snapshot route used to collect ride evidence.
      directProvider: upstream,
      sessions,
      ...(limiter ? { limiter } : {}),
      ...(operatorLimiter ? { operatorLimiter } : {}),
      ...(operator.configured ? { operatorToken: operator.token } : {}),
    }),
  };
}

/** The process-wide instance every entry point serves from. */
export const transitApi = createTransitApi();

export const handleTransitRequest: TransitApiHandler = (request, context) =>
  transitApi.handler(request, context);

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
import { createBurstLimiter } from "./rateLimit.ts";
import { TagoTransitProvider } from "./tagoProvider.ts";

export interface TransitApi {
  config: TransitApiConfig;
  handler: TransitApiHandler;
  upstream: TagoTransitProvider;
  provider: CachedTransitProvider;
}

export function createTransitApi(env: ServerEnv = process.env as ServerEnv): TransitApi {
  const config = readTransitApiConfig(env);
  const upstream = new TagoTransitProvider();
  const provider = new CachedTransitProvider(upstream, {
    stopTtlMs: config.cachePolicy.stopTtlMs,
    vehicleTtlMs: config.cachePolicy.vehicleTtlMs,
  });
  const sessions = new JourneySessionCoordinator(provider);
  const limiter = config.rateLimit.enabled
    ? createBurstLimiter(config.rateLimit.limit, config.rateLimit.windowSeconds)
    : undefined;

  return {
    config,
    upstream,
    provider,
    handler: createTransitApiHandler({
      config,
      discovery: upstream,
      provider,
      sessions,
      ...(limiter ? { limiter } : {}),
    }),
  };
}

/** The process-wide instance every entry point serves from. */
export const transitApi = createTransitApi();

export const handleTransitRequest: TransitApiHandler = (request, context) =>
  transitApi.handler(request, context);

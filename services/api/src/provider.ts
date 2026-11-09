import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";

export interface TransitProvider {
  stops(request: RouteRequest): Promise<StopOnRoute[]>;
  vehicles(request: RouteRequest): Promise<VehicleObservation[]>;
}

export class ProviderConfigurationError extends Error {
  readonly code = "BLOCKED_BY_CREDENTIALS";
}

/**
 * The provider answered, but not with something TAPSO can use: a malformed
 * envelope, a missing field, a logical error code. The two subclasses below
 * split out the failures that are about reaching the provider at all, so a
 * client can tell "the bus feed is slow right now" from "the bus feed sent
 * nonsense" from "TAPSO itself broke" (`INTERNAL_ERROR`). None of the three is
 * evidence about any vehicle; every caller that catches one keeps catching all
 * of them through this base class.
 */
export class ProviderResponseError extends Error {
  readonly code: ProviderFailureCode = "PROVIDER_RESPONSE_INVALID";
}

/** The provider did not answer within TAPSO's deadline. */
export class ProviderTimeoutError extends ProviderResponseError {
  override readonly code = "PROVIDER_TIMEOUT";
}

/** The provider could not be reached, or answered with an HTTP error status. */
export class ProviderUnavailableError extends ProviderResponseError {
  override readonly code = "PROVIDER_UNAVAILABLE";
}

/**
 * The provider refused the request for its rate limit (HTTP 429). Not
 * retried: another request only adds to the load it just refused. Carries how
 * long a client should wait, which the API passes on as `Retry-After`.
 */
export class ProviderRateLimitedError extends ProviderResponseError {
  override readonly code = "PROVIDER_RATE_LIMITED";
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ProviderFailureCode = "PROVIDER_RESPONSE_INVALID" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RATE_LIMITED";

/**
 * Classifies a rejected `fetch`. `AbortSignal.timeout` rejects with a
 * `DOMException` named `TimeoutError`; anything else (DNS, TLS, reset) is a
 * transport failure.
 */
export function providerTransportError(error: unknown, provider: string): ProviderResponseError {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "TimeoutError"
    ? new ProviderTimeoutError(`${provider} request timed out`)
    : new ProviderUnavailableError(`${provider} request failed`);
}

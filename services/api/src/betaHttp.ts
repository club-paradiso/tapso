/**
 * The collector's `/beta/*` routes. Wired from `backgroundHttp.ts`, which owns
 * CORS, error mapping and the request log; this file only decides who may call
 * what and hands the call to `BetaService`.
 *
 *   POST /beta/session                 public      invite secret (body) → tester credential
 *   GET  /beta/me                      tester      own access + own open ride
 *   POST /beta/rides                   tester      start a ride
 *   GET  /beta/rides/:id               tester      own ride only
 *   POST /beta/rides/:id/finish        tester      own ride only; idempotent; submits
 *   POST /beta/invites                 operator    create; the secret is returned once
 *   GET  /beta/invites                 operator    metadata only, never a secret
 *   POST /beta/invites/:id/revoke      operator
 *   GET  /beta/campaign                operator    sanitized beta matcher summary
 *
 * A tester credential is accepted on the tester routes and nowhere else, and
 * the operator token is not accepted on them: the two never substitute.
 */

import type { IncomingMessage } from "node:http";

import type { CollectorCapability } from "./backgroundHttp.ts";
import { BetaTesterError } from "./betaTester.ts";
import type { BetaPrincipal, BetaService, BetaStartInput } from "./betaService.ts";
import { readBearerToken } from "./operatorAuth.ts";
import { createBurstLimiter, type BurstLimiter } from "./rateLimit.ts";

export const BETA_PAGE_PATH = "/ride-capture/beta.html";

export interface BetaRouteContext {
  beta: BetaService | undefined;
  authorize: (request: IncomingMessage, capability: CollectorCapability) => void;
  allowedOrigins: string[];
  readJson: (request: IncomingMessage) => Promise<unknown>;
  respond: (status: number, body: unknown) => void;
  limits: BetaLimits;
}

export interface BetaLimits {
  redeem: BurstLimiter;
  tester: BurstLimiter;
}

export function createBetaLimits(): BetaLimits {
  return {
    // A 256-bit secret cannot be guessed; this only bounds junk traffic.
    redeem: createBurstLimiter(10, 60),
    // The page reads once on load and every few seconds while a ride closes.
    tester: createBurstLimiter(60, 60),
  };
}

/** Returns the log route name when `path` is a beta route, after responding. */
export async function routeBeta(
  request: IncomingMessage,
  path: string,
  context: BetaRouteContext,
): Promise<string | undefined> {
  if (path !== "/beta" && !path.startsWith("/beta/")) return undefined;
  const method = request.method ?? "GET";
  const { respond } = context;

  // Operator routes: the existing authorization seam, operator token by default.
  if (path === "/beta/invites" || path.startsWith("/beta/invites/") || path === "/beta/campaign") {
    context.authorize(request, path === "/beta/campaign" ? "campaign:read" : "beta:admin");
    const beta = requireBeta(context);
    if (path === "/beta/campaign" && method === "GET") {
      respond(200, await beta.campaign());
      return "beta_campaign";
    }
    if (path === "/beta/invites" && method === "GET") {
      respond(200, { invites: await beta.listInvites() });
      return "beta_invite_list";
    }
    if (path === "/beta/invites" && method === "POST") {
      const { invite, secret } = await beta.createInvite(await readObject(context, request));
      const fragment = `#invite=${secret}`;
      const origin = request.headers.origin;
      respond(201, {
        ...invite,
        invitePath: `${BETA_PAGE_PATH}${fragment}`,
        ...(origin && context.allowedOrigins.includes(origin) ? { inviteUrl: `${origin}${BETA_PAGE_PATH}${fragment}` } : {}),
        note: "The link is shown once. Only a digest of its secret is stored.",
      });
      return "beta_invite_create";
    }
    const revoke = /^\/beta\/invites\/([^/]+)\/revoke$/.exec(path);
    if (revoke && method === "POST") {
      respond(200, await beta.revokeInvite(decodeURIComponent(revoke[1] ?? "")));
      return "beta_invite_revoke";
    }
    throw new BetaTesterError(404, "NOT_FOUND", "no such endpoint");
  }

  if (path === "/beta/session") {
    if (method !== "POST") throw new BetaTesterError(405, "METHOD_NOT_ALLOWED", "method is not allowed");
    limit(context.limits.redeem, `ip:${clientAddress(request)}`);
    const beta = requireBeta(context);
    // The secret arrives in the body, never in a URL, so no proxy logs it.
    respond(201, await beta.redeem((await readObject(context, request)).invite));
    return "beta_session";
  }

  // Everything else is a tester route.
  const beta = requireBeta(context);
  const credential = readBearerToken(headerValue(request.headers.authorization));
  const principal: BetaPrincipal = await beta.authenticate(credential);
  limit(context.limits.tester, `tester:${principal.testerId}`);

  if (path === "/beta/me" && method === "GET") {
    respond(200, await beta.me(principal));
    return "beta_me";
  }
  if (path === "/beta/rides" && method === "POST") {
    respond(201, await beta.start(principal, await readObject(context, request) as unknown as BetaStartInput));
    return "beta_start";
  }
  const ride = /^\/beta\/rides\/([^/]+)(\/finish)?$/.exec(path);
  if (ride) {
    const sessionId = decodeURIComponent(ride[1] ?? "");
    if (!ride[2] && method === "GET") {
      respond(200, await beta.ride(principal, sessionId));
      return "beta_ride";
    }
    if (ride[2] && method === "POST") {
      respond(200, await beta.finish(principal, sessionId));
      return "beta_finish";
    }
    throw new BetaTesterError(405, "METHOD_NOT_ALLOWED", "method is not allowed");
  }
  throw new BetaTesterError(404, "NOT_FOUND", "no such endpoint");
}

async function readObject(context: BetaRouteContext, request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await context.readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BetaTesterError(400, "INVALID_INPUT", "request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function requireBeta(context: BetaRouteContext): BetaService {
  if (!context.beta) {
    throw new BetaTesterError(503, "BETA_UNAVAILABLE", "beta testing is not configured on this collector");
  }
  return context.beta;
}

function limit(limiter: BurstLimiter, bucket: string): void {
  if (!limiter.consume(bucket).allowed) throw new BetaTesterError(429, "RATE_LIMITED", "too many requests");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The address the platform proxy saw. Used only as an in-memory rate-limit bucket, never logged. */
function clientAddress(request: IncomingMessage): string {
  const forwarded = headerValue(request.headers["x-forwarded-for"]);
  const last = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  return last ?? request.socket.remoteAddress ?? "unknown";
}

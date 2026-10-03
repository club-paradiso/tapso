import { createServer } from "node:http";

import { readUpstashCredentials } from "./apiConfig.ts";
import { createBackgroundRequestHandler } from "./backgroundHttp.ts";
import { BackgroundRideCaptureCoordinator } from "./backgroundRideCapture.ts";
import { resolveBetaTesterMode } from "./betaHttp.ts";
import { BetaService } from "./betaService.ts";
import { BETA_TESTER_KEY_PREFIX, UpstashBetaTesterStore } from "./betaTester.ts";
import { LiveActivityTicker, readTickerConfig } from "./liveActivityTicker.ts";
import { UpstashCaptureJournal } from "./captureJournal.ts";
import { UpstashFieldValidationStore } from "./fieldValidation.ts";
import { resolveOperatorToken } from "./operatorAuth.ts";
import { resolveTagoServiceKey, serviceKeyWarning } from "./serviceKey.ts";
import { TagoTransitProvider } from "./tagoProvider.ts";
import { backgroundAcceptanceVerdict, createWebPushSender } from "./webPush.ts";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST?.trim() || "0.0.0.0";

const credential = resolveTagoServiceKey(process.env);
const operator = resolveOperatorToken(process.env);
const warning = serviceKeyWarning(credential);
if (warning) console.warn(JSON.stringify({ level: "warn", event: "transit_credential_name", message: warning }));
if (operator.problem) console.warn(JSON.stringify({ level: "warn", event: "ride_capture_operator_token", message: operator.problem }));

const provider = new TagoTransitProvider({ serviceKey: credential.key });

// Durable field-validation submissions need Upstash. Without both variables the
// submit endpoint answers 503 and the finish screen falls back to manual export;
// nothing pretends a ride was stored.
const upstash = readUpstashCredentials(process.env);
const fieldValidationStore = upstash ? new UpstashFieldValidationStore(upstash) : undefined;
// Beta testing is opted into explicitly. Upstash being configured is not consent.
const betaMode = resolveBetaTesterMode(process.env, Boolean(upstash));
if (betaMode.problem) console.warn(JSON.stringify({ level: "warn", event: "beta_testers_config", message: betaMode.problem }));
// Read-only lookup, kept even with beta disabled, so an existing beta ride can
// never be submitted into v1 by an operator.
const betaStore = upstash ? new UpstashBetaTesterStore(upstash) : undefined;
const journal = betaMode.mode === "enabled" && upstash ? new UpstashCaptureJournal(upstash, BETA_TESTER_KEY_PREFIX) : undefined;
const push = createWebPushSender(process.env);
// Bound after construction: the beta service needs the coordinator, and the
// coordinator reports completions to the beta service.
let beta: BetaService | undefined;
const captures = new BackgroundRideCaptureCoordinator(provider, {
  ...(journal ? { journal } : {}),
  onComplete: async ({ mode, report, pushSubscription, sessionId }) => {
    if (mode === "field") {
      // Beta rides submit themselves when they complete; operator rides are ignored.
      await beta?.onCaptureComplete(sessionId);
      return;
    }
    if (mode !== "background_acceptance") return;
    const verdict = backgroundAcceptanceVerdict(report);
    try {
      await push.sendAcceptanceResult(pushSubscription, report, verdict);
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "ride_capture_acceptance_completed",
        sessionId,
        verdict,
        pushAttempted: Boolean(pushSubscription && push.config.configured),
      }));
    } catch (error) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "ride_capture_push_failed",
        sessionId,
        verdict,
        message: error instanceof Error ? error.message.slice(0, 240) : "push failed",
      }));
    }
  },
});
const allowedOrigins = originList(process.env.TRANSIT_ALLOWED_ORIGINS);
// The Live Activity scheduler's clock (milestone 5). Off unless configured.
const tickerConfig = readTickerConfig(process.env);
if (!tickerConfig.enabled && tickerConfig.problem) console.warn(JSON.stringify({ level: "warn", event: "live_activity_ticker_config", message: tickerConfig.problem }));
const ticker = new LiveActivityTicker(tickerConfig);

// Beta testers need the same database: their rides are stored exactly like
// operator submissions, and their invites and ride journals live beside them
// in their own namespace.
beta = betaMode.mode === "enabled" && betaStore && fieldValidationStore
  ? new BetaService({ store: betaStore, fieldValidation: fieldValidationStore, captures, provider, ...(journal ? { journal } : {}) })
  : undefined;

export const backgroundServer = createServer(createBackgroundRequestHandler({
  captures,
  operator,
  allowedOrigins,
  ...(fieldValidationStore ? { fieldValidation: { store: fieldValidationStore } } : {}),
  ...(beta ? { beta } : {}),
  betaMode: beta ? "enabled" : betaMode.mode === "enabled" ? "unconfigured" : betaMode.mode,
  ...(betaStore ? { isBetaCapture: async (id: string) => Boolean(await betaStore.getCapture(id)) } : {}),
  health: () => ({
    ok: true,
    service: "tapso-ride-collector",
    liveTransitConfigured: credential.source !== "missing",
    operatorEnabled: operator.configured,
    webPushConfigured: push.config.configured,
    ...(push.config.publicKey ? { webPushPublicKey: push.config.publicKey } : {}),
    stateStore: "process_memory",
    processRestartLosesActiveCapture: true,
    providerObservationTimestamp: "unavailable",
    fieldValidationStorage: fieldValidationStore ? "upstash" : "unconfigured",
    betaTesters: beta ? "enabled" : betaMode.mode === "enabled" ? "unconfigured" : betaMode.mode,
    betaRestartRecovery: beta && journal ? "durable_journal" : "not_applicable",
    liveActivityTicker: ticker.status(),
  }),
}));

if (process.env.NODE_ENV !== "test") {
  backgroundServer.listen(port, host, () => {
    console.info(`TAPSO ride collector listening on http://${host}:${port}`);
  });
  ticker.start();
  if (beta) {
    // Pick up beta rides a previous process was collecting, now and while a
    // redeploy overlap may still hold their leases.
    const recover = () => void beta!.recoverAll().then((result) => {
      if (result.restored || result.closed) {
        console.info(JSON.stringify({ event: "beta_recovery", ...result }));
      }
    });
    recover();
    setInterval(recover, 15_000).unref();
  }
}

function originList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const result: string[] = [];
  for (const part of value.split(",")) {
    try {
      const origin = new URL(part.trim()).origin;
      if (!result.includes(origin)) result.push(origin);
    } catch {
      // Fail closed for malformed entries. The health endpoint stays available
      // so the operator can diagnose the deployment without opening CORS.
    }
  }
  return result;
}

import { createServer } from "node:http";

import { createBackgroundRequestHandler } from "./backgroundHttp.ts";
import { BackgroundRideCaptureCoordinator } from "./backgroundRideCapture.ts";
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
const push = createWebPushSender(process.env);
const captures = new BackgroundRideCaptureCoordinator(provider, {
  onComplete: async ({ mode, report, pushSubscription, sessionId }) => {
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

export const backgroundServer = createServer(createBackgroundRequestHandler({
  captures,
  operator,
  allowedOrigins,
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
  }),
}));

if (process.env.NODE_ENV !== "test") {
  backgroundServer.listen(port, host, () => {
    console.info(`TAPSO ride collector listening on http://${host}:${port}`);
  });
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

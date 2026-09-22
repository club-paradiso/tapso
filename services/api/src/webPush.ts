import webpush from "web-push";

import type { RideCaptureReport } from "./rideCapture.ts";
import type { WebPushSubscriptionInput } from "./backgroundRideCapture.ts";

export interface WebPushConfig {
  configured: boolean;
  publicKey?: string;
  subject?: string;
}

type Sender = {
  config: WebPushConfig;
  sendAcceptanceResult(
    subscription: WebPushSubscriptionInput | undefined,
    report: RideCaptureReport,
    verdict: "PASS" | "FAIL",
  ): Promise<void>;
};

export function createWebPushSender(env: NodeJS.ProcessEnv): Sender {
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const subject = String(env.WEB_PUSH_VAPID_SUBJECT ?? "https://tapso-api.vercel.app").trim();
  const configured = Boolean(publicKey && privateKey && /^https?:\/\//.test(subject));

  if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);

  return {
    config: {
      configured,
      ...(configured ? { publicKey, subject } : {}),
    },
    async sendAcceptanceResult(subscription, report, verdict) {
      if (!configured || !subscription) return;
      const payload = JSON.stringify({
        type: "tapso-background-acceptance",
        title: verdict === "PASS" ? "TAPSO 백그라운드 검증 완료 ✅" : "TAPSO 백그라운드 검증 확인 필요 ⚠️",
        body: verdict === "PASS"
          ? "필요한 백그라운드 수집 증거를 확보했습니다. 아직 버스에 타고 있어도 정상입니다."
          : "백그라운드 수집 검증이 기준을 충족하지 못했습니다. TAPSO에서 리포트를 확인하세요.",
        verdict,
        routeId: report.routeId,
        startedAt: report.startedAt,
        url: "./acceptance.html",
      });
      try {
        await webpush.sendNotification(subscription, payload, {
          TTL: 15 * 60,
          urgency: "high",
        });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : undefined;
        if (statusCode === 404 || statusCode === 410) return;
        throw error;
      }
    },
  };
}

export function backgroundAcceptanceVerdict(report: RideCaptureReport): "PASS" | "FAIL" {
  const configured = report.configuredIntervalSeconds;
  const maxGap = report.collectionIntervalSeconds.max;
  if (report.captureEngine !== "railway-background") return "FAIL";
  if (report.lifecycle.hiddenPeriods < 1 || report.lifecycle.hiddenSeconds < 60) return "FAIL";
  if (report.snapshotCount < 20) return "FAIL";
  if (maxGap === undefined || maxGap > configured * 3) return "FAIL";
  return "PASS";
}

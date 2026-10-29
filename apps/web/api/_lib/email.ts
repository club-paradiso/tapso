/**
 * Transactional confirmation email.
 *
 * One message, sent because the visitor asked to be told when TAPSO is ready.
 * This is not a marketing list and this module must never grow into one.
 */

import type { EmailConfig } from "./env.ts";
import type { RiderType } from "./contract.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 8000;

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailResult = { delivered: true } | { delivered: false; reason: string };

export type EmailTransport = {
  send(message: OutgoingEmail): Promise<EmailResult>;
};

const RIDER_LABELS: Record<RiderType, string> = {
  resident: "제주 도민",
  visitor: "제주 여행객",
  enthusiast: "제주 버스 애호가",
  supporter: "그 외 지역에서 응원 중",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Deliberately plain. The message states what TAPSO will send and what it will
 * not, and it does not promise a launch date the project cannot commit to.
 */
export function buildConfirmationEmail(to: string, riderType: RiderType): OutgoingEmail {
  const label = RIDER_LABELS[riderType];
  const lines = [
    "TAPSO 첫 탑승 소식 명단에 등록됐수다.",
    "",
    `이용 유형: ${label}`,
    "",
    "TestFlight나 중요한 출시 소식이 준비되면 이 주소로 알려드릴게요.",
    "그 외의 광고 메일은 보내지 않습니다.",
    "",
    "지금은 합성 교통 데이터로 흐름을 검증하는 단계예요.",
    "",
    "등록을 취소하거나 저장된 정보를 삭제하고 싶으면 이 메일에 그대로 답장해주세요.",
    "",
    "— TAPSO 탑서",
  ];

  const html = `<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:24px;background:#f3f5f4;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;color:#0f171a;">
    <div style="max-width:520px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e1e6e4;border-radius:24px;">
      <p style="margin:0 0 12px;font-size:34px;line-height:51px;">🍊</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:29px;font-weight:700;">TAPSO 첫 탑승 소식 명단에 등록됐수다.</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:21px;color:#56636a;">
        이용 유형: <strong style="color:#0f171a;">${escapeHtml(label)}</strong>
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:21px;color:#56636a;">
        TestFlight나 중요한 출시 소식이 준비되면 이 주소로 알려드릴게요. 그 외의 광고 메일은 보내지 않습니다.
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:21px;color:#56636a;">
        지금은 합성 교통 데이터로 흐름을 검증하는 단계예요.
      </p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e1e6e4;font-size:12px;line-height:18px;color:#56636a;">
        등록을 취소하거나 저장된 정보를 삭제하고 싶으면 이 메일에 그대로 답장해주세요.
      </p>
    </div>
  </body>
</html>`;

  return {
    to,
    subject: "🍊 TAPSO 사전예약이 완료됐어요",
    text: lines.join("\n"),
    html,
  };
}

export function createResendTransport(
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): EmailTransport {
  return {
    async send(message) {
      try {
        const response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.ok) return { delivered: true };
        // The provider's message stays here; the browser only learns "deferred".
        return { delivered: false, reason: `resend_http_${response.status}` };
      } catch (error) {
        return {
          delivered: false,
          reason: error instanceof Error ? error.message.slice(0, 200) : "resend_request_failed",
        };
      }
    },
  };
}

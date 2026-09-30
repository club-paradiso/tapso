import type { WaitlistResponse } from "../../api/_lib/contract.ts";

/**
 * What the form says after the server answers.
 *
 * Kept apart from the component so the honesty rule is testable: only
 * `created` may read as a registration, and `unavailable` — no database
 * provisioned, or the request never arrived — must say plainly that nothing was
 * stored.
 */

export type WaitlistOutcome =
  | { kind: "success"; emailSent: boolean }
  | { kind: "duplicate" }
  | { kind: "invalid"; field?: "email" | "riderType" | "privacyConsent" | "body" }
  | { kind: "error"; message: string };

export const UNAVAILABLE_MESSAGE =
  "지금은 사전예약을 받을 수 없어요. 입력한 내용은 저장되지 않았어요. 잠시 후 다시 시도해주세요.";
export const GENERIC_ERROR_MESSAGE = "지금은 신청을 저장하지 못했어요. 잠시 후 다시 시도해주세요.";

export function waitlistOutcome(response: WaitlistResponse): WaitlistOutcome {
  switch (response.status) {
    case "created":
      return { kind: "success", emailSent: response.emailDelivery === "sent" };
    case "already_registered":
      return { kind: "duplicate" };
    case "invalid_request":
      return { kind: "invalid", ...(response.field ? { field: response.field } : {}) };
    case "rate_limited":
      return {
        kind: "error",
        message: `요청이 너무 잦아요. ${response.retryAfterSeconds}초 뒤에 다시 시도해주세요.`,
      };
    case "unavailable":
      return { kind: "error", message: UNAVAILABLE_MESSAGE };
    default:
      return { kind: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

import type { SupportConfigResponse } from "../../api/_lib/contract.ts";

/**
 * The support section's status line, derived from the server's answer.
 *
 * `undefined` means the page has not asked yet. Until the server says `live`,
 * the section must not read as if money can be sent; the same fail-closed rule
 * `fetchSupportConfig` applies to the dialog.
 */
export type SupportStatus = {
  open: boolean;
  label: string;
  detail: string;
  action: string;
};

export function supportStatus(config: SupportConfigResponse | undefined): SupportStatus {
  if (config?.mode === "live") {
    return {
      open: true,
      label: "후원 가능",
      detail: "후원은 카드 결제로 받아요. 카드 정보는 결제사에만 남고 탑서는 저장하지 않아요.",
      action: "후원하기",
    };
  }
  return {
    open: false,
    label: config ? "결제 준비 중" : "결제 상태 확인 중",
    detail:
      "아직 Toss Payments 상점 연결이 끝나지 않았어요. 연결 전에는 결제를 받지 않습니다.",
    action: "후원 안내 보기",
  };
}

import {
  WAITLIST_ENDPOINT,
  type RiderType,
  type WaitlistResponse,
} from "../../api/_lib/contract.ts";

export type { RiderType, WaitlistResponse };

/** Korean labels live here; the wire and the database use the stable codes. */
export const RIDER_TYPE_LABELS: ReadonlyArray<{ value: RiderType; label: string }> = [
  { value: "resident", label: "제주도민" },
  { value: "visitor", label: "제주 여행객" },
  { value: "enthusiast", label: "제주 버스 애호가" },
  { value: "supporter", label: "그 외 지역에서 응원 중" },
];

export type SubmitWaitlistInput = {
  email: string;
  riderType: RiderType;
  privacyConsent: true;
  formRenderedAt: number;
  company: string;
  signal?: AbortSignal;
};

/**
 * Any transport failure becomes `unavailable`, never a fabricated success. The
 * visitor must be able to trust that "등록됐수다" means a row exists.
 */
export async function submitWaitlist(input: SubmitWaitlistInput): Promise<WaitlistResponse> {
  let response: Response;
  try {
    response = await fetch(WAITLIST_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        riderType: input.riderType,
        privacyConsent: input.privacyConsent,
        formRenderedAt: input.formRenderedAt,
        company: input.company,
      }),
      signal: input.signal,
    });
  } catch {
    return { status: "unavailable" };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return { status: response.ok ? "internal_error" : "unavailable" };
  }

  if (!body || typeof body !== "object" || typeof (body as WaitlistResponse).status !== "string") {
    return { status: "internal_error" };
  }
  return body as WaitlistResponse;
}

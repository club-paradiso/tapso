/** Public deep-link syntax checks. Validation does not prove account ownership. */
/** Only accept KakaoPay's own HTTPS receive domains, not arbitrary redirects. */
export function kakaoReceiveUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "qr.kakaopay.com" || url.hostname === "link.kakaopay.com")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function tossSendUrl(value: string): string {
  // The user-provided QR currently encodes a Toss transfer to Jeju Bank.
  // Do not pass arbitrary custom schemes or pretend this is a KakaoPay URL.
  try {
    const url = new URL(value);
    return url.protocol === "supertoss:" &&
      url.hostname === "send" &&
      url.searchParams.get("bank") !== null &&
      url.searchParams.get("accountNo") !== null
      ? value
      : "";
  } catch {
    return "";
  }
}


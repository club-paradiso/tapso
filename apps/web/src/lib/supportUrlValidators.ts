/**
 * Validate the public Toss send URL before exposing it to visitors.
 * This is a user-provided QR deep link, not an official public web SDK.
 * Keep the recipient tied to the same account displayed on the support page.
 */
export function tossSendUrl(
  value: string,
  recipient: { name: string; account: string },
): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "supertoss:" ||
      url.hostname !== "send" ||
      url.pathname !== "" ||
      !recipient.name ||
      !recipient.account ||
      url.searchParams.get("bank") !== recipient.name ||
      url.searchParams.get("accountNo") !== recipient.account ||
      // Do not pre-fill a nonzero amount: supporters choose and confirm it in Toss.
      (url.searchParams.has("amount") && url.searchParams.get("amount") !== "0")
    ) {
      return "";
    }
    return value;
  } catch {
    return "";
  }
}

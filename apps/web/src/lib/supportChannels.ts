/**
 * Public support destinations.
 *
 * VITE_ values are intentionally client-safe because the support hub renders
 * them in the browser. Never place secrets here. An empty field hides that
 * support method.
 */
export const SUPPORT_CHANNELS = {
  buyMeACoffeeUrl: (import.meta.env.VITE_BUY_ME_A_COFFEE_URL ?? "").trim(),
  bank: {
    name: (import.meta.env.VITE_SUPPORT_BANK_NAME ?? "").trim(),
    account: (import.meta.env.VITE_SUPPORT_BANK_ACCOUNT ?? "").trim(),
    holder: (import.meta.env.VITE_SUPPORT_BANK_HOLDER ?? "").trim(),
  },
} as const;

export const SUPPORT_CHANNEL_AVAILABILITY = {
  buyMeACoffee: SUPPORT_CHANNELS.buyMeACoffeeUrl.length > 0,
  bankTransfer:
    SUPPORT_CHANNELS.bank.name.length > 0 &&
    SUPPORT_CHANNELS.bank.account.length > 0 &&
    SUPPORT_CHANNELS.bank.holder.length > 0,
} as const;

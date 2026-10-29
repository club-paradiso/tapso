/**
 * Public, visitor-visible support routes. Never store secret credentials here.
 * Toss uses the sender's own app and the 제주은행 recipient from the
 * user-provided QR. An empty route remains hidden rather than faking payment.
 */
import { tossSendUrl } from "./supportUrlValidators.ts";

const publicValue = (value: string | undefined): string => (value ?? "").trim();

const bank = {
  name: publicValue(import.meta.env.VITE_SUPPORT_BANK_NAME),
  account: publicValue(import.meta.env.VITE_SUPPORT_BANK_ACCOUNT),
  holder: publicValue(import.meta.env.VITE_SUPPORT_BANK_HOLDER),
};

export const SUPPORT_CHANNELS = {
  buyMeACoffeeUrl: publicValue(import.meta.env.VITE_BUY_ME_A_COFFEE_URL),
  bank,
  tossSendUrl: tossSendUrl(publicValue(import.meta.env.VITE_SUPPORT_TOSS_SEND_URL), bank),
} as const;

export const SUPPORT_CHANNEL_AVAILABILITY = {
  buyMeACoffee: SUPPORT_CHANNELS.buyMeACoffeeUrl.length > 0,
  bankTransfer: bank.name.length > 0 && bank.account.length > 0,
  tossTransfer: SUPPORT_CHANNELS.tossSendUrl.length > 0,
} as const;

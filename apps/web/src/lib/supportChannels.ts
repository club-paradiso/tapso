/**
 * Public, visitor-visible support routes. Never store secret credentials here.
 *
 * A Toss QR/link points at the bank account that the owner chose. A KakaoPay
 * receive link is *not* interchangeable with it: the owner must provide a
 * separate, real KakaoPay receive link before direct KakaoPay opens.
 */
import { kakaoReceiveUrl, tossSendUrl } from "./supportUrlValidators.ts";

const publicUrl = (value: string | undefined): string => (value ?? "").trim();

export const SUPPORT_CHANNELS = {
  buyMeACoffeeUrl: publicUrl(import.meta.env.VITE_BUY_ME_A_COFFEE_URL),
  tossSendUrl: tossSendUrl(publicUrl(import.meta.env.VITE_SUPPORT_TOSS_SEND_URL)),
  kakaoPayUrl: kakaoReceiveUrl(publicUrl(import.meta.env.VITE_SUPPORT_KAKAOPAY_URL)),
  bank: {
    name: publicUrl(import.meta.env.VITE_SUPPORT_BANK_NAME),
    account: publicUrl(import.meta.env.VITE_SUPPORT_BANK_ACCOUNT),
    holder: publicUrl(import.meta.env.VITE_SUPPORT_BANK_HOLDER),
  },
} as const;

export const SUPPORT_CHANNEL_AVAILABILITY = {
  buyMeACoffee: SUPPORT_CHANNELS.buyMeACoffeeUrl.length > 0,
  // Account ownership is displayed by the sender's bank app at transfer time.
  // A named public holder is optional because privacy may be a concern.
  bankTransfer:
    SUPPORT_CHANNELS.bank.name.length > 0 &&
    SUPPORT_CHANNELS.bank.account.length > 0,
  tossTransfer: SUPPORT_CHANNELS.tossSendUrl.length > 0,
  kakaoPay: SUPPORT_CHANNELS.kakaoPayUrl.length > 0,
} as const;

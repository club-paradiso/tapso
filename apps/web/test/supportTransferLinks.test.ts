import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tossSendUrl } from "../src/lib/supportUrlValidators.ts";

const bank = { name: "제주은행", account: "1234567890" };
const valid = "supertoss://send?amount=0&bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89&accountNo=1234567890&origin=qr";

test("Toss deep link opens the configured recipient and lets the sender choose the amount", () => {
  assert.equal(tossSendUrl(valid, bank), valid);
  assert.equal(new URL(tossSendUrl(valid, bank)).hostname, "send");
  assert.equal(new URL(valid).searchParams.get("amount"), "0");
});

test("Toss deep link fails closed for a different recipient, forced amount, or unsafe scheme", () => {
  for (const bad of [
    "https://example.org/send?bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89&accountNo=1234567890",
    "supertoss://other?amount=0&bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89&accountNo=1234567890",
    "supertoss://send?amount=500000&bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89&accountNo=1234567890",
    "supertoss://send?amount=0&bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89&accountNo=9999999999",
    "supertoss://send?amount=0&bank=Other&accountNo=1234567890",
    "supertoss://send?amount=0&bank=%EC%A0%9C%EC%A3%BC%EC%9D%80%ED%96%89",
    "",
  ]) {
    assert.equal(tossSendUrl(bad, bank), "", bad);
  }
  assert.equal(tossSendUrl(valid, { name: "제주은행", account: "" }), "");
});

test("one-tap Toss is the primary domestic action; QR and bank copy remain fallback", () => {
  const dialog = readFileSync(new URL("../src/components/SupportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /href=\{SUPPORT_CHANNELS\.tossSendUrl\}/);
  assert.match(dialog, /토스 앱에서 바로 송금하기/);
  assert.doesNotMatch(dialog, /토스가 설치된 휴대폰에서 누르면 송금 화면 열기를 시도해요/);
  assert.doesNotMatch(dialog, /실제 송금은 토스 앱에서 계좌와 금액을 확인한 뒤 완료합니다/);
  assert.doesNotMatch(dialog, /toss-help/);
  assert.match(dialog, /writeText\(SUPPORT_CHANNELS\.bank\.account\)/);
  assert.ok(dialog.indexOf("토스 앱에서 바로 송금하기") < dialog.indexOf("support-transfer-qr"));
  assert.match(dialog, /계좌이체로 응원하기/);
  assert.match(dialog, /커피 한 잔 값으로 응원하기/);
  assert.doesNotMatch(dialog, /제주에서 만드는 TAPSO · KRW/);
  assert.doesNotMatch(dialog, /kakaopay|카카오페이/i);
});

test("there is no remaining KakaoPay transfer route in client configuration or page", () => {
  for (const file of [
    "../src/lib/supportChannels.ts",
    "../src/lib/supportUrlValidators.ts",
    "../src/sections/Support.tsx",
    "../src/styles/forms.css",
    "../.env.example",
  ]) {
    const contents = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(contents, /kakaopay|카카오페이/i, file);
  }
});

test("published Toss QR asset still includes the white quiet zone", () => {
  const qr = readFileSync(new URL("../public/media/jeju-bank-toss-support-qr.svg", import.meta.url), "utf8");
  assert.match(qr, /viewBox="0 0 49 49"/);
  assert.match(qr, /<rect width="49" height="49" fill="#ffffff"/);
  assert.match(qr, /<path fill="#111719" d="M/);
  assert.ok(qr.length > 4000);
});

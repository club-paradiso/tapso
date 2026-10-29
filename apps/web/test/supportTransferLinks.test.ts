import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kakaoReceiveUrl, tossSendUrl } from "../src/lib/supportUrlValidators.ts";

test("KakaoPay button only accepts actual HTTPS receive URLs", () => {
  assert.equal(kakaoReceiveUrl("https://qr.kakaopay.com/abc"), "https://qr.kakaopay.com/abc");
  assert.equal(kakaoReceiveUrl("https://link.kakaopay.com/_/abc"), "https://link.kakaopay.com/_/abc");
  for (const invalid of [
    "https://qr.kakaopay.com.evil.test/foo",
    "http://qr.kakaopay.com/abc",
    "javascript:alert(1)",
    "https://example.com/transfer",
    "",
  ]) {
    assert.equal(kakaoReceiveUrl(invalid), "", invalid);
  }
});

test("Toss link needs the sender-specific bank transfer data", () => {
  const valid = "supertoss://send?amount=0&bank=Jeju&accountNo=123&origin=qr";
  assert.equal(tossSendUrl(valid), valid);
  for (const invalid of [
    "https://somewhere.example/send?bank=Jeju&accountNo=123",
    "supertoss://send?bank=Jeju",
    "supertoss://send?accountNo=123",
    "supertoss://other?bank=Jeju&accountNo=123",
    "",
  ]) {
    assert.equal(tossSendUrl(invalid), "", invalid);
  }
});

test("KakaoPay fallback copies the real account and explains bank transfer, not a fake direct link", () => {
  const dialog = readFileSync(new URL("../src/components/SupportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /SUPPORT_CHANNEL_AVAILABILITY\.kakaoPay\s*\?/);
  assert.match(dialog, /카카오페이 송금용 계좌번호 복사/);
  assert.match(dialog, /copyBankAccount\("kakao"\)/);
  assert.match(dialog, /writeText\(SUPPORT_CHANNELS\.bank\.account\)/);
  assert.match(dialog, /카카오페이에서 붙여넣기/);
  assert.match(dialog, /위에 표시된 계좌번호를 직접 복사해주세요/);
  assert.match(dialog, /일반 웹페이지에서는 자동으로 송금 화면을 열 수 없어요/);
  assert.doesNotMatch(dialog, /kakaopay:\/\/money\/to\/bank/);
  assert.match(dialog, /토스로 송금하기/);
  assert.match(dialog, /커피 한 잔으로 응원하기/);
  assert.doesNotMatch(dialog, /카드 · 해외 결제/);
});

test("KakaoPay handoff and ordinary bank copy report success independently", () => {
  const dialog = readFileSync(new URL("../src/components/SupportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /type CopyTarget = "bank" \| "kakao"/);
  assert.match(dialog, /copyResults\.kakao === "copied"/);
  assert.match(dialog, /copyResults\.bank === "copied"/);
  assert.match(dialog, /copyResults\.kakao === "failed"/);
  assert.match(dialog, /copyResults\.bank === "failed"/);
});

test("published QR asset is an SVG with quiet zone and actual modules", () => {
  const qr = readFileSync(new URL("../public/media/jeju-bank-toss-support-qr.svg", import.meta.url), "utf8");
  assert.match(qr, /viewBox="0 0 49 49"/);
  assert.match(qr, /<rect width="49" height="49" fill="#ffffff"/);
  assert.match(qr, /<path fill="#111719" d="M/);
  assert.ok(qr.length > 4000);
});

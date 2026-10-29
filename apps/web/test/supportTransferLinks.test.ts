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

test("support screen never claims an unconfigured KakaoPay link works", () => {
  const dialog = readFileSync(new URL("../src/components/SupportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /SUPPORT_CHANNEL_AVAILABILITY\.kakaoPay\s*\?/);
  assert.match(dialog, /카카오페이 전용 송금 링크는 아직 연결되지 않았어요/);
  assert.match(dialog, /카카오페이 계좌송금용 번호 복사/);
  assert.match(dialog, /토스로 송금하기/);
  assert.match(dialog, /커피 한 잔으로 응원하기/);
  assert.doesNotMatch(dialog, /카드 · 해외 결제/);
});

test("published QR asset is an SVG with quiet zone and actual modules", () => {
  const qr = readFileSync(new URL("../public/media/jeju-bank-toss-support-qr.svg", import.meta.url), "utf8");
  assert.match(qr, /viewBox="0 0 49 49"/);
  assert.match(qr, /<rect width="49" height="49" fill="#ffffff"/);
  assert.match(qr, /<path fill="#111719" d="M/);
  assert.ok(qr.length > 4000);
});

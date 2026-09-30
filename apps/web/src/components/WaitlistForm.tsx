import { useId, useRef, useState, type FormEvent } from "react";
import {
  RIDER_TYPE_LABELS,
  submitWaitlist,
  type RiderType,
} from "../lib/waitlistClient";
import { waitlistOutcome } from "../lib/waitlistMessages.ts";

/**
 * The production waitlist form.
 *
 * Submitting used to build a `mailto:` URL and ask the visitor to send the mail
 * themselves; nothing was stored. It now posts to `/api/waitlist`, which
 * persists the registration and sends the confirmation.
 */

type WaitlistState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; emailSent: boolean }
  | { status: "duplicate" }
  | { status: "error"; message: string };

export default function WaitlistForm() {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [riderType, setRiderType] = useState<RiderType>("resident");
  const [consent, setConsent] = useState(false);
  const [company, setCompany] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [consentError, setConsentError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<WaitlistState>({ status: "idle" });

  // Set once per mount. The server compares it against arrival time, which
  // costs a real visitor nothing and makes an instant scripted post cheap to
  // reject.
  const formRenderedAt = useRef(Date.now()).current;
  const submitting = state.status === "submitting";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const trimmed = email.trim();
    let blocked = false;
    if (!trimmed || !trimmed.includes("@")) {
      setEmailError("메일 주소를 다시 확인해주세요.");
      blocked = true;
    } else {
      setEmailError(undefined);
    }
    if (!consent) {
      setConsentError("사전예약을 하려면 동의가 필요해요.");
      blocked = true;
    } else {
      setConsentError(undefined);
    }
    if (blocked) return;

    setState({ status: "submitting" });
    const result = await submitWaitlist({
      email: trimmed,
      riderType,
      privacyConsent: true,
      formRenderedAt,
      company,
    });

    const outcome = waitlistOutcome(result);
    switch (outcome.kind) {
      case "success":
        setState({ status: "success", emailSent: outcome.emailSent });
        return;
      case "duplicate":
        setState({ status: "duplicate" });
        return;
      case "invalid":
        // The typed address stays in the field so it can simply be corrected.
        if (outcome.field === "email") setEmailError("메일 주소를 다시 확인해주세요.");
        if (outcome.field === "privacyConsent") setConsentError("사전예약을 하려면 동의가 필요해요.");
        setState({ status: "idle" });
        return;
      case "error":
        setState({ status: "error", message: outcome.message });
    }
  };

  if (state.status === "success") {
    return (
      <div className="waitlist-form-card" data-figma-node-id="9:51">
        <div className="waitlist-result waitlist-result-success" data-figma-node-id="9:64">
          <p className="waitlist-result-mark" aria-hidden="true">
            🍊
          </p>
          <strong role="status">첫 탑승 명단에 올라갔어요.</strong>
          <p>
            {state.emailSent
              ? "확인 메일을 보냈어요. TestFlight가 준비되면 이 주소로 먼저 알려드릴게요."
              : "신청은 저장됐어요. 확인 메일이 조금 늦을 수 있지만 소식은 이 주소로 꼭 보내드릴게요."}
          </p>
          <a className="figma-support" href="#support">
            탑서를 응원하는 다른 방법
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="waitlist-form-card" data-figma-node-id="9:51">
      <form onSubmit={submit} aria-labelledby={`${formId}-title`} noValidate>
        <h3 id={`${formId}-title`} data-figma-node-id="9:52">
          TestFlight 소식 받기
        </h3>

        <label className="figma-field" htmlFor={`${formId}-email`} data-figma-node-id="9:53">
          <span>이메일</span>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="hello@example.com"
            required
            maxLength={254}
            disabled={submitting}
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${formId}-email-error` : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(undefined);
            }}
          />
          {emailError ? (
            <span className="field-error" id={`${formId}-email-error`}>
              <span aria-hidden="true">⚠ </span>
              {emailError}
            </span>
          ) : null}
        </label>

        <label
          className="figma-field rider-type-field"
          htmlFor={`${formId}-type`}
          data-figma-node-id="9:57"
        >
          <span>나는</span>
          <select
            id={`${formId}-type`}
            name="riderType"
            disabled={submitting}
            value={riderType}
            onChange={(event) => setRiderType(event.target.value as RiderType)}
          >
            {RIDER_TYPE_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Honeypot. Hidden from sight and from assistive technology alike. */}
        <div className="waitlist-honeypot" aria-hidden="true">
          <label htmlFor={`${formId}-company`}>회사</label>
          <input
            id={`${formId}-company`}
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>

        <label className="waitlist-consent" htmlFor={`${formId}-consent`}>
          <input
            id={`${formId}-consent`}
            type="checkbox"
            required
            disabled={submitting}
            checked={consent}
            aria-invalid={consentError ? true : undefined}
            aria-describedby={consentError ? `${formId}-consent-error` : undefined}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (consentError) setConsentError(undefined);
            }}
          />
          <span>
            출시 소식을 받기 위해 <strong>이메일과 이용 유형</strong> 수집에 동의합니다.
            <span className="waitlist-consent-required"> (필수)</span>
          </span>
        </label>
        {consentError ? (
          <span className="field-error" id={`${formId}-consent-error`}>
            <span aria-hidden="true">⚠ </span>
            {consentError}
          </span>
        ) : null}

        <div className="cta-row" data-figma-node-id="27:34">
          <button
            className="figma-submit"
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            data-figma-node-id="9:61"
          >
            {submitting ? "보내는 중…" : "TestFlight 사전예약"}
            {submitting ? null : <span aria-hidden="true">→</span>}
          </button>
        </div>

        <div className="waitlist-live" role="status" aria-live="polite">
          {state.status === "duplicate" ? (
            <p className="waitlist-result waitlist-result-known">
              이미 첫 탑승 소식을 신청한 이메일이에요. 준비되면 알려드리쿠다.
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="waitlist-result waitlist-result-error">{state.message}</p>
          ) : null}
        </div>

        <p className="waitlist-privacy" data-figma-node-id="10:68">
          출시 소식 안내에만 쓰고 광고는 보내지 않아요. 안내가 끝나거나 요청하시면 지웁니다 — 확인
          메일에 답장해주세요.
        </p>
      </form>
    </div>
  );
}

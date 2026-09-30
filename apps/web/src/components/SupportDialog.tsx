import { useEffect, useId, useRef, useState } from "react";
import {
  createSupportIntent,
  fetchSupportConfig,
  formatKrw,
  type SupportConfigResponse,
} from "../lib/supportClient";

/**
 * The `후원하기` sheet.
 *
 * Built on a native `<dialog>` so focus trapping, Escape, the backdrop, and
 * focus restoration are the browser's job rather than a hand-rolled
 * approximation.
 *
 * WORDING: `후원` is the product word. TAPSO makes no claim to be a charity or
 * a non-profit and promises no receipt or tax deduction, because no such
 * structure has been established.
 */

type DialogState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "confirming_million" }
  | { status: "starting" }
  | { status: "error"; message: string };

const CUSTOM = "custom";
const MILLION_SUPPORT_AMOUNT = 1_000_000;

export default function SupportDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const customFieldId = useId();

  const [config, setConfig] = useState<SupportConfigResponse | undefined>(undefined);
  const [state, setState] = useState<DialogState>({ status: "loading" });
  const [selected, setSelected] = useState<number | typeof CUSTOM | undefined>(undefined);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupportConfig(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setConfig(result);
      setSelected(result.presetAmounts[1] ?? result.presetAmounts[0]);
      setState({ status: "ready" });
    });
    return () => controller.abort();
  }, []);

  const live = config?.mode === "live";
  const amount =
    selected === CUSTOM ? Number.parseInt(customAmount.replace(/[^0-9]/g, ""), 10) : selected;
  const amountValid =
    config !== undefined &&
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= config.minAmount &&
    amount <= config.maxAmount;

  const beginCheckout = async (checkoutAmount: number) => {
    setState({ status: "starting" });

    const intent = await createSupportIntent(checkoutAmount);
    if (intent.status !== "created") {
      setState({
        status: "error",
        message:
          intent.status === "rate_limited"
            ? "요청이 너무 잦아요. 잠시 후 다시 시도해주세요."
            : "지금은 결제를 시작하지 못했어요. 잠시 후 다시 시도해주세요.",
      });
      return;
    }

    try {
      const { startSupportCheckout } = await import("../lib/supportCheckout");
      await startSupportCheckout({
        clientKey: intent.clientKey,
        orderId: intent.orderId,
        amount: intent.amount,
        currency: intent.currency,
      });
      // Reached only when the payment window closed without navigating away.
      setState({ status: "ready" });
    } catch {
      setState({
        status: "error",
        message: "결제 창을 열지 못했어요. 결제는 시작되지 않았습니다.",
      });
    }
  };

  const start = () => {
    if (!config || !amountValid || typeof amount !== "number") return;
    if (amount === MILLION_SUPPORT_AMOUNT) {
      setState({ status: "confirming_million" });
      return;
    }
    void beginCheckout(amount);
  };

  return (
    <dialog
      className="support-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // The dialog element itself is the backdrop area.
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="support-dialog-body">
        <div className="support-dialog-header">
          <h2 id={titleId}>탑서 개발에 힘을 보태주세요 🍊</h2>
          <button
            type="button"
            className="support-dialog-close"
            onClick={() => dialogRef.current?.close()}
          >
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">닫기</span>
          </button>
        </div>

        <p className="support-dialog-intro">
          후원금은 서버비, 실제 기기 테스트, 출시 준비에 씁니다. 후원하지 않아도 탑서는 그대로 쓸 수 있어요.
        </p>

        {state.status === "loading" ? (
          <p className="support-dialog-note" role="status">
            후원 방법을 확인하는 중이에요…
          </p>
        ) : null}

        {config && state.status !== "loading" ? (
          <>
            <fieldset
              className="support-amounts"
              disabled={!live || state.status === "starting" || state.status === "confirming_million"}
            >
              <legend>후원 금액</legend>
              {config.presetAmounts.map((preset) => (
                <label
                  className={`support-amount${preset === MILLION_SUPPORT_AMOUNT ? " support-amount-million" : ""}`}
                  key={preset}
                >
                  <input
                    type="radio"
                    name="support-amount"
                    value={preset}
                    checked={selected === preset}
                    onChange={() => setSelected(preset)}
                  />
                  <span>
                    {formatKrw(preset)}
                    {preset === MILLION_SUPPORT_AMOUNT ? " 😳" : ""}
                  </span>
                </label>
              ))}
              <label className="support-amount">
                <input
                  type="radio"
                  name="support-amount"
                  value={CUSTOM}
                  checked={selected === CUSTOM}
                  onChange={() => setSelected(CUSTOM)}
                />
                <span>직접 입력</span>
              </label>
            </fieldset>

            {selected === CUSTOM ? (
              <label className="figma-field support-custom" htmlFor={customFieldId}>
                <span>직접 입력 (원)</span>
                <input
                  id={customFieldId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={!live || state.status === "confirming_million"}
                  placeholder={String(config.minAmount)}
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  aria-describedby={`${customFieldId}-range`}
                />
                <span className="support-range" id={`${customFieldId}-range`}>
                  {formatKrw(config.minAmount)} ~ {formatKrw(config.maxAmount)} 사이로 적어주세요.
                </span>
              </label>
            ) : null}
          </>
        ) : null}

        {state.status === "confirming_million" ? (
          <section className="support-million-confirm" aria-labelledby={`${titleId}-million-confirm`}>
            <strong id={`${titleId}-million-confirm`}>진짜 100만원 맞나요? 😳</strong>
            <p>
              장난 버튼이긴 하지만 결제는 장난이 아니에요. 계속하면 실제 {formatKrw(MILLION_SUPPORT_AMOUNT)}
              결제 창이 열립니다.
            </p>
            <div className="support-million-confirm-actions">
              <button type="button" className="figma-support" onClick={() => setState({ status: "ready" })}>
                아니요, 돌아갈래요
              </button>
              <button
                type="button"
                className="figma-submit"
                onClick={() => void beginCheckout(MILLION_SUPPORT_AMOUNT)}
              >
                네, 100만원 후원
              </button>
            </div>
          </section>
        ) : null}

        {state.status === "error" ? (
          <p className="support-dialog-error" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.status !== "confirming_million" ? (
          <div className="support-dialog-actions">
            <button
              type="button"
              className="figma-submit support-dialog-submit"
              disabled={!live || !amountValid || state.status !== "ready"}
              aria-describedby={live ? undefined : `${titleId}-blocked`}
              onClick={start}
            >
              {state.status === "starting" ? "결제 창 여는 중…" : "후원 계속하기"}
            </button>
          </div>
        ) : null}

        {/*
          The Figma Button component requires a disabled state to explain its
          cause in adjacent copy, and honesty requires it here regardless:
          nothing can be charged until the merchant account exists.
        */}
        {config && !live ? (
          <p className="support-dialog-note" id={`${titleId}-blocked`}>
            아직 Toss Payments 상점 연결이 끝나지 않아 카드 결제를 받을 수 없어요. 연결 전에는 결제가 시작되지 않습니다. 지금은 TestFlight 사전예약이 제일 큰 도움이 됩주.
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

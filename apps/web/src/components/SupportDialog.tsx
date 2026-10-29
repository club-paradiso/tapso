import { useEffect, useId, useRef, useState } from "react";
import {
  SUPPORT_CHANNELS,
  SUPPORT_CHANNEL_AVAILABILITY,
} from "../lib/supportChannels.ts";
import {
  createSupportIntent,
  fetchSupportConfig,
  formatKrw,
  type SupportConfigResponse,
} from "../lib/supportClient";

/**
 * The support hub.
 *
 * Public support destinations (Buy Me a Coffee and bank transfer) are shown
 * only when configured. Native Toss checkout remains fail-closed and appears
 * only after the server says it is live.
 *
 * WORDING: `후원` is the product word. TAPSO makes no claim to be a charity or
 * a non-profit and promises no receipt or tax deduction.
 */

type DialogState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "confirming_million" }
  | { status: "starting" }
  | { status: "error"; message: string };

type CopyState = "idle" | "copied" | "failed";
type CopyTarget = "bank" | "kakao";

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
  const [copyResults, setCopyResults] = useState<Record<CopyTarget, CopyState>>({ bank: "idle", kakao: "idle" });

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
  const anyExternal =
    SUPPORT_CHANNEL_AVAILABILITY.buyMeACoffee ||
    SUPPORT_CHANNEL_AVAILABILITY.bankTransfer ||
    SUPPORT_CHANNEL_AVAILABILITY.kakaoPay;
  const amount =
    selected === CUSTOM ? Number.parseInt(customAmount.replace(/[^0-9]/g, ""), 10) : selected;
  const amountValid =
    config !== undefined &&
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= config.minAmount &&
    amount <= config.maxAmount;

  const copyBankAccount = async (target: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(SUPPORT_CHANNELS.bank.account);
      setCopyResults((prev) => ({ ...prev, [target]: "copied" }));
    } catch {
      setCopyResults((prev) => ({ ...prev, [target]: "failed" }));
    }
  };

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
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="support-dialog-body">
        <div className="support-dialog-header">
          <h2 id={titleId}>탑서를 응원하는 방법</h2>
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
          후원금은 서버비, 실제 기기 테스트, 출시 준비에 씁니다. 후원하지 않아도
          탑서는 그대로 쓸 수 있어요.
        </p>

        {SUPPORT_CHANNEL_AVAILABILITY.bankTransfer ? (
          <section className="support-channel" aria-labelledby={`${titleId}-bank`}>
            <div className="support-channel-heading">
              <div>
                <p className="support-channel-kicker">제주에서 만드는 탑서 · KRW</p>
                <h3 id={`${titleId}-bank`}>{SUPPORT_CHANNELS.bank.name} 계좌로 응원하기</h3>
              </div>
              <span className="support-channel-badge">원화 송금</span>
            </div>
            <p className="support-channel-copy">
              원하는 금액을 직접 보내서 응원할 수 있어요.
              송금 전 은행과 예금주, 금액을 꼭 확인해주세요.
            </p>
            {SUPPORT_CHANNEL_AVAILABILITY.tossTransfer ? (
              <div className="support-transfer-qr">
                <img
                  src="/media/jeju-bank-toss-support-qr.svg"
                  alt="제주은행 계좌로 연결되는 토스 앱 송금 QR코드"
                  width="184"
                  height="184"
                  loading="lazy"
                />
                <div className="support-transfer-qr-copy">
                  <strong>QR로 송금하기</strong>
                  <p>PC에서는 휴대폰으로 QR을 스캔하세요. 토스 앱의 송금 화면으로 연결됩니다.</p>
                  <p>휴대폰에서는 아래 송금 버튼을 이용할 수 있어요.</p>
                </div>
              </div>
            ) : null}
            <dl className="support-bank-details">
              <div>
                <dt>은행</dt>
                <dd>{SUPPORT_CHANNELS.bank.name}</dd>
              </div>
              <div>
                <dt>계좌번호</dt>
                <dd>{SUPPORT_CHANNELS.bank.account}</dd>
              </div>
              {SUPPORT_CHANNELS.bank.holder ? (
                <div>
                  <dt>예금주</dt>
                  <dd>{SUPPORT_CHANNELS.bank.holder}</dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              className="figma-support support-channel-button"
              onClick={() => void copyBankAccount("bank")}
            >
              {copyResults.bank === "copied" ? "계좌번호 복사됨" : "계좌번호 복사"}
            </button>
            {copyResults.bank === "failed" ? (
              <p className="support-dialog-error" role="alert">
                자동 복사가 되지 않았어요. 계좌번호를 직접 선택해 복사해주세요.
              </p>
            ) : null}
            {SUPPORT_CHANNEL_AVAILABILITY.tossTransfer ? (
              <a className="figma-submit support-channel-button"
                href={SUPPORT_CHANNELS.tossSendUrl}
              >
                토스로 송금하기
              </a>
            ) : null}
            <div className="support-kakao-transfer">
              <p className="support-channel-copy">
                <strong>카카오페이로 계좌송금하기</strong>
              </p>
              {SUPPORT_CHANNEL_AVAILABILITY.kakaoPay ? (
                <a className="figma-support support-channel-button"
                  href={SUPPORT_CHANNELS.kakaoPayUrl}
                  target="_blank" rel="noopener noreferrer">
                  카카오페이 송금 링크 열기
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    className="figma-support support-channel-button"
                    onClick={() => void copyBankAccount("kakao")}
                  >
                    {copyResults.kakao === "copied"
                      ? "계좌번호 복사됨 · 카카오페이에서 붙여넣기"
                      : "카카오페이 송금용 계좌번호 복사"}
                  </button>
                  {copyResults.kakao === "failed" ? (
                    <p className="support-dialog-error" role="alert">
                      자동 복사가 안 됐어요. 위에 표시된 계좌번호를 직접 복사해주세요.
                    </p>
                  ) : null}
                  <div className="support-kakao-instructions" aria-live="polite">
                    {copyResults.kakao === "copied" ? (
                      <strong>계좌번호를 복사했어요. 이제 카카오페이를 열어주세요.</strong>
                    ) : (
                      <strong>카카오페이에서 보내는 방법</strong>
                    )}
                    <ol>
                      <li>카카오톡 또는 카카오페이 앱에서 송금 메뉴를 엽니다.</li>
                      <li>계좌송금을 선택하고 제주은행 계좌번호를 붙여넣습니다.</li>
                      <li>예금주와 금액을 확인한 후 직접 송금합니다.</li>
                    </ol>
                    <p className="support-channel-copy">
                      카카오페이의 계좌 자동입력 딥링크는 알림톡 전용이라
                      일반 웹페이지에서는 자동으로 송금 화면을 열 수 없어요.
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}

        {SUPPORT_CHANNEL_AVAILABILITY.buyMeACoffee ? (
          <section className="support-channel" aria-labelledby={`${titleId}-bmac`}>
            <div className="support-channel-heading">
              <div>
                <p className="support-channel-kicker">원하는 방식으로 간편하게</p>
                <h3 id={`${titleId}-bmac`}>커피 한 잔으로 응원하기</h3>
              </div>
              <span className="support-channel-badge">Buy Me a Coffee</span>
            </div>
            <p className="support-channel-copy">
              카드나 지원되는 간편결제로 후원할 수 있어요. 결제 정보는 Buy Me a
              Coffee가 처리하고 탑서는 카드 정보를 저장하지 않습니다.
            </p>
            <a
              className="figma-submit support-channel-button"
              href={SUPPORT_CHANNELS.buyMeACoffeeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Buy Me a Coffee에서 후원하기
            </a>
          </section>
        ) : null}

        {state.status === "loading" && !anyExternal ? (
          <p className="support-dialog-note" role="status">
            후원 방법을 확인하는 중이에요…
          </p>
        ) : null}

        {live && config && state.status !== "confirming_million" ? (
          <section className="support-channel support-channel-native" aria-labelledby={`${titleId}-native`}>
            <div className="support-channel-heading">
              <div>
                <p className="support-channel-kicker">탑서 웹사이트</p>
                <h3 id={`${titleId}-native`}>원화 카드 결제</h3>
              </div>
              <span className="support-channel-badge">KRW</span>
            </div>

            <fieldset
              className="support-amounts"
              disabled={state.status === "starting"}
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
                  disabled={state.status === "starting"}
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

            {state.status === "error" ? (
              <p className="support-dialog-error" role="alert">
                {state.message}
              </p>
            ) : null}

            <button
              type="button"
              className="figma-submit support-channel-button"
              disabled={!amountValid || state.status !== "ready"}
              onClick={start}
            >
              {state.status === "starting" ? "결제 창 여는 중…" : "탑서에서 카드로 후원"}
            </button>
          </section>
        ) : null}

        {state.status === "confirming_million" ? (
          <section className="support-million-confirm" aria-labelledby={`${titleId}-million-confirm`}>
            <strong id={`${titleId}-million-confirm`}>진짜 100만원 맞나요? 😳</strong>
            <p>
              장난 버튼이긴 하지만 결제는 장난이 아니에요. 계속하면 실제{" "}
              {formatKrw(MILLION_SUPPORT_AMOUNT)} 결제 창이 열립니다.
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

        {config && !live && !anyExternal ? (
          <p className="support-dialog-note" id={`${titleId}-blocked`}>
            아직 사용할 수 있는 후원 경로가 연결되지 않았어요. 결제 경로가 준비되기
            전에는 돈을 받지 않습니다.
          </p>
        ) : null}

        <p className="fineprint">
          탑서는 비영리 단체가 아니며 기부금 영수증이나 세액공제를 제공하지 않습니다.
        </p>
      </div>
    </dialog>
  );
}

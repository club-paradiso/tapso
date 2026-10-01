import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { confirmSupportPayment, formatKrw } from "./lib/supportClient";
import { Header } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { Journey } from "./sections/Journey";
import { MapCompanion } from "./sections/MapCompanion";
import { Privacy } from "./sections/Privacy";
import { Status } from "./sections/Status";
import { Waitlist } from "./sections/Waitlist";
import { Support } from "./sections/Support";
import { Faq } from "./sections/Faq";
import { Footer } from "./sections/Footer";
import { IslandDock } from "./components/IslandDock";

// Kept out of the initial chunk: the marketing page must not pay for a
// secondary action most visitors never open.
const SupportDialog = lazy(() => import("./components/SupportDialog"));

type SupportReturn =
  | { tone: "good"; message: string }
  | { tone: "neutral"; message: string }
  | { tone: "bad"; message: string };

/**
 * Handles the provider's redirect back to TAPSO.
 *
 * Landing on `?support=success` proves nothing — a visitor can type it. The
 * banner below reports what `/api/support/confirm` said after the server asked
 * the provider directly.
 */
function useSupportReturn(): [SupportReturn | undefined, () => void] {
  const [result, setResult] = useState<SupportReturn | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("support");
    if (outcome !== "success" && outcome !== "fail") return;

    // Clear the query before doing anything else so a refresh cannot replay it.
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);

    if (outcome === "fail") {
      setResult({ tone: "neutral", message: "후원을 취소했어요. 언제든 다시 시도할 수 있습주." });
      return;
    }

    const orderId = params.get("orderId") ?? "";
    const paymentKey = params.get("paymentKey") ?? "";
    const amount = Number.parseInt(params.get("amount") ?? "", 10);
    if (!orderId || !paymentKey || !Number.isSafeInteger(amount)) {
      setResult({ tone: "bad", message: "결제 결과를 확인하지 못했어요. 잠시 후 다시 확인해주세요." });
      return;
    }

    let cancelled = false;
    void confirmSupportPayment({ orderId, paymentKey, amount }).then((response) => {
      if (cancelled) return;
      if (response.status === "paid") {
        setResult({
          tone: "good",
          message: `${formatKrw(response.amount)} 후원해주셔서 고맙수다. 서버와 테스트 비용에 잘 쓰겠습니다. 🍊`,
        });
      } else if (response.status === "pending") {
        setResult({
          tone: "neutral",
          message: "결제를 확인하는 중이에요. 완료되면 영수증이 도착합니다.",
        });
      } else {
        setResult({
          tone: "bad",
          message: "결제가 완료되지 않았어요. 금액이 청구되지 않았는지 확인해주세요.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return [result, useCallback(() => setResult(undefined), [])];
}

function SupportReturnBanner({
  result,
  onDismiss,
}: {
  result: SupportReturn;
  onDismiss: () => void;
}) {
  return (
    <div className={`support-banner support-banner-${result.tone}`} role="status" aria-live="polite">
      <p>{result.message}</p>
      <button type="button" onClick={onDismiss}>
        <span aria-hidden="true">✕</span>
        <span className="visually-hidden">알림 닫기</span>
      </button>
    </div>
  );
}

export default function App() {
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportReturn, dismissSupportReturn] = useSupportReturn();

  return (
    <div className="page">
      <Header />
      <IslandDock />
      <main id="main" tabIndex={-1}>
        {supportReturn ? (
          <SupportReturnBanner result={supportReturn} onDismiss={dismissSupportReturn} />
        ) : null}
        <Hero />
        <Journey />
        <MapCompanion />
        <Privacy />
        <Status />
        <Waitlist />
        <Support onOpen={() => setSupportOpen(true)} />
        <Faq />
      </main>
      <Footer />
      {supportOpen ? (
        <Suspense fallback={null}>
          <SupportDialog onClose={() => setSupportOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

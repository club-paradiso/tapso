import { useState } from "react";
import { CheckScreen, RideScreen } from "../components/AppScreens";
import { MomentIcon } from "../components/Icons";
import { PhoneFrame } from "../components/NativeSurfaces";
import { PreviewTag, TrustBadge } from "../components/RideParts";
import { SectionHead } from "../components/SectionHead";
import { DEMO_TRIP } from "../demo/rideStory.ts";
import { TRUST_STATES } from "../demo/trustStates.ts";

const REMAINING = 5;

const COUNT_WORDS = {
  live: "그대로 보여줘요",
  lastKnown: "마지막 확인 값을 흐리게",
  hidden: "숨겨요",
} as const;

export function TrustStates() {
  const [id, setId] = useState(TRUST_STATES[0]!.id);
  const state = TRUST_STATES.find((s) => s.id === id) ?? TRUST_STATES[0]!;
  const moment = state.moment;

  return (
    <section className="section trust" id="trust" aria-labelledby="trust-title">
      <div className="container">
        <SectionHead
          index="05"
          eyebrow="데이터가 흔들릴 때"
          title={
            <>
              확실하지 않으면,
              <br />
              확실하지 않다고 말해요.
            </>
          }
          titleId="trust-title"
        >
          <p>
            실시간 버스 정보는 늦기도 하고 끊기기도 해요. 탑서는 <b>이 버스가 맞는지</b>와{" "}
            <b>정보가 최신인지</b>를 따로 보여주고, 둘 중 하나라도 흔들리면 하차 알림을 멈춰요.
            확률이나 점수는 보여주지 않아요. 무슨 일인지와 무엇을 하면 되는지만 말해요.
          </p>
        </SectionHead>

        <div className="chips" role="group" aria-label="상황 고르기">
          {TRUST_STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${s.id === id ? " is-active" : ""}`}
              aria-pressed={s.id === id}
              onClick={() => setId(s.id)}
            >
              <MomentIcon symbol={s.symbol} />
              {s.label}
            </button>
          ))}
        </div>

        <div className="trust-grid">
          <div className="trust-device">
            <PhoneFrame className="trust-phone" label={`앱 화면 미리보기. ${state.headline}. ${state.detail}.`}>
              {moment && moment !== "passedDestination" && moment !== "arrived" && moment !== "prepare" && moment !== "nextStop" ? (
                <RideScreen moment={moment} remaining={REMAINING} />
              ) : (
                <CheckScreen stage="similar" />
              )}
            </PhoneFrame>
            <PreviewTag />
          </div>

          <div className="trust-panel" aria-live="polite">
            <h3>{state.headline}</h3>
            <p className="trust-explain">{state.explanation}</p>
            <dl className="trust-table">
              <div>
                <dt>이 버스가 맞나요?</dt>
                <dd>
                  <TrustBadge kind="vehicle" status={state.vehicle} plate={DEMO_TRIP.plate} />
                </dd>
              </div>
              <div>
                <dt>정보가 최신인가요?</dt>
                <dd>
                  <TrustBadge kind="data" status={state.data} />
                </dd>
              </div>
              <div>
                <dt>남은 정거장</dt>
                <dd className={`trust-count count-${state.count}`}>{COUNT_WORDS[state.count]}</dd>
              </div>
              <div>
                <dt>하차 알림</dt>
                <dd className={state.alertsAllowed ? "trust-yes" : "trust-no"}>
                  {state.alertsAllowed ? "보낼 수 있어요" : "보내지 않아요"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

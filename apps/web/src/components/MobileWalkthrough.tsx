import { useEffect, useState } from "react";
import { BeatDevice, pictureLabel } from "./JourneyParts";
import { PreviewTag } from "./RideParts";
import { resolveBeat, type BeatId } from "../story/beats.ts";
import { MOBILE_STAGES, MOBILE_RIDE_VIEWS, mobileBeat } from "../story/mobileJourney.ts";

export function MobileWalkthrough() {
  const [current, setCurrent] = useState(0);
  const [rideView, setRideView] = useState<BeatId>("pocket");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const copy = MOBILE_STAGES[current]!;
  const { stage, activity } = resolveBeat(mobileBeat(current, rideView));
  return <section className="mobile-walkthrough container" aria-labelledby="walkthrough-title">
    <header className="walkthrough-head"><p className="walkthrough-eyebrow">TAPSO와 타는 네 단계</p><h2 id="walkthrough-title">내릴 때까지,<br />한눈에.</h2><p>각 단계를 눌러 미리 살펴보세요.</p></header>
    <div className="walkthrough-steps" role="group" aria-label="사용 과정 단계 선택">
      {MOBILE_STAGES.map((item, index) => <button key={item.beatId} type="button" disabled={!ready} aria-pressed={current === index} aria-controls="walkthrough-preview" aria-label={`${index + 1}단계: ${item.title}`} onClick={() => { setCurrent(index); setRideView("pocket"); }}><span aria-hidden="true">0{index + 1}</span>{item.label}</button>)}
    </div>
    <div className="walkthrough-copy" aria-live="polite" aria-atomic="true"><p className="walkthrough-counter">{current + 1} / {MOBILE_STAGES.length}</p><h3>{copy.title}</h3><p>{copy.body}</p></div>
    <div className="walkthrough-preview" id="walkthrough-preview">
      <div className="walkthrough-device" aria-hidden="true"><BeatDevice stage={stage} activity={activity} /></div>
      <p className="visually-hidden" role="status">{pictureLabel(stage, activity)}</p>
      <PreviewTag />
    </div>
    {current === 3 ? <div className="walkthrough-views" role="group" aria-label="하차 안내 화면 선택">{MOBILE_RIDE_VIEWS.map((view) => <button type="button" key={view.beatId} aria-pressed={rideView === view.beatId} onClick={() => setRideView(view.beatId)}>{view.label}</button>)}</div> : null}
    <p className="walkthrough-caveat">개발 중인 화면 예시예요. 실제 iPhone·버스 검증은 남아 있으며, 앱을 닫은 뒤의 안내는 아직 준비 중이에요.</p>
    <noscript><ol className="walkthrough-fallback">{MOBILE_STAGES.map((item) => <li key={item.beatId}><b>{item.title}</b><p>{item.body}</p></li>)}</ol><p>아래 ‘전체 사용 과정 보기’에서 모든 화면을 볼 수 있어요.</p></noscript>
  </section>;
}

import { useState } from "react";
import { BUS_SCENES, BUS_VIEWS, type BusView, type SceneBus } from "../demo/busScene.ts";
import { IOS_COPY } from "../demo/rideCopy.ts";
import { presentMoment, type CountPresentation } from "../demo/rideMoments.ts";
import { BOARDING_STOP, DEMO_TRIP, TRIP_TOTAL_STOPS } from "../demo/rideStory.ts";
import { islandOnPhone, resolveBeat, type Activity, type Beat, type Stage } from "../story/beats.ts";
import { storyStore, useStory } from "../story/storyStore.ts";
import { AppScreen, screenLabel } from "./AppScreens";
import { BellIcon, BusIcon, CheckIcon } from "./Icons";
import { HomeScreenPhone, Island, LockScreenActivity, LockScreenPhone, PhoneFrame, islandLabel, surfaceLabel } from "./NativeSurfaces";
import { TrustBadge } from "./RideParts";

/* Pictures of a beat ---------------------------------------------------------- */

/** Where the phone is, in the rider's words. */
export function stageCaption(stage: Stage): string {
  if (stage.kind === "app") return "탑서 앱";
  if (stage.kind === "lock") return "잠금 화면";
  if (stage.form === "expanded") return "다른 앱을 쓰는 중 · 길게 눌렀을 때";
  if (stage.form === "minimal") return "다른 앱을 쓰는 중 · 실시간 현황이 둘일 때";
  return "다른 앱을 쓰는 중";
}

/** The sentence a screen reader gets for a beat's picture. */
export function pictureLabel(stage: Stage, activity: Activity | null): string {
  if (stage.kind === "app") return screenLabel(stage.screen);
  if (stage.kind === "lock" && activity) return surfaceLabel("잠금 화면", activity.moment, activity.remaining);
  if (stage.kind === "home") return `홈 화면 ${islandLabel(activity, stage.form)}`;
  return "";
}

function alerts(activity: Activity | null): boolean {
  return activity !== null && presentMoment(activity.moment).milestone;
}

/** The phone on the sticky stage (wide screens). */
export function BeatDevice({ stage, activity }: { stage: Stage; activity: Activity | null }) {
  if (stage.kind === "app") {
    const key = stage.screen.kind === "check" ? `check-${stage.screen.stage}` : stage.screen.kind;
    return (
      <PhoneFrame className="stage-phone" label={screenLabel(stage.screen)}>
        <div className="stage-screen" key={key}>
          <AppScreen screen={stage.screen} />
        </div>
      </PhoneFrame>
    );
  }
  if (stage.kind === "lock" && activity) {
    return <LockScreenPhone moment={activity.moment} remaining={activity.remaining} className="stage-phone" alerting={alerts(activity)} />;
  }
  const island = islandOnPhone(stage, activity);
  return <HomeScreenPhone activity={island?.activity ?? null} form={island?.form ?? "compact"} className="stage-phone" />;
}

/** A small picture inside the step itself (narrow screens). */
export function BeatPicture({ stage, activity }: { stage: Stage; activity: Activity | null }) {
  if (stage.kind === "app") {
    return (
      <div className="step-phone-crop">
        <PhoneFrame className="step-phone" label={screenLabel(stage.screen)}>
          <AppScreen screen={stage.screen} />
        </PhoneFrame>
      </div>
    );
  }
  if (stage.kind === "lock" && activity) {
    return (
      <div className="mini-lock">
        {alerts(activity) ? (
          <span className="lock-alert">
            <BellIcon />
            알림 한 번
          </span>
        ) : null}
        <LockScreenActivity moment={activity.moment} remaining={activity.remaining} />
      </div>
    );
  }
  const island = islandOnPhone(stage, activity);
  return (
    <div className={`mini-home form-${island?.form ?? "compact"}`}>
      <Island activity={island?.activity ?? null} form={island?.form ?? "compact"} />
    </div>
  );
}

/* Variant picker -------------------------------------------------------------- */

export function useBeatVariant(beat: Beat): string | undefined {
  return useStory((s) => s.variants[beat.id]) ?? beat.variants?.[0]?.id;
}

/** Buttons that switch what a beat shows; picking one also makes the beat current. */
export function VariantPicker({ beat, label }: { beat: Beat; label: string }) {
  const current = useBeatVariant(beat);
  if (!beat.variants) return null;
  return (
    <div className="variant-picker" role="group" aria-label={label}>
      {beat.variants.map((variant) => {
        const moment = variant.activity?.moment;
        const role = moment ? ` role-${presentMoment(moment).colorRole}` : "";
        return (
          <button
            key={variant.id}
            type="button"
            className={`variant-chip${role}${variant.id === current ? " is-active" : ""}`}
            aria-pressed={variant.id === current}
            onClick={() => {
              storyStore.setVariant(beat.id, variant.id);
              storyStore.setPosition(beat.id);
            }}
          >
            {variant.label}
          </button>
        );
      })}
    </div>
  );
}

/* Trust table ------------------------------------------------------------------ */

const COUNT_WORDS: Record<CountPresentation, string> = {
  live: "그대로 보여줘요",
  lastKnown: "마지막 확인 값을 흐리게",
  hidden: "숨겨요",
};

export function TrustTable({ beat }: { beat: Beat }) {
  const variant = useBeatVariant(beat);
  const { activity } = resolveBeat(beat, variant);
  if (!activity) return null;
  const p = presentMoment(activity.moment);
  return (
    <dl className="trust-table">
      <div>
        <dt>이 버스가 맞나요?</dt>
        <dd>
          <TrustBadge kind="vehicle" status={p.vehicle} plate={DEMO_TRIP.plate} onDark />
        </dd>
      </div>
      <div>
        <dt>정보가 최신인가요?</dt>
        <dd>
          <TrustBadge kind="data" status={p.data} onDark />
        </dd>
      </div>
      <div>
        <dt>남은 정거장</dt>
        <dd className={`trust-count count-${p.count}`}>{COUNT_WORDS[p.count]}</dd>
      </div>
      <div>
        <dt>하차 알림</dt>
        <dd className="trust-no">보내지 않아요</dd>
      </div>
    </dl>
  );
}

/* Which 365 am I on? ----------------------------------------------------------- */

/** Road slots, left to right in the direction of travel; the boarding stop is the fourth. */
const SLOTS = [3, 2, 1, 0, -1] as const;

function slotLabel(stopsAway: number): string {
  if (stopsAway === 0) return `타는 정류장 · ${BOARDING_STOP}`;
  if (stopsAway < 0) return "지난 정류장";
  return `${stopsAway}정거장 전`;
}

function SceneBusView({ bus }: { bus: SceneBus }) {
  return (
    <span className={`scene-bus role-${bus.role}`}>
      <span className="scene-bus-body">
        <BusIcon />
        <b>365</b>
      </span>
      {bus.role === "unknown" ? (
        <span className="scene-bus-plate is-unknown">
          <span aria-hidden="true">?</span>
          <span className="visually-hidden">차량 모름</span>
        </span>
      ) : (
        <span className="scene-bus-plate">{bus.plate}</span>
      )}
      <span className="scene-bus-note">
        {bus.role === "proposed" ? <CheckIcon /> : null}
        {bus.note}
      </span>
    </span>
  );
}

export function BusScene() {
  const [view, setView] = useState<BusView>("routeOnly");
  const scene = BUS_SCENES[view];
  return (
    <div className="bus-demo">
      <div className="segmented" role="group" aria-label="버스를 보는 방법">
        {BUS_VIEWS.map((v) => (
          <button key={v} type="button" className={v === view ? "is-active" : undefined} aria-pressed={v === view} onClick={() => setView(v)}>
            {BUS_SCENES[v].tab}
          </button>
        ))}
      </div>
      <figure className={`scene view-${view}`}>
        <ol className="scene-road" aria-label="정류장 방향으로 달리는 버스들">
          {SLOTS.map((slot) => {
            const bus = scene.buses.find((b) => b.stopsAway === slot);
            return (
              <li key={slot} className={`scene-slot${slot === 0 ? " is-boarding" : ""}${slot < 0 ? " is-past" : ""}`}>
                <span className="scene-stop">
                  <span className="scene-stop-dot" aria-hidden="true" />
                  {slotLabel(slot)}
                </span>
                {bus ? <SceneBusView bus={bus} /> : <span className="scene-empty" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
        <figcaption className="scene-result" aria-live="polite">
          <strong>{scene.headline}</strong>
          <span>{scene.detail}</span>
          {scene.asksRider ? (
            <span className="scene-choices" aria-hidden="true">
              <span className="scene-choice">••0001 · 정류장에 도착</span>
              <span className="scene-choice">••0002 · 1정거장 전</span>
              <span className="scene-choice is-quiet">{IOS_COPY["check.noneOfThese"]}</span>
            </span>
          ) : null}
        </figcaption>
      </figure>
      <p className="fineprint">설명용 그림 · 합성 데이터</p>
    </div>
  );
}

/* When does the rider look? ---------------------------------------------------- */

type Glance = { at: number; label: string; kind: "confirm" | "prepare" | "next" | "arrive" };

const TAPSO_GLANCES: readonly Glance[] = [
  { at: 0, label: "탈 때 확인", kind: "confirm" },
  { at: TRIP_TOTAL_STOPS - 2, label: "2정거장 전", kind: "prepare" },
  { at: TRIP_TOTAL_STOPS - 1, label: "다음 하차", kind: "next" },
  { at: TRIP_TOTAL_STOPS, label: "도착", kind: "arrive" },
];

const pct = (stop: number) => `${(stop / TRIP_TOTAL_STOPS) * 100}%`;

/** The attention rule, drawn: an illustration, not a measurement, and it says so. */
export function GlanceChart() {
  const stops = Array.from({ length: TRIP_TOTAL_STOPS + 1 }, (_, i) => i);
  return (
    <figure className="glance">
      <div className="glance-row glance-before">
        <p className="glance-row-label">
          <b>지도 앱만 볼 때</b>
          <span>정류장마다 “아직인가?”</span>
        </p>
        <div className="glance-track" aria-hidden="true">
          {stops.map((s) => (
            <span key={s} className="glance-mark is-anxious" style={{ left: pct(s) }} />
          ))}
        </div>
      </div>
      <div className="glance-row glance-after">
        <p className="glance-row-label">
          <b>탑서와 함께</b>
          <span>탑서가 부를 때만</span>
        </p>
        <div className="glance-track" aria-hidden="true">
          <span className="glance-pocket" style={{ left: pct(2), right: `calc(100% - ${pct(TRIP_TOTAL_STOPS - 2.6)})` }}>
            주머니 속
          </span>
          {TAPSO_GLANCES.map((g) => (
            <span key={g.kind} className={`glance-mark is-${g.kind}`} style={{ left: pct(g.at) }}>
              <span className="glance-mark-label">{g.label}</span>
            </span>
          ))}
        </div>
      </div>
      <figcaption>
        <span className="visually-hidden">
          지도 앱만 볼 때는 {TRIP_TOTAL_STOPS}개 정류장마다 화면을 확인하지만, 탑서와 함께라면 탈 때 한 번, 2정거장 전, 다음 하차,
          도착 때만 화면을 봐요.
        </span>
        그림으로 나타낸 예시예요. 측정한 수치가 아니에요.
      </figcaption>
    </figure>
  );
}

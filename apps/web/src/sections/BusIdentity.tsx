import { useState } from "react";
import { BusIcon, CheckIcon } from "../components/Icons";
import { PreviewTag } from "../components/RideParts";
import { SectionHead } from "../components/SectionHead";
import { BUS_SCENES, BUS_VIEWS, type BusView, type SceneBus } from "../demo/busScene.ts";
import { IOS_COPY } from "../demo/rideCopy.ts";
import { BOARDING_STOP } from "../demo/rideStory.ts";

/** Road slots, left to right in the direction of travel; the boarding stop is the fourth. */
const SLOTS = [3, 2, 1, 0, -1] as const;

function slotLabel(stopsAway: number): string {
  if (stopsAway === 0) return `타는 정류장 · ${BOARDING_STOP}`;
  if (stopsAway < 0) return "지난 정류장";
  return `${stopsAway}정거장 전`;
}

function Bus({ bus }: { bus: SceneBus }) {
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

export function BusIdentity() {
  const [view, setView] = useState<BusView>("routeOnly");
  const scene = BUS_SCENES[view];

  return (
    <section className="section bus" id="bus" aria-labelledby="bus-title">
      <div className="container">
        <SectionHead
          index="02"
          eyebrow="실제 버스 확인"
          title={
            <>
              같은 365번이라도,
              <br />
              같은 버스는 아니에요.
            </>
          }
          titleId="bus-title"
        >
          <p>
            365번 버스는 한 대만 다니지 않아요. 그래서 노선 번호만 알아서는 부족해요. 탑서는 내가 실제로 탄 차량을 한 번 확인한 뒤 그 버스를 따라가요.
          </p>
        </SectionHead>

        <div className="bus-demo">
          <div className="segmented" role="group" aria-label="버스를 보는 방법">
            {BUS_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                className={v === view ? "is-active" : undefined}
                aria-pressed={v === view}
                onClick={() => setView(v)}
              >
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
                    {bus ? (
                      <Bus bus={bus} />
                    ) : (
                      <span className="scene-empty" aria-hidden="true" />
                    )}
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
          <PreviewTag>설명용 그림 · 합성 데이터</PreviewTag>
        </div>

        <blockquote className="pull-quote">
          <p>“{IOS_COPY["check.why"]}”</p>
          <cite>탑서 앱, 버스 확인 화면</cite>
        </blockquote>
      </div>
    </section>
  );
}

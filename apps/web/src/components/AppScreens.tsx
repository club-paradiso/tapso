import { IOS_COPY, t } from "../demo/rideCopy.ts";
import { presentMoment } from "../demo/rideMoments.ts";
import {
  BOARDING_STOP,
  DEMO_ROUTE,
  DEMO_TRIP,
  DESTINATION_STOP,
  positionFor,
  railProgress,
  stopName,
  type StoryScreen,
} from "../demo/rideStory.ts";
import { BusIcon, CheckIcon, ChevronIcon, MomentIcon, PinIcon, SearchIcon } from "./Icons";
import { CitrusDot, DolBuddy, JourneyRail, RouteBadge, TrustBadge } from "./RideParts";

/**
 * The app screens the ride story walks through, re-drawn from the Product V2
 * SwiftUI views (`apps/ios/TapsoApp`). Pictures only: nothing here is
 * interactive, and the enclosing phone is one labelled image.
 */

function NavTitle({ title, step }: { title: string; step?: string }) {
  return (
    <div className="app-nav">
      <span className="app-back">
        <ChevronIcon />
      </span>
      <span className="app-nav-title">{title}</span>
      {step ? <span className="app-nav-step">{step}</span> : <span />}
    </div>
  );
}

function SearchScreen() {
  return (
    <div className="app-screen">
      <span className="app-demo-chip">{IOS_COPY["demo.chip"]}</span>
      <h4 className="app-question">{IOS_COPY["home.question"]}</h4>
      <div className="app-search">
        <SearchIcon />
        <span className="app-search-placeholder">{IOS_COPY["home.search.placeholder"]}</span>
      </div>
      <p className="app-section-label">{IOS_COPY["home.recentDestinations"]}</p>
      <div className="app-chips">
        <span className="app-chip is-selected">
          <CitrusDot size={7} />
          {DESTINATION_STOP}
        </span>
        <span className="app-chip">{stopName(4)}</span>
        <span className="app-chip">{stopName(6)}</span>
      </div>
      <p className="app-section-label">{IOS_COPY["home.recentJourney"]}</p>
      <div className="app-recent">
        <RouteBadge number={DEMO_ROUTE.number} role="active" />
        <span>
          <b>{DESTINATION_STOP}</b>
          <small>{t("favorite.from", BOARDING_STOP)}</small>
        </span>
        <span className="app-recent-again">{IOS_COPY["home.rideAgain"]}</span>
      </div>
      <div className="app-import">
        <b>{IOS_COPY["home.mapImport.title"]}</b>
        <small>{IOS_COPY["home.mapImport.body"]}</small>
      </div>
      <p className="app-footnote">{IOS_COPY["home.privacy"]}</p>
    </div>
  );
}

function RouteScreen() {
  return (
    <div className="app-screen">
      <NavTitle title={DESTINATION_STOP} step="1/2" />
      <h4 className="app-question">{IOS_COPY["route.question"]}</h4>
      <ul className="app-list app-list-cards">
        <li className="is-selected">
          <RouteBadge number={DEMO_ROUTE.number} role="active" />
          <span>
            <b>{t("route.headsign", DEMO_ROUTE.outboundHeadsign)}</b>
            <small>{t("route.boardingCount", 8)}</small>
          </span>
          <ChevronIcon />
        </li>
        <li>
          <RouteBadge number={DEMO_ROUTE.number} role="active" />
          <span>
            <b>{t("route.headsign", DEMO_ROUTE.inboundHeadsign)}</b>
            <small>{t("route.boardingCount", 1)}</small>
          </span>
          <ChevronIcon />
        </li>
      </ul>
    </div>
  );
}

function BoardingScreen() {
  const rows = [3, 4, 5, 8].map((stops) => ({
    name: stopName(DEMO_TRIP.destinationIndex - stops),
    stops,
  }));
  return (
    <div className="app-screen">
      <NavTitle title={DESTINATION_STOP} step="2/2" />
      <h4 className="app-question">{IOS_COPY["boarding.question"]}</h4>
      <p className="app-explain">{IOS_COPY["boarding.explain"]}</p>
      <ul className="app-list">
        {rows.map((row) => (
          <li key={row.name} className={row.name === BOARDING_STOP ? "is-selected" : undefined}>
            <BusIcon />
            <span>
              <b>{row.name}</b>
              <small>{t("boarding.stopsToDestination", row.stops)}</small>
            </span>
            {row.name === BOARDING_STOP ? <CheckIcon /> : <ChevronIcon />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StopPair() {
  return (
    <div className="app-stop-pair">
      <span>
        <BusIcon />
        {BOARDING_STOP}
      </span>
      <span>
        <CitrusDot size={8} />
        {DESTINATION_STOP}
      </span>
    </div>
  );
}

export function CheckScreen({ stage }: { stage: "searching" | "proposed" | "confirmed" | "similar" }) {
  if (stage === "similar") {
    return (
      <div className="app-screen">
        <NavTitle title="버스 확인" />
        <StopPair />
        <div className="app-confirm">
          <b className="app-confirm-headline">{IOS_COPY["check.similarBuses.headline"]}</b>
          <small>{IOS_COPY["check.similarBuses.detail"]}</small>
          {[
            { plate: "••0001", where: IOS_COPY["check.position.atStop"] },
            { plate: "••0002", where: t("check.position.away", 1) },
          ].map((bus) => (
            <div className="app-confirm-card is-choice" key={bus.plate}>
              <RouteBadge number={DEMO_ROUTE.number} role="checking" />
              <span className="app-plate">
                <small>{IOS_COPY["check.plateHint"]}</small>
                <b>{bus.plate}</b>
              </span>
              <span className="app-position">{bus.where}</span>
            </div>
          ))}
          <span className="app-button">{IOS_COPY["check.noneOfThese"]}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="app-screen">
      <NavTitle title="버스 확인" />
      <StopPair />
      {stage === "searching" ? (
        <div className="app-check app-check-searching">
          <span className="app-check-pulse">
            <BusIcon />
          </span>
          <b>{IOS_COPY["check.searching.headline"]}</b>
          <small>{t("check.searching.detail", DEMO_ROUTE.number)}</small>
        </div>
      ) : (
        <div className={`app-confirm${stage === "confirmed" ? " is-confirmed" : ""}`}>
          <b className="app-confirm-headline">
            {stage === "confirmed" ? IOS_COPY["check.confirmed.headline"] : IOS_COPY["check.proposed.headline"]}
          </b>
          <small>{stage === "confirmed" ? IOS_COPY["check.confirmed.detail"] : IOS_COPY["check.proposed.detail"]}</small>
          <div className="app-confirm-card">
            <RouteBadge number={DEMO_ROUTE.number} role={stage === "confirmed" ? "active" : "checking"} />
            <span className="app-plate">
              <small>{IOS_COPY["check.plateHint"]}</small>
              <b>{DEMO_TRIP.plate}</b>
            </span>
            <span className="app-position">{IOS_COPY["check.position.atStop"]}</span>
          </div>
          {stage === "confirmed" ? (
            <TrustBadge kind="vehicle" status="confirmed" plate={DEMO_TRIP.plate} />
          ) : (
            <>
              <span className="app-button app-button-primary">{IOS_COPY["check.confirm"]}</span>
              <span className="app-button">{IOS_COPY["check.reject"]}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type ScreenMoment = "riding" | "prepare" | "nextStop" | "arrived" | "delayed" | "vehicleLost" | "offline" | "checking";

export function RideScreen({ moment, remaining }: { moment: ScreenMoment; remaining: number }) {
  const p = presentMoment(moment);
  const { current, next } = positionFor(remaining);
  const calm = moment === "riding" || p.colorRole === "degraded" || p.colorRole === "checking";
  return (
    <div className="app-screen app-ride">
      <div className="app-ride-nav">
        <RouteBadge number={DEMO_ROUTE.number} role={p.colorRole} compact />
        <span>{t("ride.toDestination", DESTINATION_STOP)}</span>
      </div>
      {moment !== "riding" && calm ? (
        <div className={`app-banner role-${p.colorRole}`}>
          <MomentIcon symbol={p.symbol} />
          <span>
            <b>{p.headline}</b>
            <small>{p.detail}</small>
          </span>
        </div>
      ) : null}
      <div className={`app-hero hero-${calm ? "riding" : moment}${p.count === "lastKnown" ? " is-last-known" : ""}`}>
        {calm ? (
          <>
            <span className="app-hero-eyebrow">
              <MomentIcon symbol={p.symbol} />
              {p.eyebrow}
            </span>
            {p.count === "hidden" ? (
              <span className="app-hero-hidden">{t("ride.toDestination", DESTINATION_STOP)}</span>
            ) : (
              <span className="app-hero-count">
                <b>{remaining}</b>
                <span>
                  {p.count === "lastKnown" ? `정거장 · ${IOS_COPY["count.lastKnown"]}` : IOS_COPY["count.unit.long"]}
                  <small>{t("ride.toDestination", DESTINATION_STOP)}</small>
                </span>
              </span>
            )}
            {moment === "riding" ? (
              <>
                <span className="app-hero-headline">{p.headline}</span>
                <span className="app-hero-detail">{p.detail}</span>
              </>
            ) : null}
            <JourneyRail progress={railProgress(remaining)} role={p.colorRole} />
            <span className="app-hero-dol">
              <DolBuddy moment={moment} size={30} />
            </span>
          </>
        ) : (
          <>
            <span className="app-hero-symbol">
              <MomentIcon symbol={p.symbol} />
            </span>
            <span className="app-hero-big">{p.headline}</span>
            {moment !== "prepare" ? <span className="app-hero-destination">{DESTINATION_STOP}</span> : null}
            <span className="app-hero-detail">{p.detail}</span>
            {moment === "prepare" && next ? (
              <span className="app-hero-next">
                {IOS_COPY["ride.nextStopLabel"]} · <b>{next}</b>
              </span>
            ) : null}
            {moment === "arrived" ? <span className="app-button app-button-on-arrival">{IOS_COPY["ride.gotOff"]}</span> : null}
          </>
        )}
      </div>
      <div className="app-trust-row">
        <TrustBadge kind="vehicle" status={p.vehicle} plate={DEMO_TRIP.plate} />
        <TrustBadge kind="data" status={p.data} />
      </div>
      {moment !== "arrived" && moment !== "nextStop" ? (
        <ol className="app-ladder">
          <li>
            <small>{IOS_COPY["ride.now"]}</small>
            {current}
          </li>
          {next && next !== DESTINATION_STOP ? <li>{next}</li> : null}
          <li className="is-destination">
            <small>{IOS_COPY["ride.getOffHere"]}</small>
            {DESTINATION_STOP}
          </li>
        </ol>
      ) : null}
      {moment === "riding" ? <p className="app-ride-note">{IOS_COPY["ride.closeApp"]}</p> : null}
      {moment !== "arrived" ? <span className="app-button app-button-end">{IOS_COPY["ride.end"]}</span> : null}
    </div>
  );
}

export function AppScreen({ screen }: { screen: StoryScreen }) {
  switch (screen.kind) {
    case "search":
      return <SearchScreen />;
    case "route":
      return <RouteScreen />;
    case "boarding":
      return <BoardingScreen />;
    case "check":
      return <CheckScreen stage={screen.stage} />;
    case "ride":
      return <RideScreen moment={screen.moment} remaining={screen.remaining} />;
  }
}

/** One sentence per screen for assistive technology. */
export function screenLabel(screen: StoryScreen): string {
  switch (screen.kind) {
    case "search":
      return `앱 화면 미리보기. ${IOS_COPY["home.question"]} 검색 결과: ${DESTINATION_STOP}.`;
    case "route":
      return `앱 화면 미리보기. ${IOS_COPY["route.question"]} ${DEMO_ROUTE.number}번 ${t("route.headsign", DEMO_ROUTE.outboundHeadsign)} 선택.`;
    case "boarding":
      return `앱 화면 미리보기. ${IOS_COPY["boarding.question"]} ${BOARDING_STOP} 선택, ${t("boarding.stopsToDestination", DEMO_TRIP.destinationIndex)}.`;
    case "check":
      if (screen.stage === "searching") return `앱 화면 미리보기. ${IOS_COPY["check.searching.headline"]}.`;
      if (screen.stage === "proposed")
        return `앱 화면 미리보기. ${IOS_COPY["check.proposed.headline"]}. ${DEMO_ROUTE.number}번 버스, 번호판 끝자리 0001, ${IOS_COPY["check.position.atStop"]}.`;
      return `앱 화면 미리보기. ${IOS_COPY["check.confirmed.headline"]}. 차량 확인됨.`;
    case "ride": {
      const p = presentMoment(screen.moment);
      return screen.moment === "riding"
        ? `앱 화면 미리보기. ${DESTINATION_STOP}까지 ${screen.remaining}정거장 남음. ${p.headline}.`
        : `앱 화면 미리보기. ${p.headline}. ${p.detail}.`;
    }
  }
}

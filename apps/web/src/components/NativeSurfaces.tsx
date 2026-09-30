import type { ReactNode } from "react";
import { presentMoment, spokenSummary, type RideMoment } from "../demo/rideMoments.ts";
import { DEMO_ROUTE, DEMO_TRIP, DESTINATION_STOP, railProgress } from "../demo/rideStory.ts";
import { CitrusDot, CountOrSymbol, DolBuddy, JourneyRail, RouteBadge, TrustBadge } from "./RideParts";
import { MomentIcon } from "./Icons";

/**
 * Web re-drawings of the Live Activity surfaces in
 * `apps/ios/Shared/LiveActivitySurfaces.swift`. They are pictures of the
 * native product: each is exposed to assistive technology as one image with
 * the sentence the app itself would speak, never as a working control.
 */

type SurfaceProps = { moment: RideMoment; remaining: number };

/** A drawn iPhone. `island` renders the hardware cutout, optionally holding live content. */
export function PhoneFrame({
  children,
  label,
  className = "",
  tone = "light",
  islandContent,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  tone?: "light" | "dark";
  islandContent?: ReactNode;
}) {
  return (
    <div className={`phone phone-${tone} ${className}`} role="img" aria-label={label}>
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-status">
          <span className="phone-time">8:24</span>
          <span className="phone-indicators">
            <span className="phone-signal" />
            <span className="phone-battery" />
          </span>
        </div>
        <div className={`phone-island${islandContent ? " phone-island-live" : ""}`}>{islandContent}</div>
        {children}
      </div>
    </div>
  );
}

export function LockScreenActivity({ moment, remaining }: SurfaceProps) {
  const p = presentMoment(moment);
  const showsRail = moment === "riding" || moment === "prepare" || moment === "delayed" || moment === "vehicleLost" || moment === "offline";
  const badgeRole = p.surface === "basalt" ? p.colorRole : "neutral";
  return (
    <div className={`la-lock surface-${p.surface} role-${p.colorRole}`}>
      <div className="la-lock-top">
        <RouteBadge number={DEMO_ROUTE.number} role={badgeRole} />
        <span className="la-lock-destination">{DESTINATION_STOP}</span>
        {p.data !== "live" ? (
          <TrustBadge kind="data" status={p.data} onDark />
        ) : moment === "riding" ? (
          <DolBuddy moment={moment} size={22} />
        ) : null}
      </div>
      <div className="la-lock-main">
        <div className="la-lock-copy">
          <strong>{p.headline}</strong>
          <span>{p.detail}</span>
        </div>
        <CountOrSymbol presentation={p} remaining={remaining} size="lg" />
      </div>
      {showsRail ? <JourneyRail progress={railProgress(remaining)} role={p.colorRole} /> : null}
    </div>
  );
}

export function IslandCompact({ moment, remaining }: SurfaceProps) {
  const p = presentMoment(moment);
  return (
    <div className={`island island-compact role-${p.colorRole}`}>
      <span className="island-leading">
        <DolBuddy moment={moment} size={18} />
        <span className="island-route">{DEMO_ROUTE.number}</span>
      </span>
      <span className="island-sensor" />
      <span className="island-trailing">
        {p.compact ? (
          <span className="island-pill">
            <MomentIcon symbol={p.symbol} />
            {p.compact}
            {moment === "prepare" ? <b>{remaining}</b> : null}
          </span>
        ) : (
          <span className="island-count">
            <b>{remaining}</b>
            <small>정거장</small>
          </span>
        )}
      </span>
    </div>
  );
}

export function IslandMinimal({ moment, remaining }: SurfaceProps) {
  const p = presentMoment(moment);
  return (
    <div className={`island island-minimal role-${p.colorRole}`}>
      {p.count === "live" ? <b>{remaining}</b> : <MomentIcon symbol={p.symbol} />}
    </div>
  );
}

export function IslandExpanded({ moment, remaining }: SurfaceProps) {
  const p = presentMoment(moment);
  const showsRail = moment === "riding" || moment === "prepare" || moment === "nextStop";
  return (
    <div className={`island island-expanded role-${p.colorRole}`}>
      <div className="island-x-top">
        <span className="island-x-leading">
          <DolBuddy moment={moment} size={26} />
          <RouteBadge number={DEMO_ROUTE.number} role={p.colorRole} compact />
        </span>
        <span className="island-x-eyebrow">{p.eyebrow}</span>
        <CountOrSymbol presentation={p} remaining={remaining} size="sm" />
      </div>
      <div className="island-x-bottom">
        <strong>{p.headline}</strong>
        <span className="island-x-destination">
          <CitrusDot size={7} />
          {DESTINATION_STOP}
        </span>
        {showsRail ? (
          <JourneyRail progress={railProgress(remaining)} role={p.colorRole} />
        ) : (
          <span className="island-x-detail">{p.detail}</span>
        )}
        <span className="island-x-trust">
          <TrustBadge kind="vehicle" status={p.vehicle} plate={DEMO_TRIP.plate} onDark />
          <TrustBadge kind="data" status={p.data} onDark />
        </span>
      </div>
    </div>
  );
}

export function surfaceLabel(where: string, moment: RideMoment, remaining: number): string {
  return `${where} 미리보기. ${spokenSummary(presentMoment(moment), DEMO_ROUTE.number, DESTINATION_STOP, remaining)}`;
}

/** An iPhone Lock Screen holding the TAPSO Live Activity. */
export function LockScreenPhone({
  moment,
  remaining,
  className = "",
}: SurfaceProps & { className?: string }) {
  return (
    <PhoneFrame tone="dark" className={`phone-lock ${className}`} label={surfaceLabel("잠금 화면", moment, remaining)}>
      <div className="lock-wallpaper" />
      <div className="lock-clock">
        <span className="lock-date">9월 30일 수요일</span>
        <span className="lock-time">8:24</span>
      </div>
      <div className="lock-activity">
        <LockScreenActivity moment={moment} remaining={remaining} />
      </div>
    </PhoneFrame>
  );
}

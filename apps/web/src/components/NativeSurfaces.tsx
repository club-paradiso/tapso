import type { ReactNode } from "react";
import { presentMoment, spokenSummary, type MomentPresentation, type RideMoment } from "../demo/rideMoments.ts";
import { DEMO_ROUTE, DEMO_TRIP, DESTINATION_STOP, railProgress } from "../demo/rideStory.ts";
import type { Activity, IslandForm } from "../story/beats.ts";
import { BrandMark } from "./BrandMark";
import { BellIcon, MomentIcon, TimerIcon } from "./Icons";
import { CitrusDot, CountOrSymbol, DolBuddy, JourneyRail, RouteBadge, TrustBadge } from "./RideParts";

/**
 * Web re-drawings of the Live Activity surfaces in
 * `apps/ios/Shared/LiveActivitySurfaces.swift`. They are pictures of the
 * native product: each is exposed to assistive technology as one image with
 * the sentence the app itself would speak, never as a working control.
 */

type SurfaceProps = { moment: RideMoment; remaining: number };

/** A drawn iPhone. `island` replaces the empty hardware island, e.g. with a live one. */
export function PhoneFrame({
  children,
  label,
  className = "",
  tone = "light",
  island,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  tone?: "light" | "dark";
  island?: ReactNode;
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
        <div className="phone-isle-slot">{island ?? <Island activity={null} />}</div>
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

/* Island ------------------------------------------------------------------- */

function CompactContent({ p, remaining }: { p: MomentPresentation; remaining: number }) {
  return (
    <span className="isle-compact-row">
      <span className="island-leading">
        <DolBuddy moment={p.moment} size={18} />
        <span className="island-route">{DEMO_ROUTE.number}</span>
      </span>
      <span className="island-sensor" />
      <span className="island-trailing">
        {p.compact ? (
          <span className="island-pill">
            <MomentIcon symbol={p.symbol} />
            {p.compact}
            {p.moment === "prepare" ? <b>{remaining}</b> : null}
          </span>
        ) : (
          <span className="island-count">
            <b className="isle-tick" key={remaining}>
              {remaining}
            </b>
            <small>정거장</small>
          </span>
        )}
      </span>
    </span>
  );
}

function ExpandedContent({ p, remaining }: { p: MomentPresentation; remaining: number }) {
  const showsRail = p.moment === "riding" || p.moment === "prepare" || p.moment === "nextStop";
  return (
    <span className="isle-expanded-body">
      <span className="island-x-top">
        <span className="island-x-leading">
          <DolBuddy moment={p.moment} size={26} />
          <RouteBadge number={DEMO_ROUTE.number} role={p.colorRole} compact />
        </span>
        <span className="island-x-eyebrow">{p.eyebrow}</span>
        <CountOrSymbol presentation={p} remaining={remaining} size="sm" />
      </span>
      <span className="island-x-bottom">
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
      </span>
    </span>
  );
}

function MinimalContent({ p, remaining }: { p: MomentPresentation; remaining: number }) {
  return p.count === "live" ? <b>{remaining}</b> : <MomentIcon symbol={p.symbol} />;
}

/**
 * The Dynamic Island as one shape that morphs between its presentations:
 * idle (the bare hardware), compact, expanded, and minimal (TAPSO detached as
 * a small circle while another app's activity holds the island). Sizes are in
 * em, so the same island fits a drawn phone or the page's persistent dock.
 */
export function Island({
  activity,
  form = "compact",
  className = "",
  signalling = false,
}: {
  activity: Activity | null;
  form?: IslandForm;
  className?: string;
  /** A milestone alert is showing (the app's AlertConfiguration). */
  signalling?: boolean;
}) {
  const p = activity ? presentMoment(activity.moment) : undefined;
  const shape = activity && p ? form : "idle";
  const role = p ? ` role-${p.colorRole}` : "";
  return (
    <span className={`isle-group form-${shape}${role}${signalling ? " is-signalling" : ""} ${className}`} aria-hidden="true">
      <span className="isle">
        {activity && p ? (
          <span className="isle-content" key={`${shape}-${p.moment}`}>
            {shape === "compact" ? <CompactContent p={p} remaining={activity.remaining} /> : null}
            {shape === "expanded" ? <ExpandedContent p={p} remaining={activity.remaining} /> : null}
            {shape === "minimal" ? (
              <span className="isle-other">
                <TimerIcon />
              </span>
            ) : null}
          </span>
        ) : (
          <span className="isle-lens" />
        )}
      </span>
      <span className="isle-orb">
        {activity && p && shape === "minimal" ? <MinimalContent p={p} remaining={activity.remaining} /> : null}
      </span>
    </span>
  );
}

/** What VoiceOver hears for an island picture. */
export function islandLabel(activity: Activity | null, form: IslandForm): string {
  if (!activity) return "다이나믹 아일랜드 미리보기. 실시간 현황 없음.";
  const where =
    form === "expanded" ? "다이나믹 아일랜드 펼친 화면" : form === "minimal" ? "다이나믹 아일랜드 최소 화면" : "다이나믹 아일랜드 작은 화면";
  return surfaceLabel(where, activity.moment, activity.remaining);
}

export function surfaceLabel(where: string, moment: RideMoment, remaining: number): string {
  return `${where} 미리보기. ${spokenSummary(presentMoment(moment), DEMO_ROUTE.number, DESTINATION_STOP, remaining)}`;
}

/** An iPhone Lock Screen holding the TAPSO Live Activity. */
export function LockScreenPhone({
  moment,
  remaining,
  className = "",
  alerting = false,
}: SurfaceProps & { className?: string; alerting?: boolean }) {
  const p = presentMoment(moment);
  return (
    <PhoneFrame tone="dark" className={`phone-lock role-${p.colorRole} ${className}`} label={surfaceLabel("잠금 화면", moment, remaining)}>
      <div className="lock-wallpaper" />
      <div className="lock-clock">
        <span className="lock-date">9월 30일 수요일</span>
        <span className="lock-time">8:24</span>
      </div>
      <div className={`lock-activity${alerting ? " is-alerting" : ""}`}>
        {alerting ? (
          <span className="lock-alert">
            <BellIcon />
            알림 한 번
          </span>
        ) : null}
        <LockScreenActivity moment={moment} remaining={remaining} />
      </div>
    </PhoneFrame>
  );
}

/** An unlocked iPhone with another app's Home Screen in front: the island carries the ride. */
export function HomeScreenPhone({
  activity,
  form = "compact",
  className = "",
}: {
  activity: Activity | null;
  form?: IslandForm;
  className?: string;
}) {
  return (
    <PhoneFrame
      tone="dark"
      className={`phone-home ${className}`}
      label={`홈 화면 ${islandLabel(activity, form)}`}
      island={<Island activity={activity} form={form} />}
    >
      <div className="home-wallpaper" />
      <div className="home-grid">
        {Array.from({ length: 16 }, (_, i) =>
          i === 5 ? (
            <span key={i} className="home-app home-app-tapso">
              <BrandMark size={28} />
            </span>
          ) : (
            <span key={i} className="home-app" />
          ),
        )}
      </div>
      <div className="home-dock">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="home-app" />
        ))}
      </div>
    </PhoneFrame>
  );
}

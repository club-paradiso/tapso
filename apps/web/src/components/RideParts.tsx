import type { ColorRole, DataStatus, MomentPresentation, RideMoment, VehicleStatus } from "../demo/rideMoments.ts";
import { dataLabel, vehicleLabel } from "../demo/rideMoments.ts";
import { IOS_COPY } from "../demo/rideCopy.ts";
import { CheckIcon, ClockIcon, MomentIcon, RefreshIcon, SearchIcon, WifiOffIcon } from "./Icons";

/**
 * Web renderings of the Product V2 ride components
 * (`apps/ios/Shared/RideSurfaceComponents.swift`, Figma `02F iOS Ride V2`).
 * Decorative pieces are hidden from assistive technology; the surrounding
 * surface carries one spoken summary instead.
 */

/** The basalt companion, one expression per moment (Figma `돌이 / V2`, 153:130). */
export function DolBuddy({ moment, size = 36 }: { moment: RideMoment; size?: number }) {
  const uncertain = moment === "delayed" || moment === "vehicleLost" || moment === "offline" || moment === "checking";
  return (
    <svg
      className={`dol dol-${moment}`}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`dol-g-${moment}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--basalt-raised)" />
          <stop offset="1" stopColor="var(--basalt)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="35" height="35" rx="11" fill={`url(#dol-g-${moment})`} className="dol-body" />
      <rect x="8" y="5" width="20" height="4" rx="2" className="dol-accent" />
      {uncertain ? (
        <>
          <rect x="11.5" y="15.3" width="3" height="1.4" rx="0.7" fill="rgb(255 255 255 / 90%)" />
          <rect x="21.5" y="15.3" width="3" height="1.4" rx="0.7" fill="rgb(255 255 255 / 90%)" />
        </>
      ) : (
        <>
          <circle cx="13" cy="16" r="1.5" fill="rgb(255 255 255 / 92%)" />
          <circle cx="23" cy="16" r="1.5" fill="rgb(255 255 255 / 92%)" />
        </>
      )}
      <circle cx="10" cy="22" r="1.5" fill="var(--tangerine)" opacity="0.85" />
      <circle cx="26" cy="22" r="1.5" fill="var(--tangerine)" opacity="0.85" />
      {moment === "riding" ? (
        <path d="M14 24.5 Q18 28.5 22 24.5" stroke="rgb(255 255 255 / 80%)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      ) : moment === "arrived" ? (
        <path d="M13 24 Q18 29 23 24" stroke="rgb(255 255 255 / 90%)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      ) : moment === "prepare" ? (
        <circle cx="18" cy="26" r="1.5" fill="rgb(255 255 255 / 80%)" />
      ) : moment === "nextStop" || moment === "passedDestination" ? (
        <rect x="16.4" y="23.5" width="3.2" height="5" rx="1.6" fill="rgb(255 255 255 / 85%)" />
      ) : (
        <rect x="14.5" y="25.3" width="7" height="1.4" rx="0.7" fill="rgb(255 255 255 / 72%)" />
      )}
    </svg>
  );
}

export function CitrusDot({ size = 10 }: { size?: number }) {
  return <span className="citrus-dot" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function RouteBadge({
  number,
  role,
  compact = false,
}: {
  number: string;
  role: ColorRole | "neutral";
  compact?: boolean;
}) {
  return (
    <span className={`route-badge role-${role}${compact ? " route-badge-compact" : ""}`}>
      <span className="visually-hidden">버스 </span>
      {number}
      <span className="visually-hidden">번</span>
    </span>
  );
}

/** The journey rail: filled in the moment colour, ending at the tangerine destination. */
export function JourneyRail({ progress, role }: { progress: number; role: ColorRole }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <span className={`journey-rail role-${role}`} aria-hidden="true">
      <span className="journey-rail-fill" style={{ width: `${pct}%` }} />
      <span className="journey-rail-bus" style={{ left: `${pct}%` }} />
      <CitrusDot size={9} />
    </span>
  );
}

function VehicleIcon({ status }: { status: VehicleStatus }) {
  if (status === "confirmed") return <CheckIcon />;
  if (status === "lost") return <SearchIcon />;
  return <RefreshIcon />;
}

function DataIcon({ status }: { status: DataStatus }) {
  if (status === "live") return <span className="live-dot" aria-hidden="true" />;
  if (status === "offline") return <WifiOffIcon />;
  if (status === "delayed") return <ClockIcon />;
  return <RefreshIcon />;
}

/** Vehicle identity and data freshness, always as two badges, never merged. */
export function TrustBadge(
  props:
    | { kind: "vehicle"; status: VehicleStatus; plate?: string; onDark?: boolean }
    | { kind: "data"; status: DataStatus; onDark?: boolean },
) {
  const tone =
    props.kind === "vehicle"
      ? props.status === "confirmed"
        ? "ok"
        : props.status === "lost"
          ? "degraded"
          : "checking"
      : props.status === "live"
        ? "ok"
        : props.status === "delayed"
          ? "warn"
          : props.status === "offline"
            ? "degraded"
            : "checking";
  return (
    <span className={`trust-badge tone-${tone}${props.onDark ? " on-dark" : ""}`}>
      {props.kind === "vehicle" ? <VehicleIcon status={props.status} /> : <DataIcon status={props.status} />}
      <span>
        {props.kind === "vehicle" ? vehicleLabel(props.status) : dataLabel(props.status)}
        {props.kind === "vehicle" && props.status === "confirmed" && props.plate ? (
          <span className="trust-plate"> {props.plate}</span>
        ) : null}
      </span>
    </span>
  );
}

/** The count when it may be shown; otherwise the moment's symbol. Last-known counts are dimmed and labelled. */
export function CountOrSymbol({
  presentation,
  remaining,
  size = "md",
}: {
  presentation: MomentPresentation;
  remaining: number;
  size?: "sm" | "md" | "lg";
}) {
  if (presentation.count === "hidden") {
    return (
      <span className={`count-symbol count-${size}`} aria-hidden="true">
        <MomentIcon symbol={presentation.symbol} />
      </span>
    );
  }
  return (
    <span className={`count count-${size}${presentation.count === "lastKnown" ? " count-last-known" : ""}`} aria-hidden="true">
      <span className="count-number">{remaining}</span>
      <span className="count-unit">
        {presentation.count === "lastKnown" ? IOS_COPY["count.lastKnown"] : IOS_COPY["count.unit"]}
      </span>
    </span>
  );
}

/** Labels every simulated device, so no one mistakes it for a working browser product. */
export function PreviewTag({ children = "제품 미리보기 · 합성 데이터" }: { children?: string }) {
  return <span className="preview-tag">{children}</span>;
}

import type { ReactElement, SVGProps } from "react";
import type { MomentSymbol } from "../demo/rideMoments.ts";

/**
 * Line icons drawn for the web. Each stands in for the SF Symbol the app uses
 * for the same moment (`RideGuidance.symbolName`); they are always paired with
 * words, so every icon is hidden from assistive technology.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BusIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="15" rx="3.5" />
    <path d="M5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 18v2.5M16 18v2.5" />
  </Svg>
);

export const StandIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="4.5" r="2" />
    <path d="M12 8v7M8.5 11.5 12 9l3.5 2.5M10 21l2-6 2 6" />
  </Svg>
);

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const WalkIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="13" cy="4.5" r="2" />
    <path d="m9 21 2.5-6.5L14 17v4M7.5 12l2.5-3.5h3.5l2.5 3.5M11.5 14.5 13 8.5" />
  </Svg>
);

export const UturnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.35-5.65" />
    <path d="M20 4v4h-4M12 8v4l2.5 2" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);

export const WifiOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18M8.6 12.9a5 5 0 0 1 5.2-.9M5.3 9.6A9.9 9.9 0 0 1 9 7.4M12.2 7a10 10 0 0 1 6.6 2.7M12 17.5h.01" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5" />
    <path d="M4 4v4.5h4.5M20 20v-4.5h-4.5" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.6} />
  </Svg>
);

export const TimerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="13.5" r="7" />
    <path d="M12 13.5V9.5M10 3h4M18.5 7.5l1.5-1.5" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 6.5 6-2.5 6 2.5 6-2.5v13.5L15 20l-6-2.5L3 20V6.5Z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

export const GitHubIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.09.68-.22.68-.49 0-.24-.01-1.05-.02-1.9-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.95a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.95.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
  </svg>
);

const MOMENT_ICONS: Record<MomentSymbol, (p: IconProps) => ReactElement> = {
  bus: BusIcon,
  stand: StandIcon,
  bell: BellIcon,
  walk: WalkIcon,
  uturn: UturnIcon,
  clock: ClockIcon,
  search: SearchIcon,
  wifiOff: WifiOffIcon,
  refresh: RefreshIcon,
};

export function MomentIcon({ symbol, ...props }: IconProps & { symbol: MomentSymbol }) {
  const Icon = MOMENT_ICONS[symbol];
  return <Icon {...props} />;
}

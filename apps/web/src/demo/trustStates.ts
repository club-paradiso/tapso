import { IOS_COPY } from "./rideCopy.ts";
import {
  presentMoment,
  type CountPresentation,
  type DataStatus,
  type MomentSymbol,
  type RideMoment,
  type VehicleStatus,
} from "./rideMoments.ts";

/**
 * The "trust when data is imperfect" demo.
 *
 * Each state shows the two signals the app keeps apart — is this the right bus
 * (vehicle identity) and is the information current (data freshness) — and
 * whether a get-off alert may fire. Ride states come straight from
 * `presentMoment`; the similar-buses state is the pre-ride question.
 */

export type TrustStateId = "confirmed" | "checking" | "similarBuses" | "delayed" | "vehicleLost" | "offline";

export type TrustState = {
  id: TrustStateId;
  label: string;
  /** Present for ride states; the similar-buses question happens before the ride starts. */
  moment?: RideMoment;
  vehicle: VehicleStatus;
  data: DataStatus;
  headline: string;
  detail: string;
  count: CountPresentation;
  symbol: MomentSymbol;
  /** Whether TAPSO may send a get-off alert in this state. */
  alertsAllowed: boolean;
  explanation: string;
};

function fromMoment(
  id: TrustStateId,
  moment: RideMoment,
  label: string,
  explanation: string,
): TrustState {
  const p = presentMoment(moment);
  return {
    id,
    label,
    moment,
    vehicle: p.vehicle,
    data: p.data,
    headline: p.headline,
    detail: p.detail,
    count: p.count,
    symbol: p.symbol,
    // Riding itself carries no alert; it is the state from which the
    // two-stop, next-stop and arrival alerts are allowed to fire.
    alertsAllowed: moment === "riding",
    explanation,
  };
}

export const TRUST_STATES: readonly TrustState[] = [
  fromMoment(
    "confirmed",
    "riding",
    "차량 확인됨 · 실시간",
    "맞는 버스, 최신 정보. 이때만 2정거장·다음 하차·도착 알림이 나가요.",
  ),
  fromMoment(
    "checking",
    "checking",
    "다시 확인 중",
    "정보끼리 맞지 않거나 확실하지 않으면 남은 정거장을 숨기고, 확실해질 때까지 알림을 멈춰요.",
  ),
  {
    id: "similarBuses",
    label: "비슷한 버스",
    vehicle: "rechecking",
    data: "live",
    headline: IOS_COPY["check.similarBuses.headline"],
    detail: IOS_COPY["check.similarBuses.detail"],
    count: "hidden",
    symbol: "bus",
    alertsAllowed: false,
    explanation: "그럴듯한 버스가 두 대면 대신 고르지 않아요. 여정은 탑승자가 고른 뒤에 시작돼요.",
  },
  fromMoment(
    "delayed",
    "delayed",
    "정보 지연",
    "버스는 맞지만 정보가 늦어요. 마지막으로 확인한 정거장 수를 흐리게 보여주고, 알림은 보내지 않아요.",
  ),
  fromMoment(
    "vehicleLost",
    "vehicleLost",
    "버스 놓침",
    "정보는 들어오는데 내 버스가 잠시 안 보여요. 다른 버스로 몰래 바꾸지 않고 그 버스를 계속 기다려요.",
  ),
  fromMoment(
    "offline",
    "offline",
    "오프라인",
    "휴대폰 연결이 끊겨도 차량 확인은 그대로예요. 연결되면 바로 이어서 추적해요.",
  ),
];

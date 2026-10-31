import { beat, type BeatId } from "./beats.ts";

/** Navigation and summary copy only; all previews resolve the canonical BEATS. */
export const MOBILE_STAGES: readonly { beatId: BeatId; label: string; title: string; body: string }[] = [
  { beatId: "destination", label: "목적지", title: "목적지 선택", body: "정류장, 주소, 건물 이름으로 내릴 곳을 찾아요. 지도 앱에서 공유한 장소로도 시작할 수 있어요." },
  { beatId: "boarding", label: "버스·정류장", title: "버스와 타는 정류장 선택", body: "내릴 곳으로 가는 노선과 방향, 타는 정류장을 골라요. 목적지까지 몇 정거장인지 보여줘요." },
  { beatId: "proposed", label: "탄 버스", title: "내가 탄 버스 확인", body: "번호판 끝자리를 보고 실제로 탄 버스를 직접 확인해요. 자동 선택은 꺼져 있어요." },
  { beatId: "pocket", label: "하차 안내", title: "하차 안내 확인", body: "버스를 확인한 뒤 남은 정거장과 내릴 때를 잠금 화면과 다이나믹 아일랜드에서 확인해요." },
];
export const MOBILE_RIDE_VIEWS: readonly { beatId: BeatId; label: string }[] = [
  { beatId: "pocket", label: "잠금 화면" },
  { beatId: "island", label: "아일랜드" },
  { beatId: "prepare", label: "2정거장 전" },
  { beatId: "nextStop", label: "다음 하차" },
  { beatId: "arrived", label: "도착" },
];
export function mobileBeat(stageIndex: number, rideView: BeatId = "pocket") {
  const stage = MOBILE_STAGES[stageIndex] ?? MOBILE_STAGES[0]!;
  const id = stage.beatId === "pocket" && MOBILE_RIDE_VIEWS.some((view) => view.beatId === rideView) ? rideView : stage.beatId;
  return beat(id);
}

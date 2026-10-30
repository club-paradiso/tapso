# Website development status: evidence map

The `#status` section of the marketing site (`apps/web/src/sections/Status.tsx`, copy in `apps/web/src/content/site.ts`) shows what has been built and how far each part has been checked. This file records where each item's level comes from. The machine-readable form is `apps/web/test/statusEvidence.ts`; `apps/web/test/statusHonesty.test.ts` checks that every item has an entry and that every path in it exists.

Observed 2026-10-30 on `main` at `6138a4b`. A level may only go up when new evidence is added here and in `statusEvidence.ts`.

## Levels shown on the page

| Page label | Internal level | Meaning | Needs |
|---|---|---|---|
| 구현됨 | `built` | In code, covered by automatic tests or simulator snapshots. Not seen on a real iPhone or bus | code + test |
| 실데이터 확인 | `realdata` | Same, and the data path was observed against real Jeju bus data in production | an `ops` observation |
| 검증 중 | `verifying` | Being checked; no result yet | none |
| 준비 중 | `blocked` | Waits on an account, credential or release step | none |
| 실기기 확인 | `device` | Seen working on a real iPhone | a file under `artifacts/device-validation/` other than `README.md` and `TEMPLATE.md` |

No item uses `device`: that directory holds only `README.md` and `TEMPLATE.md`. The test fails if an item claims it without a file there.

The seven internal states in the brief map onto these levels. Implemented and automatic-test-passed both fold into `built`, because the repository cannot show one without the other. Real-data and production checks fold into `realdata`. A real-device check is `device`. In progress is `verifying`; waiting on external accounts, credentials or release steps is `blocked`.

## Items

| Item (page title) | Group | Level | Evidence | Not checked |
|---|---|---|---|---|
| 내릴 곳 검색 | built | realdata | `CatalogSearchViews.swift`, `PlaceLookupViews.swift`; README: catalog `794f3bcb831d783e`, 989 variants, 4,338 stops; release gate 3 | Search screens on an iPhone. Address and building lookup uses Apple Maps on the phone |
| 노선, 방향, 탈 정류장 고르기 | built | realdata | `apiRouter.ts`, `LIVE_JOURNEY_V3.md`; `/health` on 2026-10-30 shows Redis sessions on, namespace production; post-deploy smoke 19/19 and session lifecycle 8/8 on 2026-10-20 | The selection screens on an iPhone |
| 잠금 화면과 다이나믹 아일랜드 | built | built | `SnapshotEvidenceTests.swift`, `RidePresentationTests.swift`; CI job `ios` renders ko, en, zh-Hans and ja on a simulator | Real Dynamic Island hardware |
| 지도 앱 연동 | built | built | `ShareExtension`, `MapHandoffFlowTests.swift` | Share extension from KakaoMap, NAVER Map, Apple Maps on an iPhone (README: `UNVERIFIED`) |
| 막차와 내릴 곳을 지났을 때 | built | built | `JEJU_SAFETY_LAYER_V3.md`; README: TAGO publishes no last departure for the 58 checked Jeju variants, so the app says it is unknown | Both flows on an iPhone; no real last-bus time exists |
| 탄 버스 확인과 남은 정거장 | verifying | verifying | `matching.ts`, `matchingReadiness.ts`; `/health`: mode `shadow`, automatic matching off, `READY_FOR_SHADOW`; `ROADMAP.md`: zero observed boardings | Any real boarding |
| 언어, 접근성, 개인정보 | verifying | verifying | `check_localization.py` (four languages); `PRIVACY.md`; `KNOWN_ISSUES.md`: zh-Hans and ja not native-reviewed | Native review; VoiceOver on a device (`ROADMAP.md` item 9) |
| 앱을 닫아도 이어지는 안내 | remaining | blocked | `/health`: `apns.enabled: false`, five `APNS_*` values missing; `LIVE_ACTIVITY_PUSH.md` | Any push delivered to a device |
| 실제 iPhone과 버스에서 테스트 | remaining | blocked | `DEVICE_TEST_PLAN.md`, `beta/FREE_TEAM_FIELD_TEST.md`; `artifacts/device-validation/` holds no evidence | Everything |
| TestFlight와 App Store | remaining | blocked | `TESTFLIGHT.md`: only a free Personal Team; `ROADMAP.md` item 10 | No App Store Connect record, privacy policy URL or upload |

## Before and after

| Before | After |
|---|---|
| Title 지금은 여기까지 만들었어요. | TAPSO는 지금 이렇게 만들어지고 있어요 |
| One flat list of 10 items with 완료 / 진행 중 / 준비 중 / 그다음 | Three groups: 지금까지 만든 기능 (5), 지금 검증하는 기능 (2), 출시까지 남은 단계 (3); five labels tied to evidence |
| "Product V2 · iOS 앱 흐름" marked 완료, "합성 데이터로 테스트" | Removed. Live Jeju data is connected and is named per feature |
| 제주 실시간 버스 데이터 "운영 서버에서 여정 기능을 켜는 설정이 남았어요" | Stale: production has served Redis sessions since 2026-10-03. Folded into 노선, 방향, 탈 정류장 고르기 |
| 버스 확인 안전성 검증 | Merged into 탄 버스 확인과 남은 정거장; states that no real boarding has been checked |
| TestFlight "사전예약한 분께 먼저 메일을 보낼게요" | Removed: waitlist storage and mail delivery are not verified (`WAITLIST_SUPPORT_SETUP.md`) |
| 실제 iPhone 테스트: "Apple Developer Program을 준비한 뒤" | States that the procedure is ready and no device record exists |

## Known gaps

- The page does not say that `main` currently fails the `ios` job's brand check (`Header.tsx` must keep the visual wordmark). That is a code issue, not a product status.
- Open PR #175 also rewrites the status section and hides the waitlist form. Whichever merges second must reconcile `site.ts` and `Status.tsx`.
- Re-check `/health`, `artifacts/device-validation/` and `ROADMAP.md` before changing any level.

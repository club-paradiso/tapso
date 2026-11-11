# 제주 교통 공개데이터 검증 (2026-11-11 KST)

## 검증 결과

2026-11-11 17:26~17:35 KST에 공공데이터포털 상세 페이지와 배포처 링크를 확인했다. Work 브라우저에서 제주 교통정보센터 신청 안내, 제주데이터허브 상세 페이지, 제주 BIS, 교통카드 빅데이터 시스템에 접근했다. 제주 ITS DOCX 2종, C-ITS PDF, BIS XLSX를 다운로드해 명세를 확인했다.

| 자료 | 포털 수정일 | 공시 형식 | 인증·실측 | 판정 |
| --- | --- | --- | --- | --- |
| [실시간 교통정보 15093660](https://www.data.go.kr/data/15093660/openapi.do) | 2026-10-15 | JSON | ITS 승인 및 키 필요. 무키 HTTP 타임아웃, HTTPS 게이트웨이 503. | `BLOCKED_BY_APPROVAL`, `BLOCKED_BY_NETWORK` |
| [교통정보 1시간 통계 15093668](https://www.data.go.kr/data/15093668/openapi.do) | 2026-10-15 | JSON | 같은 ITS 절차. 무키 HTTP 타임아웃, HTTPS 게이트웨이 503. | `BLOCKED_BY_APPROVAL`, `BLOCKED_BY_NETWORK` |
| [C-ITS 교통정보 15079829](https://www.data.go.kr/data/15079829/openapi.do) | 2026-04-06 | XML | C-ITS 신청 및 키 필요. 위험·통제·작업·노면 4개 주소에서 무키 HTTP 타임아웃, HTTPS 게이트웨이 503. | `BLOCKED_BY_APPROVAL`, `BLOCKED_BY_NETWORK` |
| [BIS 15058442](https://www.data.go.kr/data/15058442/openapi.do) | 2026-10-15 | 포털 XML, [제주 BIS XLSX 가이드](https://www.jeju.go.kr/help/open.htm?act=view&seq=967654) JSON | 가이드의 노선·정류소·차량 조회에는 키 파라미터가 없다. HTTPS 3건은 게이트웨이 503. | `BLOCKED_BY_NETWORK` |
| [일일 정류소 15074262](https://www.data.go.kr/data/15074262/openapi.do) / [Hub 613](https://www.jejudatahub.net/data/view/data/613) | 2026-10-15 | JSON | 프로젝트 키 필요. 테스트 요청은 방화벽 HTML(HTTP 200). | `BLOCKED_BY_AUTH`, `BLOCKED_BY_NETWORK` |
| [일일 노선 15074260](https://www.data.go.kr/data/15074260/openapi.do) / [Hub 614](https://www.jejudatahub.net/data/view/data/614) | 2026-10-15 | JSON | 프로젝트 키 필요. 테스트 요청은 방화벽 HTML(HTTP 200). | `BLOCKED_BY_AUTH`, `BLOCKED_BY_NETWORK` |
| [월간 시간별 승객 15074257](https://www.data.go.kr/data/15074257/openapi.do) / [Hub 615](https://www.jejudatahub.net/data/view/data/615) | 2026-10-15 | JSON | 프로젝트 키 필요. 테스트 요청은 방화벽 HTML(HTTP 200). | `BLOCKED_BY_AUTH`, `BLOCKED_BY_NETWORK` |
| [일별 시간대별 승차 Hub 512](https://www.jejudatahub.net/data/view/data/512) | 2025-10-28 | CSV | 브라우저에서 과거 미리보기 및 파일 다운로드 완료 알림 확인. 실행 환경에서 파일 본문 전체 미검사. 페이지 공시 기간 2018-06-03~2025-10-19. | `METADATA_ONLY` (전체 파일 기준) |

포털 7종에 이용허락범위 제한 없음이 표시된다. 원본 사이트의 인증과 사용 조건은 별개다. 제주데이터허브 613~615 페이지에는 수집기간 2015-01-01~2015-01-01과 자동갱신(일 또는 월)이 함께 표시된다. 이를 최신 API 자료의 범위로 해석하지 않는다. 512 미리보기는 일자·요일·시간대·이용자 유형·인원수만 노출하며 노선과 차량 키가 없다. [교통카드 빅데이터 시스템](https://stcis.go.kr/)에서 Open API 메뉴를 확인했으며 제주 집계 원본의 접근과 이용 조건은 미검증이다.

전 항목의 실제 최신 관측시각(`sourceObservedAt`), 데이터 갱신일(`datasetUpdatedAt`), 원본 수신시각(`sourceFetchedAt`), 적용일(`effectiveDate`), 운영 데이터 버전(`sourceVersion`), 실측 갱신주기 및 쿼터는 확인하지 못했다. 512의 페이지 공시 종료일과 미리보기 일자는 원본 전체에서 관측된 최신 날짜와 구분한다.

## 공식 요청 계약과 제한

- [제주 교통정보센터](https://jejuits.go.kr/open_api/open_apiView.do)는 접수 → 검토 → 승인 및 키 발급 절차와 ITS/C-ITS 신청 버튼을 안내한다. 상세 화면은 `api.jejuits.go.kr`의 HTTP 주소를 안내한다. `GET /api/getFrafficInfo`는 `code`와 표준 노드·링크 `type=L`을 사용한다. `GET /api/getFrafficInfoHourlyStat`은 여기에 통계일시 `statDt`(예시 `YYYYMMDDHH`)를 추가한다. 웹 명세에는 `Info`, DOCX 공통표에는 `info`로 기재됐다. 코드는 웹 예시를 기준으로 하며 실제 응답으로 대소문자, 시각대, 시간 구간 의미, 단위, 누락값 표기를 다시 검증해야 한다.
- C-ITS는 같은 호스트의 `infoRoadEventList`, `infoRoadCloseList`, `infoRoadWorkList`, `infoRwisList`를 `code`로 조회하도록 안내한다. 표에는 링크, 좌표, 방향 및 유형 정보가 있으나 관측·종료시각의 명세가 없고 노면 상태 코드가 PDF와 웹 상세에서 다르다. 관측·만료 기준과 코드 체계가 확인되면 이벤트 노출을 검토한다.
- BIS 가이드는 `bus.jeju.go.kr`의 HTTP `/api/searchBusRouteList.do`, `/api/searchBusRouteStationList.do?route_id=…`, `/api/searchBusAllocList.do` 등을 문서화한다. `LOW_PLATE_TP` 및 `VH_ID`가 명시돼 있으나 차량 관측시각과 TAGO 차량 식별자 매핑은 확인되지 않았다. 차량번호로 임의 매칭하거나 노선 번호만으로 저상차량을 안내하지 않는다.
- 제주데이터허브 613~615는 상세 화면에 `open.jejudatahub.net/api/proxy/…/{your_projectKey}`와 데이터셋별 파라미터·미리보기를 표시한다. 승인된 프로젝트 키로 동일 기간을 조회해 최신 집계일, 중복, 집계 단위와 승차·환승 구분을 확인해야 한다.
- ITS/C-ITS에 승인 키를 제출할 때는 제공기관에서 확인한 안전한 전송 경로를 사용한다. HTTP 명세만으로 실서비스에서 비밀을 전송할 수 없으며, HTTPS 게이트웨이 오류는 제공기관의 HTTPS 지원 여부를 확정하는 증거가 아니다.

## 제주 노선 파일럿

운영 TAPSO API(`/health` 응답 빌드 `4c2974dfb885`, 매칭 `directed-route-progress-v1`, 자동 선택 OFF)에 도시코드 39로 요청했다. `/v1/routes`에서 접미 번호가 포함된 검색 결과와 정확히 일치하는 번호를 모두 확인했다. 표는 각 번호에 대해 대표 변형 하나를 검사한 결과다.

| 노선 | 발견 변형 (전체 / 정확히 일치) | 표본 TAGO 노선 ID | 정류소 및 카탈로그 순서 | 차량 응답 건수 |
| --- | ---: | --- | --- | ---: |
| 365 | 6 / 6 | `JEB405136521` | 43, 모두 일치 | 5 |
| 202 | 31 / 24 | `JEB405320213` | 168, 모두 일치 | 0 |
| 800 | 7 / 5 | `JEB405680001` | 18, 모두 일치 | 2 |

표본 정류소·차량 호출 6건은 HTTP 200. 202 차량 0건은 표본 응답이다. 이 파일럿은 TAGO 노선·정류소와 차량 응답을 검증했으며 도로 링크 매핑과 운영 ITS 데이터는 검증되지 않았다. 방향별 도로 경로를 확인하기 전까지 정류소 간 직선은 링크 매핑에 사용하지 않는다.

## 코드와 재현

`scripts/data-sources/jeju-its-evidence.ts`는 허가받아 저장한 JSON을 오프라인에서 검사한다. 실행 시 가공시각 또는 시간 구간, 행과 링크 개수, 중복을 요약한다. 제주 현지 시각(KST)으로 해석하는 가정은 실제 공급 응답으로 확인해야 한다. 관측시각은 항상 `null`이다. 값이 충돌하는 동일 링크·시각이나 스키마 오류는 실패로 처리하고, 원문과 키를 로그에 남기지 않는다.

```sh
node scripts/data-sources/jeju-its-evidence.ts realtime /path/to/approved-response.json
node scripts/data-sources/jeju-its-evidence.ts hourly /path/to/approved-response.json
node --experimental-strip-types --test services/api/test/jejuItsEvidence.test.ts
```

TAPSO 운영 코드에서 이 도구를 호출하는 경로는 없다. 사용자 노출, 외부 API 설정, 자동 수집 워크플로를 추가하려면 공식 원본과 안전한 접근을 확보하고 실측 및 방향별 링크 검증을 완료해야 한다.

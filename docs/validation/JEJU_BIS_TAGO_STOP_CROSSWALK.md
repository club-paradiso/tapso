# TAGO ↔ 제주버스정보시스템 stop crosswalk

Can a TAGO stop id (`JEB405000315`) be turned into the station id the official 제주버스정보시스템 (BIS) passenger pages use (`405000315`) by stripping `JEB`? TAPSO needs the BIS id only to open the official 교통약자 승차예약 page for the rider's exact pole (`exec-plans/BOARDING_ANCHOR_POSITION_V2.md` §2). The hypothesis is never assumed: a pole gets a BIS id only when official evidence verifies that exact pole.

## Method

1. **Structure (offline, committed catalog `794f3bcb831d783e`).** `scripts/crosswalk/jeju-stop-crosswalk.ts` classifies every catalog stop with `services/api/src/stopCrosswalk.ts`: id form, direction marker, sibling poles (same place name within 150 m), stops sharing a full name, coordinates, route membership.
2. **Page structure (probe).** `.github/workflows/jeju-stop-crosswalk.yml` read six official passenger pages (`/mobile/station/detailStation/<id>?type=station&mode=ridebooking`), because the agent environment's egress policy denies `bus.jeju.go.kr`. Findings (2026-10-06, runs 1 and 2-attempt-2; run 2's first attempt timed out at TCP level on every request and is not evidence):
   - the site's own `goStationPage()` navigates to exactly this URL form;
   - the page server-renders `<input type="hidden" name="stationId" value="…">`, `<td colspan="3" class="station-name"> 노형주공아파트[동] </td>` (Korean with `accept-language: ko-KR`, English otherwise: "Yongmun 4-way Intersection[E]") and "`<name> <id> | <station> 방향`";
   - an id the site does not know still answers **HTTP 200**, with no station-name cell ("405009999 | 종점"): a status code proves nothing;
   - no coordinates are in the page (they arrive through the site's undocumented `/data/search/getNewStationInfoByStationId`, which this audit does not call);
   - the reservation is the site's `reservationTrafficWeak` request after a 제주버스 login, with 장애인 · 임산부 · 노약자 · 영유아동반 · 어린이 · 일반.
   - For all five probed catalog poles (both opposite-pole pairs included: 용문사거리[동]/[서] = `JEB405000314`/`315`, 노형주공아파트[서]/[동] = `JEB405000006`/`007`, and 롯데호텔 `JEB406000002`) the stripped id named the same pole with the same marker, and the "방향" station was the catalog's next stop on a variant through that pole.
3. **Evidence (island-wide).** `.github/workflows/jeju-stop-crosswalk-audit.yml`, triggered by `ops/jeju-stop-crosswalk/request.json`, reads the passenger page for every stop's candidate (sequential, ≥ 1.2 s apart, stops after ten consecutive failures), parses it with `parseStationPage`, and commits `artifacts/jeju-stop-crosswalk/evidence.json`, `summary.json` and the regenerated `JejuStopCrosswalkData.swift` to the requesting branch, never to `main`.

## Classification

| Status | Rule | Used by the app |
|---|---|---|
| `VERIFIED_EXACT` | The candidate's page names the exact pole (marker included) **and** either its coordinates are within 30 m or its "방향" station is the catalog's next stop on a variant through this pole | yes, re-checked on the phone against the current name and a 30 m position |
| `VERIFIED_BY_NAME_COORDINATE` | Same place with position or direction agreeing, name differs in form (e.g. no marker), no sibling pole within 150 m | no |
| `AMBIGUOUS` | Neither coordinates nor a matching direction; 30–100 m apart; or a marker-less name with a sibling pole nearby | no |
| `MISSING` | No station on the page for the candidate, or the TAGO id lacks the `JEB405/JEB406` form | no |
| `CONFLICT` | Different place name, opposite direction marker, or more than 100 m apart: the stripping assumption is wrong for this stop | no |
| `UNCHECKED` | No evidence collected or the read failed | no |

The direction rule is what separates a pole from another stop elsewhere with the identical name and marker: 1,510 catalog stops share their full name with another stop.

## Structural results (no evidence; `MEASURED` from the committed catalog)

| Measure | Value |
|---|---:|
| Stops | 4,338 |
| TAGO ids of the `JEB40[56]` + 6-digit form | 4,338 |
| Distinct stripped candidates (collisions) | 4,338 (0) |
| Stops with a direction marker | 2,493 |
| Stops with coordinates | 4,338 |
| Place names with more than one pole | 1,784 |
| Poles with a same-name sibling within 150 m | 3,596 (83 %) |
| Stops sharing a full name with another stop | 1,510 |

So name-only matching would be wrong for most of the island: only an id-specific page that names this pole and faces this pole's next stop is accepted.

## Island-wide results

Pending the audit run requested on 2026-10-06; this section is filled from `artifacts/jeju-stop-crosswalk/summary.json` when it lands. Until then `JejuStopCrosswalk.shipped` is empty and no reservation card appears.

## Limits

- Evidence is dated; a renamed or moved pole fails closed on the phone (name and 30 m checks) until the audit is re-run.
- The page's markup can change; the parser fails closed (`read_failed` without an echoed id, `not_found` without a name cell).
- Probe and audit evidence come from GitHub-hosted runners, not from this environment. No personal or vehicle data is read or stored.

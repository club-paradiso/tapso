# Jeju Route 365 live-transit validation — 2026-09-10

Status: `TAGO_ROUTE_VARIANTS_CONFIRMED`

This report intentionally contains no service key, request URL containing a key, or raw vehicle identifiers from a live capture.

## Verified official metadata

- Public Data Portal resource `15157601` is described by the portal as nationwide ultra-precision realtime bus information.
- TAPSO's current B551982 provider base URL is `https://apis.data.go.kr/B551982/rte`.
- The inspected B551982 contract exposes `/mst_info`, `/ps_info`, and `/rtm_loc_info`.
- Jeju's official passenger interface currently lists Route 365.
- TAGO bus route information (`15098529`) and TAGO bus location information (`15098533`) are the official fallback sources selected for Jeju validation.

## Authenticated B551982 finding

On 2026-09-10 the operator loaded the newly issued service key in a local shell without exposing it and successfully reached the B551982 route-master endpoint through TAPSO's provider. Authentication succeeded, but `/mst_info` returned zero route-master records for every tested Jeju-oriented `stdgCd` candidate:

| Tested `stdgCd` | `/mst_info` normalized route count | 365 candidate |
|---|---:|---|
| `50110` | 0 | none |
| `5011000000` | 0 | none |
| `50` | 0 | none |
| `5000000000` | 0 | none |

This does not prove that B551982 contains no Jeju data under every internal mapping. It proves that valid authenticated requests returned no route-master rows for the four tested Jeju-oriented values.

## Authenticated TAGO route discovery finding

The operator then queried the official TAGO bus route service with the same locally protected service key. After an initial transient provider-side `99` session-capacity error, a subsequent request returned `resultCode=00 / NORMAL SERVICE.` for `cityCode=39` and route number `365`.

The official TAGO response returned six Route 365 variants:

| TAGO `routeid` | Route No. | Start | End | Reported `routetp` |
|---|---:|---|---|---|
| `JEB405136521` | 365 | 제주대학교 | 제주한라대학교(종점) | 급행버스 |
| `JEB405136522` | 365 | 제주한라대학교 | 제주대학교 | 급행버스 |
| `JEB405136523` | 365 | 영주고등학교 | 제주한라대학교(종점) | 급행버스 |
| `JEB405136524` | 365 | 제주한라대학교 | 영주고등학교 | 급행버스 |
| `JEB405136525` | 365 | 월성마을/선사유적지 | 제주대학교 | 급행버스 |
| `JEB405136530` | 365 | 제주대학교병원 | 제주한라대학교(종점) | 급행버스 |

Therefore:

- TAGO Jeju `cityCode=39` is now `VERIFIED_FROM_AUTHENTICATED_OFFICIAL_RESPONSE`;
- the previous third-party 6522-family observation is now corroborated by the official TAGO response, specifically `JEB405136522` for 제주한라대학교 → 제주대학교;
- Route 365 is not represented by a single route ID in TAGO; TAPSO must model route variants explicitly;
- the two primary full-length directions appear to be `JEB405136521` (제주대학교 → 제주한라대학교) and `JEB405136522` (제주한라대학교 → 제주대학교), while the remaining IDs are short-turn / partial variants based on their endpoints;
- the `routetp=급행버스` field should not be used as a product-level truth without corroboration because all six 365 variants received the same label. Route identity and variant selection should rely primarily on `routeid`, route number, and endpoint / stop topology.

## Remaining live validation questions

| Question | Result |
|---|---|
| Newly issued key accepted by B551982 resource 15157601 | `VERIFIED` |
| B551982 `/mst_info` returns Route 365 for tested Jeju codes | `NO` |
| TAGO Jeju city code | `39 — VERIFIED` |
| TAGO official Route 365 IDs | `6 VARIANTS — VERIFIED` |
| Primary full-length direction IDs | `LIKELY 6521 / 6522 FROM OFFICIAL ENDPOINTS; LIVE STOP TOPOLOGY STILL TO CONFIRM` |
| TAGO live vehicle positions | `PENDING` |
| Realtime provider refresh cadence | `UNVERIFIED` |
| Vehicle identifier continuity | `UNVERIFIED` |
| Active vehicle count stability | `UNVERIFIED` |
| Coordinate continuity | `UNVERIFIED` |
| Stop-order availability | `UNVERIFIED` |
| Temporary disappearance / reappearance | `UNVERIFIED` |

## Repository implications

1. Do not continue guessing B551982 `stdgCd` values for Jeju.
2. Add a TAGO-backed provider behind the same transit-provider boundary rather than leaking TAGO DTOs into journey-session logic.
3. Treat `routeNumber=365` as a route family, not a unique route key. Preserve the official TAGO `routeid` for each direction / short-turn variant.
4. Resolve and cache route topology per `routeid` so full-length and short-turn variants cannot be silently mixed.
5. Do not use the reported `routetp` as the sole classifier for user-facing route type.
6. TAGO's documented bus-location response does not expose a provider observation timestamp comparable to B551982 `gthrDt`; cadence analysis must distinguish polling time from snapshot-content changes.
7. Only after repeated live vehicle snapshots should TAPSO tune cache TTL, missing-vehicle grace, matcher freshness, or proximity radius.

## Exact next action

Query TAGO `BusLcInfoInqireService/getRouteAcctoBusLcList` for `cityCode=39` across all six official Route 365 IDs. Start with the two apparent full-length directions (`JEB405136521`, `JEB405136522`) and confirm that live vehicle records return coordinates, vehicle identifiers, and stop-order information. Then run bounded repeated polling and measure snapshot-change cadence, continuity, dropout, and active-vehicle-count behavior. Preserve raw vehicle captures locally and commit only sanitized aggregates.

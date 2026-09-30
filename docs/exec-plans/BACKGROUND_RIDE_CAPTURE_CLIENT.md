# Background ride-capture client cutover

> **Status, 2026-09-29.** Historical plan for a legacy ride flow. Human rides
> are no longer a release requirement: release gate
> `matcher-passive-safety-v4` decides matcher readiness from machine-produced
> evidence, and no level up to `READY_FOR_CONFIRMATION_ASSISTED` needs a ride,
> stop marker or capture export
> ([`../validation/MATCHER_SAFETY_EVIDENCE_V4.md`](../validation/MATCHER_SAFETY_EVIDENCE_V4.md),
> [`HUMAN_LABOR_ELIMINATION.md`](HUMAN_LABOR_ELIMINATION.md)). The Railway
> collector and these pages remain, and serve only the legacy flows: an
> operator ride can count only toward `broad-real-mode-30-boardings-v1` and a
> beta ride only toward `beta-matcher-30-boardings-v2`, both historical, with
> zero observed boardings. The cutover criterion at the end is not a release
> requirement.

## Goal

Move controlled-ride provider polling off mobile Safari and onto the dedicated Railway collector while preserving rider-entered physical stop markers as the only ground truth.

## Reality and constraints

- The Railway collector is process-owned and polls TAGO every 5 seconds independently of browser visibility.
- Active sessions are memory-only in the first version. A collector process restart invalidates the session; the client must report that loss instead of fabricating continuity. *(2026-09-29: still true for operator rides only. Beta rides are journaled to Upstash and resumed after a restart, as deterministic restart tests show; the real-iPhone restart path is unverified. See `BETA_FIELD_TESTER.md`, "Restart durability".)*
- TAGO still exposes no provider observation timestamp. Receipt-side unchanged duration remains evidence for Task C, not a freshness rule.
- The background collector currently supports only non-wrapping ride segments. Loop seam crossings fail closed to the existing device-owned recorder.
- The operator token remains in Safari sessionStorage or memory only. It is never placed in a URL, localStorage, IndexedDB, source control, or the sanitized report. *(Open issue, 2026-09-29, not fixed: `background.js` and `quick.js` keep the token in `sessionStorage` or memory, but `services/api/public/ride-capture/acceptance.js` stores it in `localStorage` (`tapso.acceptance.operatorToken`), contrary to this line.)*
- The collector itself requires `TAGO_SERVICE_KEY` and `RIDE_CAPTURE_OPERATOR_TOKEN` in Railway. Those values are operational secrets and are not copied through Git.

## Implementation

1. Keep the current quick recorder at `quick-local.html` as a deterministic fallback.
2. Make `quick.html` a fail-closed launcher. It selects the Railway-backed page only when `/health` explicitly reports both live transit and operator auth configured; otherwise it redirects to the local recorder.
3. Use the existing Vercel operator snapshot only for preflight and exact vehicle identity re-confirmation at the start of the ride.
4. Start one Railway capture with exact `routeId`, `cityCode`, full provider vehicle id, boarding sequence, destination sequence, and the measured 5-second interval.
5. During the ride, the browser polls only collector status for display. TAGO polling belongs to the collector process.
6. Send physical stop, note, and alight timestamps to the collector. A marker is added to the UI only after the server acknowledges it.
7. Preserve duplicate-stop protection. A genuine door reopen requires explicit confirmation and records an explanatory note before the duplicate marker.
8. After alight, wait for the collector to observe the destination or for its 20-second post-alight gate to close. Use only the collector's sanitized report as evidence output.
9. Store only sanitized recent-history metadata on the phone. Raw vehicle identifiers never appear in the report or in the status response.
10. Export the raw capture for replay (2026-09-23). `GET /capture/:sessionId/raw` returns the complete `RideCapture` of one exact, completed session:
    - It requires the operator bearer token, like every other collector route.
    - It answers only a completed session (`409` while active, `404` once pruned or after a restart). There is no listing and no lookup by route or time.
    - It sends `cache-control: no-store, private` and is never logged beyond route and status.
    - The finish screen puts **① 원본(RAW) 저장** first, then **② 요약 리포트 저장**, both under the stem `<routeId>-<startedAt>`. It shows each as "requested", never "saved", because a page cannot see a download land.
    - It shows the two-hour deadline and warns before a new ride if the raw was not requested.
11. One-tap submission (2026-09-23). **검증 데이터 제출** is now the primary action. The RAW/REPORT buttons move under "개발자 / 백업 내보내기". See `FIELD_VALIDATION_SUBMISSION.md`.

## Verification

Relevant deterministic checks:

```bash
npm --prefix services/api test
(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
npm --prefix apps/web test
npm --prefix apps/web run typecheck:vercel
npm --prefix apps/web run build
```

Production cutover is complete only after the Railway service has both required secrets, `/health` reports them configured, and an actual ride demonstrates that snapshot collection continues across an iOS app switch.

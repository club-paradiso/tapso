# Background ride-capture client cutover

## Goal

Move controlled-ride provider polling off mobile Safari and onto the dedicated Railway collector while preserving rider-entered physical stop markers as the only ground truth.

## Reality and constraints

- The Railway collector is process-owned and polls TAGO every 5 seconds independently of browser visibility.
- Active sessions are memory-only in the first version. A collector process restart invalidates the session; the client must report that loss instead of fabricating continuity.
- TAGO still exposes no provider observation timestamp. Receipt-side unchanged duration remains evidence for Task C, not a freshness rule.
- The background collector currently supports only non-wrapping ride segments. Loop seam crossings fail closed to the existing device-owned recorder.
- The operator token remains in Safari sessionStorage or memory only. It is never placed in a URL, localStorage, IndexedDB, source control, or the sanitized report.
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
9. Store only sanitized recent-history metadata on the phone. Raw vehicle identifiers remain server-memory-only for the active session and never appear in the report.

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

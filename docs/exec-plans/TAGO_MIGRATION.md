# TAGO Jeju provider migration

## Outcome and scope
Replace the B551982 runtime adapter with official TAGO route and location services; discover city and route identifiers through official responses. Keep keys server-side and out of Git, logs, and PRs. Open a feature PR and verify CI; do not merge or deploy.

## Verified constraints
- USER_REPORTED_MEASUREMENT: B551982 route master has no Jeju data; do not repeat that investigation.
- VERIFIED_PORTAL_UI (2026-09-10): both development applications approved, expiry 2028-09-10. User authorized license consent; submitted descriptions omit the app name. User key rotation pending.
- VERIFIED_OFFICIAL_SCHEMA: route API resource 15098529 and vehicle API resource 15098533, HTTPS under `/1613000/`; `_type=json`, `cityCode`, and `routeId` parameters. TAGO cityCode is distinct from B551982 stdgCd.
- VERIFIED_OFFICIAL_SCHEMA: locations include vehicleno, gpslati, gpslong, nodeord, nodeid, nodenm. No source observation timestamp is documented. Never substitute receipt time for measured freshness.
- UNVERIFIED: Jeju cityCode, route 365 IDs, actual live vehicle coverage, update cadence.

## Milestones
1. Complete portal applications and user key rotation; store Decoding key in ignored local env (0600).
2. Python urlencode probe: HTTP 200 and resultCode 00; discover Jeju, route 365, stops and vehicle data. Save only credential-free evidence.
3. Replace adapter and city-code contract, add discovery, pagination, safe error handling, conservative unknown freshness and deterministic regression tests.
4. Run API/core and relevant checks, review diff and scan staged files for secrets, push feature branch, create PR and check CI.

## Decisions
Keep the existing provider module path, replace its implementation. Do not map old region codes implicitly or hardcode guessed IDs. Preserve old investigation documents as historical evidence, update active setup docs. Missing source timestamps remain unknown/stale to matching until an independently validated freshness policy exists.

## Progress / next action
Feature branch `feature/tago-jeju-provider` created from clean main. Official portal schema inspected. Adapter, discovery, cityCode contract, safe errors and synthetic regressions implemented; 22 API tests, 3 Python probe tests and 38 Swift core tests pass. Live probing awaits the new key. No credentialed success claimed.

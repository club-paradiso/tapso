# Hybrid ride position engine

## Outcome and verified diagnosis
The ride count, guidance, notifications and local ActivityKit updates consume one canonical ride result. A upstream feed interruption alone is not a passenger-facing error when useful, bounded device evidence exists.

Verified on main bd1d0ed: `journeySession.evaluateSelectedObservation` requires changing TAGO cadence (TAGO has no observation timestamp); a failed cadence check returns `degraded` and retained progress. `LiveSessionInterpreter` maps degraded to aging and `RideGuidancePolicy` maps aging to delayed. A later accepted provider sequence advances the count; a later degraded read retains that new count. RideView renders the same warning in StatusBanner, hero eyebrow and data TrustBadge. There is no Core Location sampling implementation. Route stops have surveyed coordinates but no authoritative road polyline. Live Activities can also receive independent server pushes.

## Design decisions
- Add a deterministic transit-core engine. Exact route geometry is an injectable, explicitly verified input. Stop-to-stop chords are approximate and cannot produce high-confidence fused guidance or destination alerts. A predicted count may advance only after observed proximity to the next surveyed stop followed by repeated forward departure evidence; never from a projection alone.
- Device estimates never establish vehicle identity. They require recent rider-confirmed official progress, valid accuracy/age/speed, direction and bounded monotonic route projection.
- Prediction cannot advance a destination milestone. Near destination unsupported prediction becomes lost. No timer alone decrements stops.
- Internal opt-in rollout (launch argument `-tapsoHybridTracking`). Default production remains the existing server authority. Hybrid rides have only local ActivityKit updates; do not register APNs tokens and restart a pre-existing activity on authority migration.
- No background-location entitlement/Always permission added. Foreground adaptive sampling (V2: bounded best-fix windows, `BOARDING_ANCHOR_POSITION_V2.md` §5); suspension expires guidance rather than claiming unattended reliability.
- Device samples remain memory-only. Bounded DEBUG diagnostics contain categories/bucketed route distance, never coordinates or vehicle/session identifiers.

## Milestones
1. Audit completed before changes.
2. Engine, route matching, timing extension, canonical presentation and reconciliation implementation.
3. Scenario tests and existing checks; macOS CI is the build/test authority (local environment Linux has no Xcode).
4. PR, limitations and next-ride validation. Do not merge red CI.

## Thresholds
All initial thresholds are engineering assumptions, not field-calibrated: 30 s strong official freshness, 180 s association, 20 s device age, 50 m device accuracy, 80 m corridor, 90 degree heading difference, 35 m/s maximum movement. Approximate geometry caps prediction and never confirms arrival. V2 (2026-10-06) adds the boarding anchor, official reconciliation of early estimates, a near-destination guard that also binds fusion, and `RouteGeometryQuality` in place of `verifiedRoadShape`; see `BOARDING_ANCHOR_POSITION_V2.md` §6. Historical median requires at least five samples; timing alone never commits stop passage.

## Validation and next ride
Record route/variant, actual displayed plate, expected destination. Opt in using the launch argument, allow While Using location, test foreground feed interruption, manual refresh twice quickly, lock/resume, permission denial/revocation, and relaunch. Compare stop transitions with announcements; report early/late count and warning transitions. Export only DEBUG bucketed diagnostics, not raw locations. Before enabling production: authoritative route geometry coverage, background authority reconciliation, field false passage rate and Energy Log measurements are required.

## Progress
Implementation and 24 initial hybrid scenario tests committed to PR #100. First macOS core CI compiled successfully and all new hybrid tests passed; the existing 16 cross-language push fixtures found optional-false normalization incompatibility, now fixed in decoding without weakening tests. First iOS build found the stale-date switch needed an explicit return after adding an expiry guard; fixed. Added two expiry/legacy decoding regressions. API 852/852, web 126/126, Python TAGO 5/5 and timetable 20/20 passed locally, TypeScript checks and web build passed. Second macOS core CI: 162/162 tests passed (27 hybrid tests). iOS simulator and matcher property gate still running. Vercel preview deployment is READY and `/health` returns 200 for 525dbb6; preview sessions correctly fail closed because Redis credentials are not configured there. Production health is 200, Redis sessions enabled, 20 s vehicle cache, APNs push disabled. Final macOS CI still required. No real-device or production reliability claim has been made.

Missing live integrations are explicit: authoritative road shape, backend reconciliation of device evidence for background APNs, and a consented aggregate segment-timing ingestion pipeline. Historical median foundation accepts at least five clean samples but is not fed fabricated observations. Current prediction retains the last confirmed count unless multiple device samples establish proximity to the next surveyed stop followed by forward departure. Such advancement remains approximate and cannot trigger a milestone.

2026-10-05: production rollout switch added (`TRANSIT_HYBRID_TRACKING_ENABLED` → `/health.hybridTracking.enabled`, off by default; the app reads it at ride start and keeps the decision for the ride, `LiveRideState.hybridTracking`), and a Debug `RideTrace` records every poll, hybrid evaluation, guidance change, milestone, lifecycle change and Live Activity update for export. The flag's removal condition and enable criteria are in `TAPSO_V1_RELEASE_CLOSURE.md` §6. No device evidence yet.

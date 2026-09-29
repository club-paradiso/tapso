# Roadmap

Status markers added 2026-09-29, each from what the repository shows; an item without one has no proof either way.

1. `DONE`: Run the credentialed Jeju data spike and publish an evidence matrix. The credentialed TAGO capture is `validation/TAGO_2026-09-11.md`; the evidence inventory is in `DATA_VALIDATION.md`.
2. `PARTIAL`: Capture multi-poll sanitized fixtures for simple, frequent, opposite-direction, and variant routes. Passive Shadow v3 collected one hour of real multi-poll streams on 5 route IDs (`VERIFIED_LIVE_PASSIVE`). The raw streams hold vehicle numbers and stay private; only sanitized summaries are committed under `artifacts/`, and the checked-in fixtures remain synthetic.
3. `PARTIAL`: Calibrate matcher thresholds and add replay/cross-language conformance tests. Blind replay and the legacy-versus-directed migration exist, and CI re-decides the 268 former live wrong commits (`VERIFIED_BY_REPLAY`, instant level). The directed matcher's position rules are safe under every reading of TAGO's `nodeord`, so they are not tuned to a measured convention (`exec-plans/HUMAN_LABOR_ELIMINATION.md` §7); the cadence thresholds stay `PROVISIONAL`. The Swift engine is demo-only, and a Swift port must pass the language-neutral cases in `fixtures/transit/directed-matcher-invariants.json` before it decides anything.
4. `OPEN`: Add route/boarding/destination setup and accessible ambiguity confirmation. The app exposes only the deterministic demo (`KNOWN_ISSUES.md`).
5. `PARTIAL`: Implement cached shared fleet polling and durable ride sessions. The read endpoints use a route-scoped read-through cache and CDN windows, but journey sessions poll TAGO uncached by design and still need a shared collector or a session-scoped cache before broad rollout. The Upstash session store is built and was verified against a preview deployment on 2026-09-23 (`exec-plans/DURABLE_JOURNEY_SESSIONS.md`); production was left on the memory store.
6. `BLOCKED_BY_CREDENTIALS`: Register and rotate ActivityKit update tokens through the API.
7. `BLOCKED_BY_CREDENTIALS`: Implement APNs update/end delivery, budgets, idempotency, and observability.
8. `SUPERSEDED` 2026-09-29: ~~Test 30+ real boardings, including stale and dropout cases.~~ Release gate `matcher-passive-safety-v4` and the rider-free path below replace it. The ride campaigns `broad-real-mode-30-boardings-v1` and `beta-matcher-30-boardings-v2` stay as defined, with zero observed boardings. Stale and dropout behaviour is covered by property tests (`VERIFIED_BY_TEST`) and counterfactual families (`SIMULATED`); see `validation/EVIDENCE_SUBSTITUTION_MATRIX.md`.
9. `BLOCKED_BY_PAID_MEMBERSHIP`: Complete physical-device Dynamic Island, Lock Screen, VoiceOver, battery, and localization QA. No physical device is registered to any available team. It is a device check, not a ride; the release gate needs its Live Activity part (criterion BA-5) only for `READY_FOR_BOUNDED_AUTOMATION`.
10. Threat-model, privacy-review, brand-clear, beta distribute, and add rollback/incident playbooks. Brand clearance is `UNVERIFIED` (`BRAND_RISK.md`), TestFlight distribution is `BLOCKED_BY_PAID_MEMBERSHIP`, and the transit API's rollback procedure is in `PRODUCTION_TRANSIT_API.md`.

## Matcher evidence path (rider-free)

Replaces item 8. Steps 1–7 need no bus ride; method and progress are in `exec-plans/HUMAN_LABOR_ELIMINATION.md`, evidence in `validation/MATCHER_SAFETY_EVIDENCE_V4.md`.

1. `DONE`: Directed matcher `directed-route-progress-v1`, with a runtime invariant on every result; findings F1 and F3–F14 fixed (`VEHICLE_MATCHING.md`).
2. `DONE`: The 268 former live wrong commits re-decided at their commit instants: the directed policy selects none, and the legacy policy reproduces all 268 (`VERIFIED_BY_REPLAY`, instant level).
3. `DONE`: Property suite, negative controls and counterfactual library, run in CI (`VERIFIED_BY_TEST`; counterfactuals so far only on synthetic bases, `SIMULATED`).
4. `DONE`: Release gate `matcher-passive-safety-v4` awards `READY_FOR_SHADOW`, and the configuration refuses automatic matching below `READY_FOR_BOUNDED_AUTOMATION`.
5. `MISSING`: Full-window replay of the Passive Shadow v3 raw streams, and counterfactuals on real bases. `.github/workflows/matcher-evidence.yml` runs both on the merge commit; the raw artifact expires on 2026-10-09T06:28:03Z.
6. `MISSING`: New passive windows. Once merged, the same workflow collects one bounded window a day, rotating route pools, towards the `READY_FOR_CONFIRMATION_ASSISTED` minimums (≥ 60 trajectories, ≥ 30 vehicles, ≥ 30 contested trajectories, ≥ 8 routes, ≥ 3 windows, ≥ 2 time bands).
7. `OPEN`: `READY_FOR_BOUNDED_AUTOMATION` needs ≥ 300 trajectories and the other automation minimums, direct-TAGO evidence (a `TAGO_SERVICE_KEY` repository secret), and three client and device mitigations that do not exist yet: a rider-visible undo of an automatic pick, destination alerts independent of provider lag, and a physical-device Live Activity check (a device check, not a ride).
8. Not a product target: `READY_FOR_AUTOMATIC_MATCHING`, which needs rider behaviour measured by humans.

Later ideas—Apple Watch, AirPods announcements, Android, place routing, journey history—remain behind evidence that the core ride companion is trustworthy.

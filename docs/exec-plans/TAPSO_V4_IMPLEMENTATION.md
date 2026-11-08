# ExecPlan: TAPSO V4 — evidence, NightGuard, trust-centred UX

Format: `.agent/PLANS.md`. Living document; update as work lands.

## 1. Outcome and non-goals

Outcome: TAPSO never tells a rider more than its evidence supports — at night especially — and the rider's next action stays obvious in degraded states.

Non-goals: automatic vehicle identification (gate not met); ETA predictions (no authorised source); scraping competitors or undocumented Jeju BIS endpoints; new paid infrastructure.

## 2. Constraints (labelled)

- TAGO rows have no observation time (`VERIFIED` 2026-09-11).
- Jeju timetables are `OFFICIAL_DATED` imports, 85 % without a day type, 30 of 235 self-contradictory (`OBSERVED` 2026-10-03).
- Timetable freshness bounds 30 / 90 days are `ASSUMED`; the bundle goes stale on 2027-01-02.
- No Swift toolchain in the agent container: Swift changes are verified only in CI (`UNAVAILABLE` locally).
- No device, no APNs (`BLOCKED_BY_APPLE_ACCOUNT`, `BLOCKED_BY_PHYSICAL_DEVICE`).

## 3. Milestones

| PR | Scope | Completion criterion | Status |
|---|---|---|---|
| 1 + 2 (combined, this branch) | Evidence engine layer 1 (`transitEvidence.ts`), NightGuard (`nightGuard.ts`, `GET /v1/night-guard`), offline/lost outrank estimate (Swift core), six V4 documents | API suite green (1018/1018 locally), typecheck clean, CI green incl. `transit-core` and `ios` | Implemented; awaiting CI and review |
| 3 | Matching: real-base replay for Issue #74 families; variant ↔ timetable-direction crosswalk; no policy change without counterfactual evidence | Gate re-run with committed result; crosswalk validated on 365 + one circular route | Not started |
| 4 | iOS trust UX: U-02, U-03, U-04, U-05, U-06, U-08, U-09, U-11; NightGuard card in the return screen | Snapshot evidence in ko/en at default and AX5; VoiceOver checklist | Not started; needs macOS CI snapshots |
| 5 | Docs drift (system audit F-09); timetable-age release-gate warning; performance follow-ups | Docs match code; gate warns at > 60 days | Not started |

PR 1 and PR 2 were combined: NightGuard is the first consumer of the evidence types, and splitting would have shipped an unused module.

## 4. Decisions

- **Previous service day until 06:00.** Tables never exceed 29:59 (`officialTimetable.ts` TIME); 06:00 bounds the read and keeps an early-morning service from being confused with last night's. Alternative (always read both days) rejected: noisier output for no gain.
- **Trip start by default, timepoint only by exact unique name.** Fuzzy stop-name matching would amount to inventing stop-level times. Alternative (interpolate between timepoints) is forbidden by the spec.
- **Unstated day type ⇒ `unknown` with the table's `last` as a fact.** Hiding the table entirely loses information; calling it "tonight" would be a guess.
- **Conditional trips ⇒ `uncertain`.** A winter-only last bus cannot be resolved without verified season rules.
- **Cache bounded by `validUntil`.** A shared cache may never serve a status past the minute it changes; at most 60 s.
- **Evidence engine not yet exposed.** Joining live vehicles to timetable directions needs a crosswalk (PR 3); a route-number-level join could attach a vehicle to the wrong direction.
- **No confidence percentages.** Claims are categorical with reasons.

## 5. Reproduction

```bash
npm --prefix services/api install --omit=optional
npm --prefix services/api test
node --experimental-strip-types --test services/api/test/nightGuard.test.ts services/api/test/transitEvidence.test.ts
(cd apps/web && npx tsc --project ../../services/api/tsconfig.json --typeRoots node_modules/@types)
swift test --package-path packages/transit-core   # macOS / CI only
```

## 6. Progress log

- 2026-11-08: baseline 988/988 API tests (37.7 s). Implemented NightGuard, evidence layer, endpoint, Swift fix; 1018/1018 (36.5 s). Figma read-only check: no NightGuard frame; return rows designed only in the populated state. PR opened as draft (link in the PR list of this branch).

## 7. Risks and next action

- Risk: owner does not refresh timetables before 2027-01-02 → every NightGuard entry `unknown`. Next action: dispatch `jeju-timetables.yml` and merge its PR.
- Risk: Swift change fails CI on a test not visible here. Next action: read CI result; fix forward.
- Exact next action after merge: PR 4 starts with U-02 (boarding-first staleness), reproducing it as a failing XCTest first.

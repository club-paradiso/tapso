# Release decision

**2026-10-20: `NOT_READY`.** Next: `READY_FOR_INTERNAL_FIELD_PILOT` once PR #146 is green on CI and merged, and
the device protocol has hardware (see "What moves it").

There are three possible decisions:
- `READY_FOR_INTERNAL_FIELD_PILOT`: core flows code-verified, instrumentation ready, a supervised pilot with
  stated limits.
- `READY_FOR_TESTFLIGHT_BETA`: build, account, backend, privacy and physical-device conditions all passed.
- `NOT_READY`.

A percentage of finished tasks never decides it; one open P0 blocks.

## Open blockers

| ID | Blocker | Owner | Status |
|---|---|---|---|
| P0-1 | #145 would revert reliability fixes if merged | Claude (done in #146) + owner (close #145) | Fixed in #146; #145 open |
| P0-2 | No APNs: with TAPSO closed and no keep-alive, the Lock Screen goes stale after 120 s and no get-off alert arrives | Owner (paid team, .p8) | BLOCKED |
| P0-3 | No paid Apple Developer team, so no TestFlight | Owner | BLOCKED |
| P0-4 | No physical ride evidence (gates 4, 5) | Owner (hardware, rides) | NOT_TESTED |
| P0-5 | A waiting rider saw the bus-to-destination count | Claude | Fixed in #146 (unit tests; device NOT_TESTED) |
| P1 | RideKeepAlive background-location workaround: App Review 2.5.4 risk for external testers | Owner decision | Open |
| P1 | zh-Hans/ja machine-translated | Native reviewers | Open |
| P1 | Live Activity text built in code (detail line, VoiceOver) now reads the journey language's `.lproj` (`RideText.string(_:language:)`) | Device check | CODE_IMPLEMENTED; device NOT_TESTED |
| P2 | Mutations need only the session id (bearer capability); the id is no longer logged | Claude, later | Open |
| P2 | Session expiry sends no end push (the activity relies on its stale date) | Claude, later | Open |
| P2 | Live Activity fonts do not follow Dynamic Type | Claude, later | Open |
| — | Matching readiness `READY_FOR_SHADOW` (issue #74, CA-5 on real bases) | — | Unchanged by design; automatic matching stays off |

## What moves it

**To `READY_FOR_INTERNAL_FIELD_PILOT`, all of:**
1. PR #146 CI green: `ios`, `transit-core`, `api`, `web`, `matcher-evidence`.
2. #146 merged by the owner.
3. A paired device runs the Beta configuration, and the tester has `docs/DEVICE_TEST_PLAN.md` §"Beta field
   protocol".
4. The pilot is limited to:
   - supervised riders;
   - the app kept open, or "앱을 나가도 계속 알려 주기" (keep-alive) switched on;
   - riders told that a closed app gets no alert until APNs exists.

**To `READY_FOR_TESTFLIGHT_BETA`, additionally:**
1. `docs/beta/HUMAN_ACTION_REQUIRED.md` steps 3–7 done.
2. APNs delivers to a device with the app force-quit: protocol cases B-7 and B-8 pass.
3. At least the short and medium ride protocols (R-1, R-2) pass on a Dynamic Island device, with sanitized
   evidence in `artifacts/device-validation/`.
4. Release gates 4 and 5 move from BLOCKED, on evidence only.

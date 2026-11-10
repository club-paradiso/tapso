# Journey state

The UI and the Live Activity render domain state; they never invent progress on their own.

`RideSession` (`packages/transit-core/Sources/TapsoTransit/RideSession.swift`) is the only thing that moves a ride's `JourneyState`. `TapsoAppModel` creates one session per ride and feeds it the matched bus's observations. Tests: `packages/transit-core/Tests/TapsoTransitTests/RideSessionTests.swift`.

```text
vehicleConfirmationRequired ──confirm(vehicleID:)──▶ active

active ──apply(observation:…)──▶ approachingDestination (2 stops left)
                               ▶ nextStopIsDestination (1 stop left)
                               ▶ arrived (0, or the destination passed)
       any fresh reading ──────▶ back to the matching phase above
       an aging reading ───────▶ dataAging
       a stale or unknown one ─▶ dataStale

markVehicleLost() ──▶ vehicleTemporarilyLost   (never from arrived, completed or cancelled)
complete() ──▶ completed        cancel() ──▶ cancelled
```

- `apply(observation:route:now:)` reads progress through `DestinationProgressEngine`: route-stop order, never guessed arithmetic. A wrong route or variant, a missing stop or a destination not downstream is a `progressFailure`, and the state does not change.
- An observation of another bus (`wrongVehicle`), a repeat (`duplicate`) or an older one (`outOfOrder`) is rejected and changes nothing.
- A stale reading never produces `arrived`: freshness is checked before the phase.
- A passed destination is reported as `arrived`. `RideGuidancePolicy` reads the progress phase and shows it as its own moment, with no arrival alert (`product/JOURNEY_STATE_MODEL_V2.md`).
- On a live ride the server's reading arrives as a `RideSignal` (`LiveSessionInterpreter`, `HybridPositionEngine`), which can also carry `vehicleRecovery` (session ended or lost) while the session itself is not advanced by observations. `waitingForBoarding` is only `RideSession`'s default; the app always starts a session at `vehicleConfirmationRequired`. `idle`, `planning` and `matchingVehicle` are set by no code path: setup before a session exists is `SetupStep` (app) and `VehicleCheckStage` (core).

The demo timeline (`DemoFixtures.demoTimeline`) advances through the same `apply` path as live observations.

A separate event-driven `JourneyStateMachine` existed until 2026-11-10. The app never used it, so it was removed and its transition tests were moved onto `RideSession`.

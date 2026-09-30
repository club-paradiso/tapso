# Journey state machine

The UI and Live Activity render domain state rather than inventing progress independently.

```text
idle → matching → vehicleConfirmationRequired → active
                                         active → approachingDestination (2)
                                                → nextStopIsDestination (1)
                                                → arrived (0) → ended
                                         active → degradedData → active | ended
```

Invalid transitions throw a domain error. Arrival may not be produced by a stale snapshot. An explicit cancel or finish may end any active-like state. Duplicate and out-of-order observations do not advance the session.

Destination progress uses route-stop ordering and returns active, approaching, next, arrived, or passed. Wrong route/variant, missing stops, or a destination not downstream are errors rather than guessed arithmetic.

The demo timeline starts with eight stops remaining and advances through the same `RideSession` ingestion method used by future normalized provider observations.

Product V2 (2026-09-30) presents these states through one `RideGuidancePolicy` (`packages/transit-core/Sources/TapsoTransit/RideGuidance.swift`) without changing them: a destination the bus has passed, which the session reports as `arrived`, is read from the progress phase and shown as its own moment with no arrival alert. See `product/JOURNEY_STATE_MODEL_V2.md`.

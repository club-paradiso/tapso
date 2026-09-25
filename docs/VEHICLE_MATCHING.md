# Vehicle matching

The matcher answers one safety-sensitive question: which physical bus did the passenger board? It is deterministic and returns selection, confidence, ranked alternatives, evidence, and rejection reasons.

## Evidence

- Exact route and compatible route variant are hard gates.
- Direction must permit travel from boarding stop to destination.
- Distance from the boarding stop, observation timing, and event evidence influence rank.
- Freshness, physically plausible movement, heading, and historical continuity add confidence.
- Contradictory previous identity, impossible jumps, or invalid stop ordering reject a candidate.

## Safe decision rule

The Swift engine selects only an eligible leading candidate above its threshold and with enough margin over the runner-up. It emits high, medium, low, or unknown confidence. Low confidence and ties return alternatives for confirmation; no eligible candidate returns unavailable. The backend mirror uses the same fail-closed policy but is not yet a cross-language source of truth.

## Re-evaluation

A `RideSession` accepts only monotonically newer observations for the selected vehicle. Duplicate, out-of-order, wrong-vehicle, wrong-route, or impossible progression cannot silently replace identity. A future production service may re-run matching after bounded disappearance, but it must surface confirmation before switching vehicles.

## Known validation gap

Weights are engineering priors exercised by synthetic tests. They are not presented as calibrated probabilities. Real Jeju observation history is required to tune thresholds and determine which official event and direction fields are trustworthy.

Passive Shadow Validation v3 (2026-09-25) measured this gap live. With symmetric stop-distance scoring, a bus that has already passed the boarding stop is often the only eligible candidate, and the matcher commits to it. That happened in 268 of 5 461 evaluable waiting-rider cases. See `validation/PASSIVE_SHADOW_VALIDATION_V3_RESULTS.md`.

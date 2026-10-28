# 돌이의 이동 · Dynamic Island

## Outcome
Make the existing 16–18 pt JourneyRail marker friendlier while keeping the bus position tied to actual vehicle data. Show the same stop-based progression in the expanded Dynamic Island and Lock Screen, without inventing movement between updates.

## Verified implementation
- `JourneyRail` is already shared by the in-app ride, Lock Screen and expanded Dynamic Island. The marker advances from remaining stops with a 0.7 s state-change transition and respects Reduce Motion. The waiting zone stays distinct from the onboard ride. Unknown and degraded states keep their existing policy.
- `LiveActivityClient` supports ActivityKit push tokens, and the server has APNs update and ticker code. Availability on a deployed environment and a physical device requires an enrolled Apple team, signing/entitlements, APNs configuration, production ticker, token registration and field verification; do not infer those are active from code.
- Apple limits Live Activity update animations to at most two seconds and does not guarantee continuous rendering or update cadence. This is not live GPS or interpolated movement.

## Change and verification
- Add a tiny smile to normal/decision rail markers, and keep checking/degraded expressions neutral. Keep the tangerine pin and contrasting role outline. No data, counting or alert policy changes.
- Check the Figma proposed states and visually compare 16–18 pt markers on light/dark and degraded surfaces. On macOS run `xcodebuild` app and widget build and snapshot tests; on a physical iPhone validate a real bus, update delivery in foreground and suspension, stale/lost states, coexistence and Reduce Motion.

## Status
Code is a design proposal until built and tested with Xcode and a physical iPhone. This Linux environment lacks Xcode, so no ActivityKit delivery or render is claimed. APNs configuration and live delivery remain separate operational requirements.

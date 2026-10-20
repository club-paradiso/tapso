# Design direction: basalt and the stop rail (V3)

Approved 2026-10-20. It supersedes the colour and type sections of `docs/product/DESIGN_SYSTEM_V2.md`; everything
else in V2 (spacing, radii, 돌이's expressions, the moment model) still applies.

## Thesis

**One number when you need to look, nothing when you don't.** TAPSO speaks through the remaining-stop count
and one rail that shows whether that number is true, on Jeju basalt rather than a generic dark navy.

References are principles only. From Linear: restraint and typographic precision. From Airbnb: plain-language
reassurance for a traveller in an unfamiliar place. No screen composition, asset or trade dress is borrowed.

## Colour

| Token | Value (light / dark) | Role | Contrast |
|---|---|---|---|
| Basalt | `#0F171A` | identity, body ink, dark background | 18.1:1 on white |
| Shore | `#F3F5F4` / `#172124` | rows, fields, the ride card | basalt ink 16.6:1 |
| Stone | `#56636A` / `#A9B6BA` | secondary text | 6.2:1 / 8.7:1 |
| Tangerine | `#F7972F` | destination and arrival only; never body text (2.2:1 on white) | basalt on tangerine 8.1:1 |
| Mint | `#2FC7AA`; text `#097666` / `#2FC7AA` | normal journey | text 5.1:1 on Shore |

The safety colours are unchanged in meaning:

| Colour | Value (light / dark) | Meaning | Rule |
|---|---|---|---|
| Amber | `#F4B84A` | prepare | basalt text 10.2:1 |
| Coral | `#C93C3C` / `#FF7A6E` | next stop | white 5.0:1 / basalt 7.1:1 |
| Blue | `#4389EF` / `#5B9BFF` | rechecking | basalt text only (white is 3.46:1, below AA) |
| Slate | | data degraded | |

No state is carried by colour alone: every state has its own words and a symbol.

Source: `apps/ios/Shared/TapsoTokens.swift` (ratios computed with the WCAG 2.x formula).

## Type

- **Pretendard 1.3.9** (SIL OFL 1.1, Reserved Font Name "Pretendard").
  - Regular, SemiBold and ExtraBold, unmodified, in `apps/ios/Fonts` with the licence.
  - App target only. Never subset: subsetting is a modification, and the reserved name would then have to change.
- `Font.tapso(style, weight)` uses Pretendard at the system text style's size and scales with Dynamic Type
  through `Font.custom(_:size:relativeTo:)`.
  - Weight mapping: regular/medium → Regular, semibold/bold → SemiBold, heavy/black → ExtraBold.
  - Where Pretendard is not registered (the Live Activity and Share extensions), it falls back to the
    system font at the same style and weight.
- The hero numeral and route numbers use ExtraBold with tabular figures.
- The Lock Screen and Dynamic Island keep SF Pro Rounded. A widget extension has a tight memory budget, and
  the earlier "18 drawn as 1" defect was seen on a device. Pretendard moves there only after device evidence.
- Chinese and Japanese glyphs that Pretendard lacks fall back to the system's PingFang SC and Hiragino.

## The signature device: the stop rail

`JourneyRail` (`apps/ios/Shared/RideSurfaceComponents.swift`). Every part is a fact:

- **Beads.** Each bead is a real stop of the rider's ride, up to 16; beyond that the track is drawn plain.
- **돌이.** 돌이 is the confirmed bus, placed where the last answer put it. It moves only when a new answer arrives.
- **Waiting.** While the bus has not reached the boarding stop, 돌이 waits in a dashed zone *before* the boarding
  ring and is drawn with a dashed rim. "Coming" and "aboard" are two pictures, not one number with two meanings.
- **The tangerine dot** is the destination.
- **Reduce Motion:** the marker jumps instead of sliding; nothing else depends on motion.

The rail appears on the app's ride card, the Lock Screen and the expanded Dynamic Island.

## What changed and why

| Change | Reason |
|---|---|
| Navy neutrals → basalt | A generic dark-mode navy carried no meaning; basalt is the identity colour and Jeju's ground |
| System type → Pretendard (app) | A Korean-first face with Latin metrics close to SF, so Dynamic Type keeps working |
| The waiting zone on the rail and the waiting count | Before this change a waiting rider saw the bus-to-destination count labelled "정거장" |
| Four degraded headlines instead of one | Each state needs a different next action (wait, look out of the window, reconnect) |
| "여정 종료하기" vs "내렸어요"; past the stop "안내 마치기" | Abandoning a ride and getting off are different decisions |

## Not done (on purpose)

- No gradients, glass, decorative icon tiles, eyebrow capitals or mascot additions.
- No motion added beyond the rail slide and existing count transition. The two-stop "zoom" moment from the
  proposal is deferred until it can be judged on a device; the rail already marks the last two stops by their
  beads.
- Light, dark, AX5 and long-name layouts are rendered by CI (`SnapshotEvidenceTests`, four languages), but no one
  has reviewed them on a device yet.

# Design System V2

Calm transit instrument, warm Jeju mobility product. Source of truth: Figma `TAPSO — Product / Marketing Design System` (`kkx04GvqOzHje7Dw5ikO9X`), variable collection **TAPSO V2 Semantic** (`VariableCollectionId:151:14`, modes Light/Dark) and page **02F iOS Ride V2** (`152:2`). Code: `apps/ios/Shared/TapsoTokens.swift`, compiled into both the app and the Live Activity extension, so no screen or surface defines its own colour.

The existing `TAPSO Color`, `TAPSO Dimensions` and web components are unchanged; V2 adds primitives to `TAPSO Primitives` and a new semantic collection that aliases them.

## Colour

| Token (Figma `color/…` · Swift `TapsoColor.…`) | Light | Dark | Role |
|---|---|---|---|
| `background/primary` · `backgroundPrimary` | `#FFFFFF` | `#071923` | Screen |
| `background/secondary` · `backgroundSecondary` | `#F5FAFB` mist | `#0E222C` | Cards, fields, rows |
| `background/elevated` · `backgroundElevated` | `#FFFFFF` | `#16303D` | Confirmation card |
| `text/primary` · `textPrimary` | `#071923` ink | `#FFFFFF` | Headlines, stop names |
| `text/secondary` · `textSecondary` | `#566973` | `#B4C4CB` | Supporting copy |
| `text/tertiary` · `textTertiary` | `#5F7079` | `#8599A2` | Hints, chevrons |
| `text/on-accent` · `textOnAccent` | `#071923` | `#071923` | On mint, amber, tangerine, blue, slate fills |
| `text/on-urgent` · `textOnUrgent` | `#FFFFFF` | `#071923` | On the coral fill |
| `text/on-dark-surface` · `textOnDarkSurface` | `#FFFFFF` | `#FFFFFF` | Basalt Lock Screen, Dynamic Island |
| `line/separator` · `separator` | `#DFE8EB` | `#274452` | Dividers, outlines |
| `journey/active` · `journeyActive` | `#2FC7AA` mint | same | riding |
| `journey/prepare` · `journeyPrepare` | `#F4B84A` amber | same | two stops |
| `journey/next` · `journeyNext` | `#C93C3C` coral | `#FF7A6E` | next stop, passed destination |
| `journey/arrival` · `journeyArrival` | `#F7972F` tangerine | same | arrival — the destination colour |
| `journey/checking` · `journeyChecking` | `#4389EF` blue | `#5B9BFF` | signals disagree; bus awaiting confirmation |
| `journey/degraded` · `journeyDegraded` | `#8A9AA3` slate | `#9FB0B8` | delayed, lost, offline |
| `vehicle/confirmed`, `vehicle/needs-confirmation` | = active, = checking | | Vehicle identity badge |
| `data/live`, `data/delayed` | = active, = prepare | | Data freshness badge |
| `identity/tangerine`, `identity/basalt` `#0F171A`, `identity/basalt-raised` `#1A2528`, `identity/mint-ink` `#0B7F6D`/`#2FC7AA` | | | Destination marker, Live Activity surface, 돌이, mint as text |

`TapsoColor.journey(_ role: RideColorRole)` and `onJourney(_:)` map the core's colour role to a fill and its text colour; views never pick a journey colour by hand.

**Rules.** Meaning is never carried by colour alone: every state also has words and a symbol. Degraded states are slate, not red or amber — they are not calls to action. Amber is reserved for "prepare" and the "delayed" data badge; coral for "get off next"; tangerine for the destination and arrival.

### Contrast (WCAG 2.x, computed from the token hex values)

| Pair | Light | Dark |
|---|---|---|
| text.primary on background.primary | 17.9:1 | 17.9:1 |
| text.secondary on background.primary | 5.7:1 | 10.0:1 |
| text.secondary on background.secondary | 5.4:1 | 9.1:1 |
| text.tertiary on background.primary | 5.1:1 | 6.0:1 |
| text.tertiary on background.secondary | 4.9:1 | 5.5:1 |
| identity.mint-ink on background.primary | 4.9:1 | 8.4:1 |
| on-accent on journey.active | 8.4:1 | 8.4:1 |
| on-accent on journey.prepare | 10.1:1 | 10.1:1 |
| on-urgent on journey.next | 5.0:1 | 7.0:1 |
| on-accent on journey.arrival | 8.0:1 | 8.0:1 |
| on-accent on journey.checking | 5.2:1 | 6.5:1 |
| on-accent on journey.degraded | 6.2:1 | 8.0:1 |

| Dark surfaces | Ratio |
|---|---|
| on-dark-surface on basalt | 18.1:1 |
| journey.active on basalt | 8.5:1 |
| journey.prepare on basalt | 10.2:1 |
| journey.next (dark) on the black island | 8.3:1 |
| journey.arrival on the black island | 9.4:1 |
| journey.checking (dark) on basalt | 6.5:1 |
| journey.degraded (dark) on basalt | 8.1:1 |

The Lock Screen follows the system appearance even on basalt, so its text is checked with both token variants, for every moment (`RidePresentationTests.testLockScreenTextReadsOnEverySurface`). Text is dimmed only where it stays at 4.5:1 or more: the secondary line at 70 % on basalt (9.2:1) and 72 % on tangerine (4.8:1).
- **Coral:** the secondary line is full strength. Dimmed to 70 % it read 3.2:1 on the light coral and 4.3:1 on the dark one.
- **Count unit label:** full strength on every surface. At 80 % it read 3.7:1 on the light coral and 4.4:1 for light slate on basalt.
- **Last-known count numeral:** 70 %. Slate on basalt then reads 3.7:1 in light appearance and 4.6:1 in dark, above the 3:1 that large text needs; at the previous 55 % it read 2.8:1.

The V1 values these replace failed: white on `#D64545` 4.4:1, white on `#F2685C` 3.0:1, `#7A8C95` on white 3.5:1, ink on the slate route badge 3.1:1 (`UX_AUDIT_V2.md` P2-2).

## Space, size, radius

| Token | Value | Use |
|---|---|---|
| `space/2xs…2xl` · `TapsoSpace.xxs…xxl` | 4, 8, 12, 16, 20, 24, 32 | Existing `TAPSO Dimensions` scale |
| `space/gutter` · `TapsoSpace.gutter` | 20 | Screen edge |
| `size/touch-min` · `TapsoSize.minimumTouch` | 44 | Every tappable element |
| `size/button-primary` · `primaryButtonHeight` | 56 (secondary 48) | One primary action per screen, usable on a moving bus |
| `size/route-badge` · `routeBadgeHeight` | 30 | Route capsule |
| `radius/sm, control, md, lg` · `TapsoRadius` | 12, 14, 18, 24 | Existing scale |
| `radius/hero` · `TapsoRadius.hero` | 28 | Ride hero |

## Type

System text styles so Dynamic Type applies everywhere. The remaining-stop numeral is SF Pro Rounded Black, `@ScaledMetric` from 76 pt (`type/numeral-hero`) capped at 120. Korean uses the system font (Apple SD Gothic Neo). At accessibility sizes long text wraps (`fixedSize(horizontal: false, vertical: true)`) rather than truncating; only island text, where iOS fixes the space, scales down to 80–85 % before truncating.

Figma stand-ins: **Noto Sans KR** for Apple SD Gothic Neo and **Inter** for SF Pro / SF Pro Rounded. SF fonts are listed by this Figma runtime but render with zero width, so they cannot be used for layout. The existing web pages already use Noto Sans KR as the stand-in for Pretendard (`docs/FIGMA_CODE_CONNECT.md`).

## Motion and haptics

Motion lives in code only (Figma has no motion variables).

| Name | Swift | Use |
|---|---|---|
| standard | `TapsoMotion.standard` easeInOut 0.25 s | Root transitions |
| emphasis | `TapsoMotion.emphasis` spring 0.38 / 0.82 | Moment change on the ride hero |
| numeric | `.contentTransition(.numericText())` | The count (also honoured by Live Activities) |
| bell | `.symbolEffect(.bounce)` once at next stop | |

`TapsoMotion.animation(_:reduceMotion:)` returns `nil` under Reduce Motion; the searching pulse stops too. Haptics come from `RideGuidance.haptic` (`RideFeedback`): soft impact (prepare), warning (next stop), success (arrival), error (passed destination), none otherwise. They play only while the app runs.

## Components (02F iOS Ride V2)

| Figma component (node) | Variants | SwiftUI |
|---|---|---|
| Icon / V2 (`152:86`) | 23 glyphs | SF Symbols named by `RideGuidance.symbolName` |
| CitrusDot / V2 (`153:2`) | — | `CitrusDot` |
| RouteBadge / V2 (`153:89`) | role × size | `RouteBadge` |
| 돌이 / V3 (`287:35`, page `05C`; replaces V2 `153:130`) | checking, riding, prepare, nextStop, arrived, uncertain | `DolBuddy` |
| Button / V2 (`153:137`) | primary, secondary, onArrival | `PrimaryButtonStyle`, `SecondaryButtonStyle` |
| TrustBadge / V2 (`153:173`) | 3 vehicle + 4 data signals | `TrustBadge` |
| SearchField / V2 (`154:62`) | — | `SearchFieldButton` |
| StopPair / V2 (`154:73`) | — | `StopPair` |
| StopRow / V2 (`154:83`) | — | `StopRow` |
| RecentJourneyCard / V2 (`154:107`) | — | `RecentJourneyCard` |
| BoardingContextCard / V2 (`154:125`) | — | `BoardingContextCard` |
| StatusBanner / V2 (`154:153`) | delayed, vehicleLost, offline, checking | `StatusBanner` |
| ConfirmationCard / V2 (`154:199`) | proposed, selectable, confirmed | `ConfirmationCard` |
| JourneyRail / V2 (`154:233`) | early, late, next | `JourneyRail` |
| RideHero / V2 (`155:241`) | riding, lastKnown, prepare, nextStop, arrived, passed | `RideHeroCard` |
| StopLadder / V2 (`155:271`) | — | `StopLadder` |
| LiveActivity / Lock Screen V2 (`156:420`) | 9 moments | `LockScreenRideView` |
| DynamicIsland / Compact V2 (`156:562`) | 9 moments | `IslandCompactLeading` + `IslandCompactTrailing` |
| DynamicIsland / Minimal V2 (`156:591`) | 9 moments | `IslandMinimal` |
| DynamicIsland / Expanded V2 (`156:990`) | 9 moments | `IslandExpanded{Leading,Center,Trailing,Bottom}` |

`FIGMA_IMPLEMENTATION_MAP_V2.md` adds tokens, states, localization keys and accessibility per component.

## 돌이

The basalt companion stays, smaller: 18–36 pt on ride surfaces, one expression per moment. V3 (2026-10-05, Figma `05C · 돌이 V3 · App Icon (Proposal)`) idea: 돌이 watches so the rider does not have to. The body is a pebble resting on its flat side with one sheen and three faint pores (drawn from 30 pt up). V3.1 (same day, after a device check found the dot eyes blank) gives it the app icon's eyes: a white eye, a basalt pupil and a glint (from 26 pt up; white eyes alone below), coral cheeks (`TapsoColor.dolCheek`) on the calm moments, and a tangerine hair pin on the crown (leaf and glint from 22 pt up). Figma: `돌이 V3.1 · eye options` (`291:407`), option "P · 눈 올림 + 감귤 핀". The rim takes the moment colour:

| Moment | Eyes | Cheeks |
|---|---|---|
| awake (Home, wordmark, a proposed bus) | open, looking at the rider | yes |
| checking | open, pupils glancing side to side | no |
| riding | resting, closed arcs; peeks open | yes |
| prepare | open, pupils looking ahead | yes |
| nextStop, passedDestination | wide, pupils up | no |
| arrived, ended | smiling arcs | yes |
| delayed, vehicleLost, offline | squinting bars | no |

Off the ride (Home, the wordmark, a proposed bus to check) 돌이 is **awake**: open eyes, looking at the rider.

In the app 돌이 moves (`DolBuddy(animated: true)`, timings in `DolMotion`): open eyes blink every 4.2 s with a double blink every third time, checking glances side to side, resting eyes peek open for a second every 7 s ("still watching"), arrival hops, and the pebble breathes slightly. Live Activities draw the same face still, because ActivityKit allows only built-in transitions; Reduce Motion stills it everywhere.

It is always decorative (`accessibilityHidden`), never larger than the count, never on its own screen, and never the only carrier of meaning. The app icon is 돌이 looking up at the tangerine destination dot (Figma `App Icon / B`, `289:36`), drawn as flat vectors in Figma: no texture, no generated imagery.

## What V2 removed

Gradient numerals, sparkles, wave and sunrise ornaments on the Lock Screen, the 96 pt 돌이 beside the ride card, uppercase transforms on Korean, and the island "connected" indicator as a trust signal.

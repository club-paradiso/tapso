# Figma → SwiftUI implementation map V2

File: `TAPSO — Product / Marketing Design System`, key `kkx04GvqOzHje7Dw5ikO9X`.

| Figma page | Node | Contents |
|---|---|---|
| 00 Cover / Index | `46:2` | Page map and editing rules; the Handoff boards (`13:2` reality labels and rules, `162:2` this table, condensed) |
| 02F iOS Ride V2 | `152:2` | V2 components (below) |
| 02G iOS Product V3 | `212:2` | V3 components: `ReturnTripRow / V3` (`212:123`), `RescueOption / V3` (`212:139`), `ReturnCountdown / Lock Screen V3` (`212:162`), `ReturnCountdown / Island V3` (`212:193`) |
| 03 iOS — GO › iOS — GO · Product V2 + V3 | `205:3310` | Home to the rider's confirmation: V2 01–09 with Dark · 02, Dark · 08 and EN · 02, and the map hand-off V3 20–24 |
| 04 iOS — RIDE › iOS — RIDE · Product V2 | `157:10` | The ride: V2 10–19 with their dark, EN and SE 375 variants |
| 05 Live Activity · Dynamic Island | `160:1208` | One row per ride moment: compact, minimal, expanded, Lock Screen |
| 05B · Dynamic Island Coexistence V3 | page `275:2` | V3 proposal awaiting Human Review Gate A (`TAPSO_V1_RELEASE_CLOSURE.md` §5): sections `00 Evidence` `275:3` … `11 Implementation Comparison` `275:25`; V3 component sets on `02 Components` `275:7`: `RideStateSymbol` `276:32`, `RemainingStopsIndicator` `276:41`, `TrustQualifier` `276:57`, `DynamicIslandMinimal` `276:93`, `DynamicIslandCompactLeading` `276:164`, `DynamicIslandCompactTrailing` `276:204`, `DynamicIslandExpanded` `276:490`. Implemented in `Shared/LiveActivitySurfaces.swift` (`IslandMinimalStyle`, `IslandMinimal`, `IslandCompactTrailing`, `TrustQualifier`) after the owner's delegated review on 2026-10-05; the V2 row above still maps the Lock Screen and expanded layout |
| 07 Discover, 08 Eat, 10 Passport / Share | `205:4`, `205:5`, `205:7` | Status cards only: not designed, and why |
| 09 Return / Rescue › Return / Rescue · Product V3 | `193:2956` | V3 25–27: the way back, rescue past your stop, the countdown |
| 11 Marketing Web | `3:4` | The marketing site V3 as built, four widths (`218:2`, below); the V2 board `165:54` is on `13 Archive` |
| 12 Prototype | `205:8` | Clickable flows A (map hand-off → ride), B (confirmation → island → arrival), D (passed stop → rescue), built from labelled copies |
| 13 Archive | `102:2` | Superseded boards in dated sections, nothing deleted: Web legacy and V1, iOS V1 workbench and the live-ride trial, Android workbench, Playground and the Product V2 explorations |
| Variables › TAPSO V2 Semantic | `VariableCollectionId:151:14` | Semantic tokens, Light/Dark |

Pages follow the Product V3 structure since 2026-10-01. There is no separate `06 Dynamic Island` page: one `ContentState` draws the Lock Screen and every island region, so `05` keeps them on one row per moment, where a mismatch shows. Node IDs did not change when boards moved between pages.

Keep this file current when either side changes. Code Connect for Swift is not set up: publishing needs an Organization/Enterprise Figma plan (`docs/FIGMA_CODE_CONNECT.md`), so node IDs here are the mapping.

## Components

| Figma component (node) | SwiftUI | Tokens | Journey state | Localization keys | Accessibility |
|---|---|---|---|---|---|
| RouteBadge / V2 (`153:89`) `role`, `size` | `RouteBadge(number:role:compact:)` — `Shared/RideSurfaceComponents.swift` | `journey/*` fill, `text/on-accent` · `on-urgent` · `on-dark-surface`, `size/route-badge` | `RideGuidance.colorRole`; `neutral` on coral/tangerine Lock Screens | `a11y.route` | One element: "365번 버스" |
| 돌이 / V2 (`153:130`) `moment` | `DolBuddy(moment:size:)` | `identity/basalt(-raised)`, `journey/*`, tangerine | `RideMoment`; `uncertain` = delayed, vehicleLost, offline, checking | — | Hidden |
| CitrusDot / V2 (`153:2`) | `CitrusDot(size:)` | `identity/tangerine` | Destination | — | Hidden |
| Icon / V2 (`152:86`) | SF Symbols from `RideGuidance.symbolName` | inherits | per moment | — | Paired with text; decorative alone |
| Button / V2 (`153:137`) `kind` | `PrimaryButtonStyle`, `SecondaryButtonStyle` — `TapsoApp/AppComponents.swift` | `journey/active`, `background/secondary`, `size/button-primary`, `radius/md` | — | `home.rideAgain`, `check.confirm`, `check.reject`, `ride.gotOff`, `end.done` | ≥ 48 pt; label is the action |
| TrustBadge / V2 (`153:173`) `signal` | `TrustBadge(kind:onDark:)` | `vehicle/*`, `data/*`, `journey/degraded`, `journey/checking` | `RideGuidance.vehicle`, `.data` | `trust.vehicle.*`, `trust.data.*` | Icon + words; combined with plate |
| SearchField / V2 (`154:62`) | `SearchFieldButton` — `HomeView.swift` | `background/secondary`, `journey/active` 55 % outline, `identity/mint-ink` | SETUP | `home.search.placeholder`, `home.search.hint` | Button, id `destination-search` |
| StopPair / V2 (`154:73`) | `StopPair` | `text/secondary`, `text/primary`, `line/separator` | — | `a11y.stopPair` | One sentence |
| StopRow / V2 (`154:83`) | `StopRow` | `text/*`, tint per use | SETUP, boarding, map intake | `boarding.stopsToDestination` | ≥ 44 pt row |
| RecentJourneyCard / V2 (`154:107`) | `RecentJourneyCard` | `background/secondary`, `radius/lg` | Repeat rider | `home.recentJourney`, `route.headsign`, `home.rideAgain(.hint)`, `favorite.add/remove` | Star is a 44 pt button with a label |
| BoardingContextCard / V2 (`154:125`) | `BoardingContextCard` — `VehicleCheckView.swift` | `background/secondary` | BOARDING_CONTEXT_READY → MATCHING | — | Via StopPair |
| ConfirmationCard / V2 (`154:199`) `state` | `ConfirmationCard` | `background/elevated`, `vehicle/needs-confirmation`, `vehicle/confirmed` | CONFIRMATION_REQUIRED, MULTIPLE_CANDIDATES | `check.plateHint`, `check.position.*` | "365번 버스, 번호판 끝자리 0001, 정류장에 도착" (`a11y.proposal`); hint `check.pick.hint` |
| StatusBanner / V2 (`154:153`) `moment` | `StatusBanner(guidance:)` | `journey/degraded`, `journey/checking` 12 % fill, 35 % stroke | DEGRADED_DATA, VEHICLE_TEMPORARILY_LOST, OFFLINE, checking | `ride.<moment>.headline/detail` | Combined element |
| JourneyRail / V2 (`154:233`) `progress` | `JourneyRail(progress:role:)` | `journey/*`, `line/separator`, tangerine | riding, prepare, (nextStop in island) | — | Hidden; the count carries meaning |
| RideHero / V2 (`155:241`) `moment` | `RideHeroCard` — `RideView.swift` | `background/secondary`, `journey/*`, `radius/hero`, `type/numeral-hero` | ACTIVE, TWO_STOPS, NEXT_STOP, ARRIVED, PASSED_DESTINATION, last-known | `ride.*`, `count.*`, `ride.toDestination`, `ride.nextStopLabel`, `ride.passed.*` | One summary sentence (`a11y.ride.live/lastKnown/hidden`); next stop `updatesFrequently`; arrival heading |
| StopLadder / V2 (`155:271`) | `StopLadder` | `background/secondary`, `journey/*`, tangerine | ACTIVE…NEXT_STOP, degraded | `ride.now`, `ride.getOffHere`, `ride.moreStops`, `ride.stopsAhead` | One element "남은 정류장" + names |
| LiveActivity / Lock Screen V2 (`156:420`) `moment` | `LockScreenRideView` — `Shared/LiveActivitySurfaces.swift`; tint `RideSurfacePalette.background` | `identity/basalt`, `journey/next`, `journey/arrival`, `text/on-dark-surface`, `text/on-urgent` | all ride moments | `ride.*`, `count.*`, `trust.data.*` | One sentence (`a11y.ride.*`) |
| DynamicIsland / Compact V2 (`156:562`) `moment` | `IslandCompactLeading`, `IslandCompactTrailing` | `journey/*` on black | all ride moments | `ride.<moment>.compact`, `count.unit` | Leading "365번 버스" + hint `a11y.island.hint`; trailing count + headline |
| DynamicIsland / Minimal V2 (`156:591`) | `IslandMinimal` | `journey/*` | all | — | Count or headline |
| DynamicIsland / Expanded V2 (`156:990`) | `IslandExpanded{Leading,Center,Trailing,Bottom}` | `journey/*`, `text/on-dark-surface` | all | `ride.<moment>.eyebrow/headline/detail`, `trust.*` | Bottom region one sentence |

App-only pieces drawn inline in Figma screens: DemoDataChip (`DemoDataChip`, `demo.chip`), DestinationRecap (`DestinationRecap`, `recap.getOffAt`), MapHandoffIntakeCard (`MapHandoffIntakeCard`, `home.mapImport.*`), NoticeCard (`NoticeCard`, `ride.resumed.*`, `ride.liveActivityOff.*`, `handoff.failed.*`, `mapImport.none.*`).

## Screens

| Figma frame in `157:10` | SwiftUI | State | Snapshot (`SnapshotEvidenceTests`) |
|---|---|---|---|
| V2 / 01 Home · first ride | `HomeView` › `HomeContent` (empty library) | SETUP | `01-home-first-run` |
| V2 / 02 Home · recent & favourites | `HomeContent` | SETUP, repeat | `02-home-recent-favorites` |
| V2 / 03 Destination search | `DestinationSearchView` › `DestinationSearchContent` | SETUP | `03`, `04` |
| V2 / 04 Route select (destination selected) | `RouteSelectView` › `RouteSelectContent` | ROUTE_SELECTED | `05-route-select` |
| V2 / 05 Boarding stop | `BoardingStopView` › `BoardingStopContent` | BOARDING_CONTEXT_READY | `06-boarding-stop` |
| V2 / 06 Map-app handoff intake | `MapImportView` › `MapImportContent` | SETUP | `07`, `08` |
| V2 / 07 Matching (searching) | `VehicleCheckView` › `VehicleCheckContent` | MATCHING | `09-check-searching`, `12-check-not-found` |
| V2 / 08 Vehicle confirmation | same | CONFIRMATION_REQUIRED | `10-check-proposed` |
| V2 / 09 Multiple candidates | same | MULTIPLE_CANDIDATES | `11-check-similar-buses` |
| V2 / 10 Active ride | `RideView` › `RideContent` | ACTIVE | `13-ride-riding` |
| V2 / 11 Two stops | same | TWO_STOPS | `14-ride-prepare` |
| V2 / 12 Next stop | same | NEXT_STOP | `15-ride-next-stop` |
| V2 / 13 Arrived | same | ARRIVED | `16-ride-arrived` |
| V2 / 14 Degraded data | same | DEGRADED_DATA | `18-ride-delayed` |
| V2 / 15 Vehicle temporarily lost | same | VEHICLE_TEMPORARILY_LOST | `19-ride-vehicle-lost` |
| V2 / 16 Offline / provider failure | same | OFFLINE | `20-ride-offline` |
| V2 / 17 Reopen active journey | same, `resumedAfterRelaunch` | ACTIVE after relaunch | `22-ride-resumed` |
| V2 / 18 Missed stop recovery | same | PASSED_DESTINATION | `17-ride-passed` |
| V2 / 19 End journey | `RideEndView` › `RideEndContent` | ENDED | `24-end-arrived`, `25-end-passed` |
| V2 / Dark · 02, 08, 10, 12 | same, dark | — | `*-dark` |
| (no frame) signals disagree | `RideContent` checking banner | checking | `21-ride-checking` |
| (no frame) Live Activities off | `RideContent` notice | ACTIVE | `23-ride-live-activity-off` |
| Live Activity & Dynamic Island board `160:1208` | `LiveActivitySurfaces.swift` | all ride moments | `la-lockscreen-*`, `di-compact-*`, `di-minimal-*`, `di-expanded-*` |

## Product V3 board (2026-10-01)

The hand-off frames V3 20–24 are on `03 iOS — GO` (`205:3310`); V3 25–27 on
`09 Return / Rescue` › `Return / Rescue · Product V3` (`193:2956`). All are built from the
V2 components (`Icon / V2`, `Button / V2`, `RouteBadge / V2`, `StopRow / V2`,
`돌이 / V2`) and bound to the `TAPSO V2 Semantic` variables; in 25–27 the last-bus rows,
the rescue options and the countdown surfaces are instances of the `02G iOS Product V3`
components. Sample data is synthetic and labelled so on the boards.

| Figma frame | SwiftUI | Snapshot |
|---|---|---|
| V3 / 20 Map import · place found (`193:2961`) | `MapImportContent` + `SharedPlaceCard` | `08-map-import-found` |
| V3 / 21 Map import · outside Jeju (`193:2990`) | same | `26-map-import-outside-jeju` |
| V3 / 22 Map import · link only (`193:3019`) | same | `27-map-import-link-only` |
| V3 / 23 Live stops · near the shared place (`193:3049`) | `LiveStopPickerContent` › `suggestions(for:after:)` | (stateful; covered by `TapsoAPIClientTests`) |
| V3 / 24 Share sheet · place found (`193:3098`) | `ShareExtension` › `ShareSheetView` | (extension; no snapshot target yet) |
| V3 / 25 End · walk to the place, last buses (`193:3125`) | `RideEndContent` + `ReturnTripCard` | `28-end-walk-to-place`, `29-end-return-trip` |
| V3 / 26 Passed stop · next stop, walk back (`195:3021`) | `RideHeroCard` › `passed` + `RescueOptionList` | `17-ride-passed` (demo: no distance), `30-ride-passed-walk-back` |
| V3 / 27 Return countdown · Lock Screen, island, end card (`199:3046`) | `ReturnLockScreenView`, `ReturnIsland*`, `ReturnTripRow` › `pinControl` | `la-lockscreen-return-countdown`, `la-lockscreen-return-late`, `di-*-return-*`, `31-end-return-countdown` |

The `RideHero / V2` › `moment=passed` variant (`155:230`) now matches the code:
`color/journey/next` at 8 % behind a 2 pt `color/journey/next` stroke. It was a
solid fill, which hid the coral headline on `V2 / 18 Missed stop recovery`.

## Marketing site V3 (2026-10-01)

`11 Marketing Web` › `Web / Marketing V3 · 2026-10-01 · code main@55c648e` (`218:2`)
rebuilds the page as built (`MARKETING_SITE_V3.md`): `apps/web` at `main@55c648e`,
rendered with reduced motion and written back as editable layers. The code is the
source of truth; regenerate the frames when `apps/web` changes.

| Width | Frame |
|---|---|
| 1440 · large desktop | `219:2` |
| 1280 · laptop | `231:2` |
| 390 · mobile | `241:2` |
| 360 · compact mobile | `258:2` |

Layer names carry the element and its classes (`section#confirm.chapter…`), so a
layer leads to its component in `apps/web/src`. Solid colours are bound to
`TAPSO V2 Semantic` (text, backgrounds, separator, identity colours) or, for brand,
state and translucent colours, to `TAPSO Primitives`; `jeju/sand` and
`jeju/sand-deep` mirror `--sand` and `--sand-deep` in `tokens.css`. Auto layout is
applied where the page's spacing is regular.

## Known deltas between Figma and code

| Delta | Why |
|---|---|
| Figma text uses Noto Sans KR / Inter | SF fonts do not render in this Figma runtime |
| Island outlines are drawn rectangles/capsules | iOS draws the island; only a device shows the real shape |
| Figma frames are 402 × 874 only | Device widths 375 and 440 and AX3 text are covered by snapshot evidence, not frames |
| Search frame shows a typed query without the keyboard | Keyboard is system UI |
| Figma shows `••0001` / `••0002`; code masks synthetic plates from `DemoCatalog.plate(for:)` | Both are synthetic |
| Web frames set Noto Sans KR, and wrapped Korean breaks only between words, with hard line breaks | Pretendard is not available to Figma here and Figma has no `word-break: keep-all`; Noto Sans KR runs wider, so a few paragraphs take one more line |
| Web chapter backgrounds are `band ·` rectangles; the bus scene's road and the privacy lines are dashed strokes | The site paints them with a box-shadow and repeating gradients |

# Tourist pivot: TAPSO as the multilingual Jeju bus guide for foreign visitors

## Positioning

TAPSO becomes the bus companion foreign tourists reach for in Jeju: tell it
where you're getting off, and it watches the ride in your language — then taps
you (Live Activity / Dynamic Island) before your stop, even with the phone away.

**Target:** foreign tourists visiting Jeju who ride local buses and can't read
Korean stop announcements. First contact is typically Jeju International
Airport, which is why the airport is a first-class guide stop.

**Differentiators**

1. **Multilingual guidance, not a translated app.** A scoped ko/en/zh/ja table
   (~36 keys) covers the tourist journey — boarding, remaining stops, get-off
   alerts, arrival, Live Activity copy — with an explicit per-key fallback
   (requested → ko → en → key) so the UI never renders an empty string.
2. **Get-off alerts that work with the phone away.** The existing ActivityKit
   Live Activity / Dynamic Island surfaces speak the tourist's language; the
   "don't miss your stop" promise is the product, not a feature.
3. **Verified stop data.** The tourist guides key off the canonical catalog
   (989 variants, 4,338 stops) by provider stop ID — the same IDs the ride
   logic uses — so a guide never points at a renamed or retired stop.

**Non-goals**

- A general-purpose alighting alarm for domestic riders. The ko/en product
  surface (`Localizable.strings`) is untouched; this pivot adds, it doesn't
  reposition the existing product.
- Full translation of the 4,338-stop catalog. Out of scope by decision: 30
  curated tourist stops carry en/zh/ja one-liners; every other stop keeps its
  Korean catalog name.
- Replacing the device locale for the whole app. The tourist table is an
  in-app guide language; the product surface keeps following the system locale.

## What shipped (this PR)

| Piece | Location | Notes |
|---|---|---|
| Tourist string tables (ko/en/zh/ja, 36 keys) + `TouristText` resolver with fallback | `apps/ios/Shared/TouristStrings.swift` | In `Shared` so the Live Activity extension resolves the same copy. Tables live in Swift, not `.strings`, deliberately: only ~36 keys are translated, and per-key fallback (requested → ko → en) is not something a strings bundle does. Checked by `scripts/ios/check_tourist_strings.py` (parity, no empties, every used key exists). |
| Guide-language preference + picker UI | `apps/ios/TapsoApp/TouristLanguageSettings.swift` | `TouristLanguageStore` (`nil` = Automatic → device locale: ko→ko, zh*→zh-Hans, ja→ja, else en). Wired additively: one property on `TapsoAppModel`, one row at the foot of the first-run `HomeIntroCard`, one sheet. |
| 30 curated tourist stop guides (en/zh/ja blurbs, IDs verified against the catalog) | `packages/transit-core/Sources/TapsoTransit/TouristStopGuides.swift` | `touristGuide(forStopId:)`; UI-independent per the repo's layering rule. Tests in `TouristStopGuidesTests.swift`. |
| Positioning doc | this file | — |
| README section | `README.md` | section added, existing content untouched |

## Scope notes

- **4,338-stop full translation is out of scope.** The guides cover the 30
  stops foreign visitors use most (airport, Hamdeok/Hyeopjae/Geumneung/Gwakji/
  Gimnyeong/Woljeongri beaches, Seongsan Ilchulbong, Manjanggul, Seopjikoji,
  Jungmun, Cheonjiyeon, O'sulloc, Udo ferry at Seongsan Port, Hallasan
  trailheads Eorimok/Seongpanak, 1100 Highland, Dongmun & Olle markets, Folk
  Village, Hueree, Sangumburi, Stone Park, Aerospace Museum, Halla Arboretum,
  Hallim Park, Soesokkak, Oedolgae, both bus terminals). Spots without a
  catalog stop (e.g. Jeongbang Falls) are not listed — guides only reference
  stops that exist in the catalog.
- **The preference is app-side for now.** The Live Activity extension reads the
  device locale today; sharing the tourist-language choice into the extension
  via the app group is planned follow-up, not this PR.

## Future work (not this PR)

- Render `touristGuide(forStopId:)` in destination search and the ride screen
  (`tourist.guide.title` / `tourist.guide.empty` keys already exist for it).
- Localize Live Activity copy per the tourist-language preference (app-group
  shared default).
- zh-Hant variant if Hong Kong/Taiwan usage warrants it; the enum is ready.
- Grow the curated list beyond 30 based on real tourist ride data.

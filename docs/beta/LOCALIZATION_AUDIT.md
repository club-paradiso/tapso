# Localization and Korean copy audit (2026-10-20)

## Languages

| Language | Interface (`.lproj`) | Review status | Server alerts |
|---|---|---|---|
| Korean (source) | 560 keys | humanize-korean pass (below) | yes |
| English | 560 keys | written by the team | yes |
| Simplified Chinese | 560 keys | **machine-translated, not native-reviewed** | yes |
| Japanese | 560 keys | **machine-translated, not native-reviewed** | yes |

`scripts/ios/check_localization.py` checks every table against Korean: same keys, same format arguments (type and
count, position-aware), no empty values, no U+202F or U+00A0.

`RidePresentationTests.testCopyNeverShowsEngineeringLanguage` runs in all four languages.

## Four distinct things, never mixed

1. **Interface language:** the app's `.lproj`, following iOS (Settings › TAPSO › Language for a per-app choice).
2. **Journey language** (`JourneyLanguage`): fixed at ride start from the interface language actually in use.
   - Sent with `POST /v1/sessions` as `language`, which drives the server's Live Activity alert text.
   - Carried in `TapsoActivityAttributes.language`; the Lock Screen and Dynamic Island render with that locale.
3. **Official stop names:** always the catalog's Korean, never translated or romanized by TAPSO.
4. **Curated tourist descriptions** (`TouristStopGuides.swift`): 30 stops, spot names in ko/en/zh/ja and
   one-liners in en/zh/ja.
   - Each id and Korean name is checked against `services/api/data/jeju-transit-catalog.json`; all 30 match and
     all 30 are destinations.
   - They cover 30 of 4,338 stops, not the network.

**Multilingual search, honestly scoped.**
- Typing "Seongsan" or "城山日出峰" finds the curated spot and opens its official Korean stop
  (`DestinationSearchIndex.touristSearch`).
- Other foreign-language queries still find nothing among stops. The place lookup (Kakao Local, then Apple Maps)
  may still resolve them; whether Apple Maps resolves foreign names in Jeju is NOT_TESTED on a device.

## Korean copy pass

- **Method:** the installed `humanize-korean-personal` skill (a port of im-not-ai `humanize-korean` v2.3.2),
  STANDARD route, app-UX genre.
- **Gates:** `verify_change_rate.py` and `verify_gates.py` from the skill.

| Measure | Result |
|---|---|
| Values inspected | 541 (538 Localizable, 3 InfoPlist) |
| Values changed | 48, plus 3 meaning fixes on review (below) |
| Change rate | 1.8% overall; 17.1% within changed values |
| Self-check | 6/6 |
| Modality loss | none (gate passed) |

**Frozen keys.** These are mirrored verbatim by the server, so they were not touched: `alert.*`,
`ride.prepare|nextStop|arrived.headline|detail`, and `brand.*`.

**Notable decisions.**
- **Degraded states** now differ:
  - delayed: 버스 위치가 늦게 들어와요
  - vehicleLost: 버스가 잠시 안 보여요
  - offline: 인터넷 연결이 끊겼어요
  - checking: 버스 위치를 다시 확인하고 있어요

  Each detail line says what TAPSO knows or will do, then what the rider can check.
- **Status labels:**

  | Before | After |
  |---|---|
  | 차량 확인됨 | 확인한 버스 |
  | 업데이트 지연 | 위치 정보 지연 |
  | 오프라인 | 연결 끊김 |

  "서버" is gone from the error lines.
- **Same action, same words:**

  | Action | Wording |
  |---|---|
  | Confirm the bus | 이 버스 확인하기 |
  | Manual recheck | 다시 확인하기 |
  | Abandon the ride | 여정 종료하기 (confirmation dialog unchanged) |
  | Got off | 내렸어요 (unchanged) |

- **Meaning fixes made on review**, in all four languages:
  - Confirming a bus no longer claims the rider is aboard. Before: "맞아요, 이 버스를 탔어요" and "탄 버스를
    골라주세요". After: "이 버스 확인하기" and "타는 버스를 골라 주세요".
  - Past the destination, the finishing button reads "안내 마치기", not "내렸어요": the rider may still be on
    the bus.
- **Kept:** "탑서 서버" in the location-permission prompts. It is a precise privacy statement.

**Still open.**
- The degraded detail lines say "차내 안내방송" even when the rider is still at the stop. This predates the pass.
- "해주세요" without a space remains in frozen keys.

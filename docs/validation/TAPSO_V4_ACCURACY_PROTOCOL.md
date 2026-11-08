# TAPSO V4 accuracy protocol and incident template

Status: protocol defined 2026-11-08. **No comparative observation has been collected.** No claim that TAPSO is more or less accurate than KakaoMap, NAVER Map or Jeju BIS is supported by this repository.

## 1. The 2026-11-07 report

The owner reported that NAVER Map and KakaoMap both gave incorrect bus information during an evening journey in Jeju on 2026-11-07. Status: **user-reported incident, not verified.** Route, stops, times, screenshots and the nature of the error are `UNKNOWN` and are not filled in here. To turn it into evidence, the owner completes the template in §2 from their own screenshots and memory, marking each field's source.

## 2. Incident template

Copy to `docs/validation/incidents/YYYY-MM-DD-<route>.md`. Every field gets a source label: `SCREENSHOT`, `RIDER_MEMORY`, `OFFICIAL_SOURCE`, `TAPSO_LOG`, `UNKNOWN`.

```markdown
# Incident <date> route <no>

| Field | Value | Source |
|---|---|---|
| Route number and direction (endpoint names as signed on the bus) | | |
| TAGO route ID (from TAPSO catalog, if resolvable) | | |
| Boarding stop (name as on the sign; TAGO stop ID if known) | | |
| Destination stop | | |
| Local date and time the guidance was read (KST) | | |
| KakaoMap guidance (exact words, times, "n분 후", "n정류장 전") | | |
| NAVER Map guidance | | |
| Jeju BIS (bus.jeju.go.kr / stop display) guidance | | |
| TAPSO guidance (screen, Live Activity, NightGuard status) | | |
| What actually happened: bus arrived / passed / never came, at what time | | |
| How "actual" was established (watch time, photo timestamp) | | |
| Screenshots (file names, with original timestamps preserved) | | |
| Official timetable for that service day (scheduleId, table times) | | |

## Classification (choose all that apply; one line of evidence each)
- [ ] wrong route recommended
- [ ] wrong direction
- [ ] claimed a service operating that did not (false positive)
- [ ] last-bus error (said one remained / said none remained)
- [ ] arrival prediction error (predicted − actual = ___ min)
- [ ] update missing or delayed
- [ ] wrong get-off warning
- [ ] data unavailable (app said it did not know) — this is NOT a wrong answer
- [ ] cannot classify: evidence insufficient

## Regression case
If the incident is reproducible from data TAPSO holds, add a deterministic test (synthetic fixture labelled SYNTHETIC if the real data cannot be committed) and link it here.
```

## 3. Comparison protocol

1. **Observation unit.** One (route, direction, boarding stop, KST minute) at which an observer reads all apps within 60 s and then records the actual bus passage at that stop.
2. **Equivalence.** Same stop (verify by stop name and position on each app's map), same direction, same minute. Discard an observation if any app shows a different stop.
3. **No scraping.** Apps are read by a person on a phone. No automated access to KakaoMap, NAVER Map or Jeju BIS endpoints.
4. **Ground truth.** The observer's own record of arrival or passage (phone clock, photo EXIF). No app's own data is ground truth.
5. **Metrics, per app.**
   - wrong-route, wrong-direction, false-operating, last-bus-error counts / observations
   - arrival error: median and P90 of |predicted − actual| over observations where a prediction was shown
   - missed or delayed update rate
   - wrong get-off warning rate (TAPSO only, during rides)
   - **unavailable rate, reported separately**: "I don't know" is not counted as wrong
6. **Sample size.** No comparative statement before at least 30 observations per app across at least 5 routes, 3 evening sessions and one late-night (after 22:00) session. Report counts with every percentage.
7. **Reporting.** Raw observation sheet committed without vehicle plates or personal data; screenshots kept out of Git unless redacted.

## 4. Regression suite

Each documented incident with enough data becomes a test in `services/api/test/` (server truth) or `packages/transit-core/Tests/` (presentation). Current night-time regression coverage added on this branch: `services/api/test/nightGuard.test.ts` (midnight service day, last trip started, conditional winter trip, unstated day type, conflict, stale bundle) — all synthetic or from the committed 2026-10-03 bundle.

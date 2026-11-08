# First-bus check, Monday 2026-11-09 (weekday, not a holiday)

Question asked by the owner: when the first buses run, does what TAPSO's official timetable bundle says match what the live feed shows, and is the timetable data TAPSO holds accurate?

Scope: routes 365, 785, 791. One morning, one observer. This is a spot check, not a validation of the timetable.

## Method

- Live: `scripts/live-evidence/observe.ts --routes 365,785,791 --minutes 75 --interval 30`, 05:44:50–06:59:23 KST, every catalog variant of each route through `https://tapso-api.vercel.app/v1/vehicles` (TAGO via TAPSO's 20 s cache). Summary: `artifacts/live-evidence/2026-11-08T2044-summary.json` (UTC stamp). Raw pseudonymised receipts stay in ignored `work/live-evidence/`.
- Timetable: the bundle on this branch (`retrievedOn` 2026-10-03) and the 2026-11-05 bundle of PR #202, both read from the official BIS files (`OFFICIAL_DATED`).
- Arrival API (15098530): `Arrival probe` workflow, run 42500042806 attempt 4, 06:13–06:15 KST.

How to read the times below (all `OBSERVED`, receipt times, not observation times; TAGO publishes none):
- *seen at seq 1*: the first receipt in which the vehicle reports the variant's first stop as the stop last passed. A bus usually appears there while it waits at the terminus.
- *left by*: the first receipt reporting a later stop. Departure lies between the last seq-1 receipt and this one.
- Each receipt can be up to ~20 s old (cache) and polls are 30 s apart, so ±1 min is noise.
- A vehicle in the feed is not proof that it ran a scheduled trip. Matching a vehicle to a timetable trip below is by start stop and time only (`ESTIMATED`).
- Vehicle labels A, B, … are per-document; no plates or pseudonyms are published.

## Results per route

### 365 (weekday tables identical in both bundles)

| Official departure (`OFFICIAL_DATED`) | Variant start stop | Seen at seq 1 | Left by | Verdict |
|---|---|---|---|---|
| 06:00 제주대학교병원 (summary row: "첫차(제주대학교병원 출발) 6:00") | 제주대학교병원 (…530) | 06:00:21 | 06:02:54 | consistent |
| 06:03 월성마을 (summary row: "첫차(월성마을 출발) 6:03") | 월성마을/선사유적지 (…525) | 06:02:22 | 06:04:21 | consistent |
| 06:13 한라대 | 제주한라대학교 (…524) | 06:13:21 | 06:15:23 | consistent |
| 06:15 (제주대 direction) | 제주대학교병원 (…530) | 06:15:23 | 06:17:55 | consistent |
| 06:25 제주대 | 제주대학교 (…521) | 06:24:51 | 06:26:21 | consistent |
| 06:26 한라대 | 제주한라대학교 (…524) | 06:27:52 | 06:30:57 | consistent, ~4 min after the table |
| 06:39 한라대 | 제주한라대학교 (…524) | 06:37:52 | 06:40:52 | consistent |
| 06:40 제주대 | 제주대학교 (…521) | 06:40:27 | 06:41:22 | consistent |
| 06:50 한라대 | 제주한라대학교 (…524) | 06:50:22 | 06:53:52 | consistent |
| 06:55 제주대 | 제주대학교 (…521) | 06:55:24 | 06:57:22 | consistent |
| **06:00 한라대** (trip row in the 한라대→제주대 table) | 제주한라대학교 (…522/…524) | **not seen** | — | **not observed** |

The 06:00 한라대 trip: polls at 06:00, 06:02, 06:03, 06:07, 06:09 and 06:11 answered and showed no vehicle at 제주한라대학교 on either variant that starts there; the first 한라대 departure seen was 06:13. The same official file's own summary row for this direction says "첫차(월성마을 출발) 6:03", which is what was observed. So the file contradicts itself (06:00 trip row vs 06:03 summary), and today's feed agrees with the summary. One morning cannot rule out a bus that ran with its terminal switched off: `CONFLICTED` (source row vs source summary), not "the 06:00 trip does not exist". NightGuard currently reads trip rows, so it says the 한라대-direction first departure is 06:00.

A vehicle first appeared on …522 at 06:34 already at seq 14 (월성마을/선사유적지), i.e. mid-route at the 월성마을 start point; it is not the 06:00 한라대 trip.

### 785

| Official departure | Variant start stop | Seen at seq 1 | Left by | Verdict |
|---|---|---|---|---|
| 06:37 신창 농산물유통센터 (both bundles) | 신창리 농산물종합유통센터 (…510) | 06:28:23 | 06:38:24 | consistent: waited 9 min at the terminus, left at the table time |
| 06:37 한림체육관후문 (both bundles) | 한림체육관 후문 (…507) | 06:37:22 | 06:39:54 | consistent |

Both first departures match. But see "Data defects" below: TAPSO withholds 785's 2026-11-05 table entirely (`source_conflict`), so on the new bundle the rider would get no 785 timetable at all, even though its weekday sheets look right.

### 791 (table changed on 2026-10-30)

| Official departure | Seen at seq 1 | Left by | 2026-10-03 table | 2026-11-05 table |
|---|---|---|---|---|
| 1st trip from 성수동 | 06:26:53 (polls 06:22–06:26:29 answered, no vehicle) | 06:28:23 | 06:28: on time | 06:25: ~3 min late |
| 2nd trip from 성수동 | (06:55:53–06:56:23 polls failed) | 06:56:53 already at seq 2 | 06:58: left ≥1 min early | 06:55: ~1–2 min late |

Inconclusive: trip 1 fits the old table, trip 2 fits the new one (buses leaving early is less usual than leaving late, which slightly favours the new table). The difference is 3 minutes, inside what one morning of receipts can resolve. Not evidence against PR #202.

## Feed and data defects found

1. **791 stop sequence no longer matches TAPSO's catalog (`OBSERVED`).** At 07:0x KST a 791 vehicle on …579101 reported sequence 43 with stop id JEB405000451 (고성1리사무소[남]); TAPSO's catalog has that stop at sequence 36 and 던덕모롤 at 43. The feed-quality layer flagged it: 22 of 44 rows `stop_id_mismatch` and 18 `far_from_reported_stop`. The catalog (`generatedAt` 2026-10-03) predates the 2026-10-30 revision that also changed 791's and 785's timetables (785 gained a 저지조개왓 timepoint). Consequence: on the latter half of 791, TAPSO would place the bus 7 stops away from where it is if it trusted sequence numbers; today those rows are reported as suspect and not counted. 785 had 7 suspect rows (4 `stop_id_mismatch`, 3 `far_from_reported_stop`), same likely cause, not individually confirmed. Next action: regenerate the catalog from TAGO and diff 785/791 stop lists.
2. **785 2026-11-05 file is self-contradictory**: the 토·공휴일 sheet's header row holds times ("06:40>06:50>…") instead of stop names; TAPSO correctly withholds the whole route as `source_conflict`. Weekday rows match the feed today.
3. **365 first-trip contradiction** above (06:00 한라대 trip row vs "첫차(월성마을 출발) 6:03" summary).
4. **TAPSO API 502s (`OBSERVED`, cause `UNKNOWN`).** 708 of 2,400 `/v1/vehicles` requests (29.5 %) returned HTTP 502 (1 × 504), always for every variant of a route in the same poll, in bursts (05:59–06:22 and 06:40–06:59 KST). The 2026-11-08 12:00 KST run (552 requests) had none. This run's own load was 32 requests/min through the 20 s cache; whether the cause is TAGO, the key's quota, or Vercel is not known from here. While a poll fails, the app shows no vehicle for that route. Next action: read the production function logs for those windows before changing anything.

## Arrival API at 06:13 (15098530)

Control call to the location service: HTTP 200. 18 calls (3 rounds × 6 stops on 365 variants …521/…522), 18 answered HTTP 200, 213 prediction rows, 0 rejected by the parser. Route 365 appeared in the predictions at four stops, but every row belonged to other variants; …521/…522 had no vehicles at that minute, so agreement with positions could not be tested (consistent 0, inconsistent 0, other variant 213). The probe samples the wrong variants for early morning: next run should sample the variants that carry the first trips (…524, …525, …530).

## What this says about timetable accuracy

- Of the 13 first-hour departures listed for 365 and 785, 12 had a vehicle leave the start stop at the table time or up to ~4 min after it. This is `OBSERVED` agreement for one weekday morning, not proof of accuracy.
- One official trip row (365, 06:00 한라대) had no visible vehicle and is contradicted by the same file's summary.
- 791's 3-minute revision could not be resolved either way.
- The bigger accuracy risk today is not the timetables but the **stop catalog**: it is older than the 2026-10-30 route revisions.

PR #202 (2026-11-05 bundle): nothing here argues against merging it. 365 is unchanged; 785's withholding is correct behaviour for a self-contradictory file; 791's new table is not contradicted. Merging it also stops this branch's checks from reading a 37-day-old ("aging") bundle.

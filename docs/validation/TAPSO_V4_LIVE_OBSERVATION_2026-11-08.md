# Live observation, 2026-11-08 (Sunday 12:00–12:12 KST)

Label: `OBSERVED`. The data was read through TAPSO's public `/v1/vehicles`, which reads TAGO through a 20 s cache. TAGO publishes no observation time, so every time below is a receipt time. **This is not ground truth.** Nobody watched a bus. The run says only what the provider reported and how well those reports agree with the route's own stop list and the official timetable.

## Run

| Item | Value |
|---|---|
| Command | `NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/live-evidence/observe.ts --routes 365,281,3002,5001,800-1,132 --minutes 12 --interval 30` |
| Window | 2026-11-08T03:00:28Z – 03:12:03Z (Sunday 12:00–12:12 KST, daytime) |
| Polls | 24 per route number, every 30 s |
| Requests | 552 (23 variants × 24), **0 failed** |
| Vehicle rows | 543 (365: 190; 281: 305; 132: 48; 3002, 5001, 800-1: 0) |
| Distinct vehicles | 25 (pseudonymised; the per-run salt was not kept) |
| Committed summary | `artifacts/live-evidence/2026-11-08T0300-summary.json` |
| Raw (pseudonyms only) | `work/live-evidence/` (ignored, not committed) |

## Findings

1. **One feed-quality rule was wrong, and this run caught it.**
   - The first rule flagged a row as `far_from_reported_stop` when it was more than 5 km from the stop it names. It flagged 2 of 543 rows:
     - one on 5·16-ro (route 281, `JEB405328102`, 수악교 → 성판악: a 5,382 m gap, bus 72 m before 성판악);
     - one on Bijarim-ro (route 132, `JEB405413201`, 교래입구 → 교래사거리: a 5,306 m gap, bus 322 m before the next stop).
   - TAGO's `nodeord` names the stop the bus *last passed*, so on a long gap a healthy bus is far from that stop.
   - The catalog has 377 consecutive stop gaps over 5 km (out of 50,464; the longest is 24.8 km).
   - The rule now uses the segment: a row is suspect only when the sum of its distances to the stop it last passed and the next stop exceeds 1.5 × the gap + 2 km (`ASSUMED`).
   - Rescored on the same 543 rows: **0 suspect** (before: 2, both false). The regression test is `liveFeedQuality.test.ts` › "regression (live, 2026-11-08)".
   - The committed summary keeps the original count of 2, because it records that run as it happened.
2. **No other contradiction in this window.**
   - No sequence out of range.
   - No vehicle on two variants at once.
   - No row outside Jeju.
   - No backward sequence (receipt order).
   - No run of 6 identical receipts.
   - `stop_id_mismatch` could not be checked on the rescore, because the raw record keeps no stop IDs.
3. **Rows change almost every poll.** Rows changed once every 1.12–1.14 receipts at a 30 s poll on 365, 281 and 132. The provider's position for a running bus changed within roughly every 30 s plus cache. This rests only on receipt times, so the provider's own update interval stays `UNKNOWN`.
4. **Timetable × live cross-check.**
   - **365**: the timetable said departures remain on 24/24 polls, and live showed buses on 24/24.
   - **281, 132**: no usable timetable for the day (`no_usable_schedule`: the tables state no day type, or are withheld). Buses were seen on all polls. TAPSO could therefore say a vehicle was reported, but not whether the timetable expected one.
   - **3002, 5001, 800-1** (night or "심야" services): 0 vehicles at midday. Their tables are `unstated`, so there was no schedule to compare against. Absence at noon is consistent with night service, but by rule it is not evidence of anything.
   - No poll showed a vehicle while the timetable said the last bus had left or the first had not yet run.
5. **Latency.**
   - Measured from the agent container through its egress proxy: p50 382 ms, p90 1,063 ms, p99 4,606 ms, max 7,840 ms per `/v1/vehicles` call.
   - The proxy adds unmeasured overhead, so these are upper bounds for a client, not server latency.

## Not covered

- **Night.** The window was daytime, so NightGuard's after-midnight path was not exercised live. It is covered by synthetic tests only.
- **Ground truth.** Nobody observed a bus physically. Agreement here is between TAGO, the TAGO-derived catalog and the BIS timetable, which may share an upstream.
- **Arrival predictions** (15098530). Blocked: the repository has no `TAGO_SERVICE_KEY` secret (Arrival probe run 42441078221 printed `BLOCKED`).

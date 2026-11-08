# TAPSO V4 performance baseline

Measured 2026-11-08 in the agent container (Linux, 4 vCPU, Node 22.23.4). These are local measurements, not production latencies. Production API latency, Vercel cost and iOS energy were **not measured** (`UNAVAILABLE`: no runtime-log access recorded for `tapso-api` in earlier sessions; no device).

## 1. Test suite

| Measure | Before (main `52fa468`) | After (this branch) |
|---|---|---|
| API tests | 988 pass, 0 fail | 1018 pass, 0 fail |
| `node --test` duration | 37.7 s | 36.5 s |
| Wall clock (`time npm test`) | 37.9 s | — |

Difference in duration is within run-to-run noise; no optimisation is claimed.

## 2. Timetable evaluation cost (`OBSERVED`, script in the PR description)

All 256 timetable route numbers, 3 warm-up passes, then 20 timed passes (5,120 samples each):

| Function | p50 | p95 | max |
|---|---|---|---|
| `routeTimetableView` (existing) | 0.013 ms | 0.038 ms | 0.95 ms |
| `nightGuardView` (new) | 0.065 ms | 0.258 ms | 0.80 ms |
| `validateTimetableBundle` (once per cold instance) | 22.7 ms | — | — |

NightGuard is CPU-trivial per request; it reads no provider.

## 3. Payload size

| Response body (`item` only), Route 365 | Bytes |
|---|---|
| `/v1/timetables?routeNo=365` view | 26,801 |
| `/v1/night-guard?routeNo=365` view | 1,630 |

A client that needs only tonight's status downloads 94 % less. (No client uses it yet.)

## 4. NightGuard coverage on the real bundle (`OBSERVED`)

| Instant (KST) | Route numbers with an `OFFICIAL_DATED` answer | Entries `unknown` / unstated day | Entries withheld as conflicts |
|---|---|---|---|
| Mon 2026-11-09 21:30 | 15 / 256 | 341 | 59 |
| Sat 2026-11-14 21:30 | 13 / 256 | 341 | 57 |
| Sun 2026-11-15 21:30 | 15 / 256 | 341 | 55 |

## 5. Caching and provider requests (from code, `VERIFIED` by reading)

| Path | Policy |
|---|---|
| Public `/v1/vehicles` | 20 s per-instance TTL, concurrent-miss coalescing (`ttlCache.ts`) |
| Journey session reads | `ActiveRideSnapshotProvider`: 5 s per-route share, single flight, 600 upstream reads / min / instance budget (all `PROVISIONAL`) |
| One session poll | 0 or 1 logical TAGO call; ≤ 2 HTTP attempts (one retry) |
| `/v1/timetables?routeNo=` | `s-maxage=600` |
| `/v1/night-guard` (new) | `s-maxage` = seconds to next status change, capped at 60; no provider request |

Static topology (catalog: `s-maxage=86400`, ETag), published timetables (dated bundle) and live positions (seconds) keep separate freshness policies. The new endpoint adds **zero** provider requests.

## 6. Live read latency (`OBSERVED` 2026-11-08, `claude/v4-live-evidence`)

552 `/v1/vehicles` calls to production from the agent container, through its egress proxy, Sunday 12:00–12:12 KST: p50 382 ms, p90 1,063 ms, p99 4,606 ms, max 7,840 ms, 0 failures. The proxy adds unmeasured overhead, so these are client-side upper bounds.

`GET /v1/operating-status` costs one cached `/v1/vehicles` read per variant: 365 needs 6. Route numbers with more than 12 variants (201, 202, 231, 232, 346, 360, 510) are not read live. Its response is cached 20 s, the same as vehicles. It adds no TAGO request beyond what the 20 s vehicle cache already allows per variant.

## 7. Not measured; next steps

- Production p50/p95 per endpoint: needs Vercel runtime logs (`get_runtime_logs`) with access to `tapso-api`.
- iOS startup, memory, SwiftUI recomputation (catalog scans in `body`, UX audit U-12): needs Instruments on macOS.
- GitHub Actions minutes per workflow: readable from the Actions API; not collected here.
- Vercel build cost: PR #197 addresses Git-triggered builds; not evaluated here.

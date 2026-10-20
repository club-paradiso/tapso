# Beta operations: what to watch, how to respond

Built only on data that exists today. No new infrastructure or analytics SDK.

## Where the signals are

| Signal | Source | How to read |
|---|---|---|
| API up and configured | `GET /health` (public) | sessions store, APNs `enabled`/`missing`, places, build commit |
| API smoke and session lifecycle | GitHub Actions `post-deploy.yml`, daily 01:23 UTC and after each API deploy | Actions tab; a red run is an incident |
| Ride creation, reads, trust and provider outcomes | Vercel runtime logs, events `journey_session_created` / `journey_session_read` (`trust`, `provider`, `observation`, `position`, `vehicle`, `progressSource`), keyed by `sessionRef` (one-way, 12 hex) | Vercel › tapso-api › Logs, filter by event |
| Rides refused by the deployment budget | event `journey_session_create_refused` | same |
| Bus confirmations | event `vehicle_match_confirmed` | same |
| Live Activity pushes accepted by APNs | events `live_activity_tick` (counts), `live_activity_push_skipped`; collector `live_activity_ticker` on Railway | Accepted by APNs **does not mean seen**: only device evidence shows a rider saw or heard it |
| Tester reports | `GET /operator/feedback?limit=50` with `Authorization: Bearer $RIDE_CAPTURE_OPERATOR_TOKEN` | JSON, newest first; entries expire after 30 days |
| Matcher safety | `matcher-evidence.yml` weekly | readiness stays `READY_FOR_SHADOW` |

## Beta indicators

Computed weekly by hand from the sources above. Each line names its denominator.

| Indicator | Definition | Source |
|---|---|---|
| Ride creation success | `journey_session_created` ÷ `POST /v1/sessions` requests | Vercel logs (`transit_api_request` route `session_create`) |
| Bus confirmation rate | sessions with `vehicle_match_confirmed` ÷ sessions created | logs, joined on `sessionRef` |
| Degraded share | reads with `trust` ≠ `live` ÷ reads, for confirmed rides | `journey_session_read` |
| Provider error rate | 5xx and `PROVIDER_*` ÷ requests | `transit_api_request` |
| APNs accepted | accepted ÷ attempted pushes | tick and push logs (zero until APNs is configured) |
| Device-observed alerts | protocol cases B-7/B-8 and R-* where the tester recorded the alert | `artifacts/device-validation/` |
| Wrong stop count reports | `wrong_remaining_stops` reports ÷ rides | `/operator/feedback` |
| Missed warnings | `missed_alert` reports ÷ rides | same |
| Crashes | `app_froze_or_quit` reports. No crash reporter is installed; TestFlight crash reports once TestFlight is used | feedback, App Store Connect |

## Pilot load bounds

- **New rides:** at most 30 per minute per deployment (`TRANSIT_SESSION_CREATE_LIMIT_PER_MINUTE`; 0 turns the
  limit off).
  - Each creation costs two uncached TAGO reads.
  - Over the limit the app gets 429 with Retry-After and retries.
- **Live rides:**
  - Reads go through `ActiveRideSnapshotProvider`: a 5 s shared window per route, coalescing, and 600 upstream
    reads a minute per instance.
  - The app polls every 10–15 s in the foreground; the tick samples 20 indexed rides every 20 s, only while APNs
    is on.
- **Feedback:** 5 reports a minute per caller.
- **No load test has been run against production.** One needs the owner's authorization.

## Incidents

| Symptom | First action | Rollback |
|---|---|---|
| `post-deploy` red, or `/health` failing | Check Vercel deployment status and runtime errors | Vercel › tapso-api › Deployments › promote the previous Ready deployment |
| Wrong stop counts reported by several testers | Ask testers to stop riding on that route; read `journey_session_read` lines for `progressSource`/`trust` | Revert the PR on main (the app's behaviour ships only with a new build) |
| TAGO quota or 5xx storms | Lower `TRANSIT_SESSION_CREATE_LIMIT_PER_MINUTE` | Set `TRANSIT_SESSIONS_ENABLED=false`: the app shows sessions unavailable and does not pretend to track |
| A push says something the app would not | Remove `APNS_PRIVATE_KEY` (push turns off; `/health` shows `missing`) | The app keeps updating while open |
| Suspected data exposure | Rotate `RIDE_CAPTURE_OPERATOR_TOKEN` (Vercel and Railway) and the Upstash token | — |

Every change to production configuration is logged in the PR or issue that motivated it.

# Ride Capture Controller (mobile)

A phone-sized instrument for running a controlled ride without a laptop. It is
served from the transit API project at

```text
https://tapso-api.vercel.app/ride-capture/
```

and is `noindex`, unlinked from anything public, and useless without an operator
token. Reality labels follow the repository convention: `VERIFIED` means
executed and observed, `IMPLEMENTED` means written and covered by tests.

The CLI in `scripts/ride-capture/` remains the reference implementation and the
fallback. Both produce the same `RideCapture`, and one analyzer reads both.

## Why it exists, and the one constraint that shaped it

Task B measures how often TAGO's own content changes. The public
`GET /v1/vehicles` answers from a shared 20-second cache, so polling it would
measure the cache, not the provider. The controller therefore polls a separate
authenticated path that calls `TagoTransitProvider` directly:

| | `/v1/vehicles` | `/operator/snapshot` |
|---|---|---|
| Provider | `CachedTransitProvider`, 20 s TTL | `TagoTransitProvider`, no cache |
| CDN | `s-maxage` equal to the TTL | `no-store`, and `no-store` again in `vercel.json` |
| Auth | none | `Authorization: Bearer` |
| Rate limit | 120/min per caller | 30/min per caller, separate budget |
| Upstream calls | one per TTL window | one per successful poll |

`VERIFIED` (2026-09-12, local HTTP against a synthetic upstream): two
consecutive operator polls returned different vehicle positions while two
consecutive public polls returned identical ones. The public path is unchanged.

Nothing else changes. `observedAt` is still the epoch sentinel,
`timestampSource` is still `unavailable`, the freshness policy is still
`fail_closed`, and automatic matching is still withheld.

## Endpoints

Both require `Authorization: Bearer <RIDE_CAPTURE_OPERATOR_TOKEN>` and both
answer `no-store`.

```text
GET  /operator/snapshot?routeId=…&cityCode=…
POST /operator/analyze          (body: a RideCapture, reply: the sanitized report)
```

- `GET /operator/snapshot` accepts exactly two validated identifiers and returns
  only vehicle observations. It is not a general TAGO proxy: no arbitrary
  operation, path, or upstream parameter can be reached through it.
- `POST /operator/analyze` runs the same `analyzeRideCapture` the CLI runs. The
  capture is analysed and discarded in the same request — never stored, never
  logged — and only the pseudonymised report comes back. It accepts up to 4 MiB;
  above that the controller tells the operator to export the raw capture and run
  `scripts/ride-capture/analyze.ts`.

Failure modes, all fail-closed: no token configured on the deployment →
`503 OPERATOR_DISABLED`; token missing, malformed, or wrong → `401 UNAUTHORIZED`
with one generic message for every case; bad identifier → `400 INVALID_INPUT`
before anything upstream is called.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RIDE_CAPTURE_OPERATOR_TOKEN` | yes, for the controller | unset → endpoints disabled | Shared operator secret. Minimum 24 characters; a shorter value is refused rather than accepted quietly. Set it **Sensitive** on Vercel |
| `RIDE_CAPTURE_OPERATOR_RATE_LIMIT_PER_MINUTE` | no | `30` | Per-caller ceiling on the operator budget. `0` disables the limit |

`/health` reports `operator: { enabled, rateLimitPerMinute }` — presence and
policy only. The token is never part of the config object, so it can never reach
a health payload, a log line, or a response.

Generate a token with `openssl rand -base64 32` (or any CSPRNG) and paste it
straight into the Vercel dashboard. Do not echo it into a shell, and do not put
it in the repository.

## Security boundary

- `TAGO_SERVICE_KEY` stays server-side. It is not in the page, not in the
  bundle, not in IndexedDB, not in any response, and not in any capture. The
  browser never speaks to TAGO.
- The operator token lives in `sessionStorage` for the browser session only. It
  is sent as a bearer header, never as a query parameter, so it cannot land in a
  log or a referrer.
- Token comparison is constant-time over SHA-256 digests, so a wrong guess
  reveals nothing about how wrong it was.
- The raw capture holds real vehicle numbers. It stays in IndexedDB on the phone
  and is exported by hand. The sanitized report replaces every vehicle number
  with a per-run pseudonym, and the analyzer refuses to emit a report that would
  contain one.
- The page is same-origin with the API, so the deny-by-default CORS policy is
  untouched: no browser origin is allowlisted for this.

## How the capture survives a phone

The client owns the capture. The server holds nothing between requests — ride
sessions remain disabled on serverless, and this changes none of that.

- Every snapshot, marker and lifecycle event is appended to IndexedDB as its own
  record before the next poll is scheduled. A reload loses at most the poll in
  flight, and reopening the page offers to resume.
- Polling is strictly sequential: one request in flight, persisted, then the next
  scheduled. Polls never overlap.
- A screen wake lock is requested while a capture is active and re-requested
  when the page becomes visible again. The header says `화면 켜짐 유지` or
  `화면 유지 불가` — it never claims a lock it does not hold.
- `visibilitychange`, `pagehide`, `pageshow`, `online` and `offline` are recorded
  as lifecycle events. When Safari suspends the tab, polling simply stops and
  the hole stays a hole: **no snapshot is ever manufactured for a period the
  instrument was not running.**

That last point is why the schema grew. A gap caused by a suspended browser
looks exactly like a TAGO dropout, and reading one as the other would corrupt
the cadence Task C is meant to derive. The report now carries `lifecycle` —
`hiddenSeconds`, `offlineSeconds`, `recoveries`, `wakeLockUnavailable` — and
warns that those holes are the recorder's, not the provider's.

## Route shape, and what it decides

The controller works on any Jeju TAGO route that can be pinned down: a confirmed
`cityCode`, every official variant of the number listed, one exact `routeId` and
direction chosen from that list, an ordered topology, boarding and destination
that exist on it, and a live vehicles endpoint that answers. 447 and 365 are a
preset and a regression fixture; neither appears anywhere in the capture path.

Identity is always `routeId` + `cityCode`. A route number is not identity — one
number is several routes with different topologies.

`GET /v1/stops` now classifies the stop list it returns, so the analyzer and any
client read one implementation rather than two guesses:

| Shape | What it means | Wrap-around |
|---|---|---|
| `linear` | every stop appears once | refused; a ride runs forward only |
| `loop` | the last entry repeats the first and nothing else repeats | **allowed** — the list closes, so the arc is well defined |
| `repeating` | some stop appears twice without closing the list | refused as `AMBIGUOUS_TOPOLOGY` |

A circular route is therefore rideable end-past-start: boarding 38 to destination
3 on a forty-stop loop is five stops, not minus thirty-five. Crossing the seam
counts as one step forward rather than a thirty-five-stop reversal, and the
remaining count and arrival follow the forward arc. Two things are deliberately
given up there: overshoot cannot be told from a second lap, so `passedDestination`
stays false on a wrap-around ride, and a single step longer than half the loop is
read as a short step backwards, which is the least-wrong reading of a circular
difference.

Anywhere the shape is not one of the two answerable cases, the ride is refused
before it starts. A wrong refusal costs a bus; wrong evidence costs the task.

Other shapes the preflight handles rather than assumes:

- **Several variants on one number** — all are listed with their start and end
  stop names, and the operator picks the exact `routeId`. Nothing is collapsed.
- **Two stops sharing a name** — the picker adds the official stop id to both, so
  the operator chooses the stop and not the word.
- **Nothing running right now** — the endpoint answered, the route simply has no
  bus out. That is legitimate at a terminal before the first departure, so it is
  a warning with an explicit override rather than a wall.
- **Topology changed mid-ride** — observations reporting a stop the captured
  topology does not contain are counted in `integrity.offTopologyObservations`
  and warned about, instead of being quietly absorbed.

## Schema

`RideCapture` stays at `schemaVersion: 1` and gains two optional fields:

- `events?: RideEvent[]` — instrument lifecycle, never rider ground truth.
- `source?: "cli" | "web-controller"` — which instrument produced the capture.

The report gained `topology` (the shape above, plus whether this ride wraps) and
`integrity.offTopologyObservations`. Both are additive.

Both are absent from every capture the CLI writes and are tolerated by the
analyzer either way, so CLI captures and controller captures remain
interchangeable in both directions. A version bump would have broken exactly
that, which is why there isn't one. Tests cover captures with and without the
new fields.

## Operator flow

1. **Setup / preflight.** Search a route number, see every official variant,
   pick one exact `routeId` and direction, pick boarding and destination stops
   by name, and confirm live vehicles exist right now. Boarding must come before
   destination on that direction's topology or the screen refuses to continue.
   A preset fills the fields in; it is still checked against live topology by
   sequence *and* stop id, and a drifted preset is reported rather than ridden.
2. **Ready.** Route number, direction, both stop names, the exact `routeId`, and
   one large start button.
3. **Active, before boarding.** Fresh snapshots stream in and the current
   vehicles appear as large cards showing the masked number, the stop the
   provider reports, and the sequence. Tap the bus you boarded and confirm. No
   typing. Labels show the last four characters and automatically grow longer if
   two buses would otherwise look identical.
4. **Riding.** Elapsed time, snapshot counts, tracked-vehicle presence, provider
   stop and remaining stops, last poll, connection and wake state. The stop list
   from here to the destination is offered by name; tap the one where the bus
   actually halted and the doors opened. That tap is the physical marker and is
   never derived from a provider observation. Missing a marker is better than
   guessing one.
5. **Alight and finish.** `하차` records the alighted marker, `캡처 종료`
   finalises, and the screen offers the sanitized report and, separately and
   clearly labelled private, the raw capture.

The tracked vehicle never changes by itself. Replacing it takes an explicit
confirmation and is recorded as an event.

## Known limits

- `IMPLEMENTED`, not `VERIFIED`: the browser layer — IndexedDB, the wake lock,
  the lifecycle listeners, the export sheet — has not been exercised on a real
  iPhone. The logic underneath it is covered by deterministic tests; the DOM and
  storage wrappers are not.
- iOS Safari suspends background tabs. With the screen locked or the app
  switched away, polling stops. The controller records the gap and warns on
  resume; it cannot prevent it. Keep the screen on and the page in front.
- The rate limit is per warm serverless instance, like the public one.
- A capture larger than about 3.5 MB skips the server analyze step; export the
  raw file and run the CLI analyzer.

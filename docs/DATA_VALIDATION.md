# TAGO transit data validation

## Current status

| Question | Result |
|---|---|
| B551982 resource 15157601 contract exposes route, route-stop, and realtime position APIs | `VERIFIED_FROM_OFFICIAL_METADATA` |
| Newly issued key is accepted by B551982 | `VERIFIED_FROM_AUTHENTICATED_CALL` |
| B551982 `/mst_info` returns Jeju Route 365 for tested Jeju-oriented codes | `NO`; zero rows for `50110`, `5011000000`, `50`, `5000000000` |
| TAGO Jeju city code | `39`; `VERIFIED_FROM_AUTHENTICATED_OFFICIAL_RESPONSE` |
| TAGO Route 365 official route IDs | `VERIFIED`; six variants |
| TAGO realtime vehicle positions for Route 365 | `VERIFIED` |
| TAGO live vehicle schema | `VERIFIED`; `gpslati`, `gpslong`, `nodeid`, `nodenm`, `nodeord`, `routenm`, `routetp`, `vehicleno` |
| Vehicle ID continuity | `VERIFIED_IN_BOUNDED_PROBE`; all 10 full-length vehicles present in `24/24` samples |
| Active vehicle count stability | `VERIFIED_IN_BOUNDED_PROBE`; 5/5/5 per full-length direction |
| Live stop order available | `YES`; `nodeord` present on every inspected live record |
| Full-length stop topology | `VERIFIED`; 521=`43` contiguous stops, 522=`41` contiguous stops, 100% coordinate coverage |
| TAPSO HTTP route-stop path | `VERIFIED_END_TO_END`; live TAGO 521 returned through `/v1/stops` with all 43 stops |
| Direction / variant behavior | `PARTIALLY_VERIFIED`; route ID distinguishes six endpoint variants |
| Provider observation timestamp | `NO`; TAGO location payload exposes no B551982-style timestamp |
| Event code | `NO_FIELD_OBSERVED` |
| Snapshot-content cadence | median `27.52 s`; min `10.01 s`; max observed `83.10 s` / `53.07 s` by direction |
| Temporary vehicle disappearance/reappearance | none observed in the two-minute bounded probe |
| Server-side collector holds polling continuity in background | `VERIFIED_IN_ONE_ACCEPTANCE_RUN`; 2026-09-22, max gap `7.94 s` |
| Enough evidence for automatic passenger matching | `NO`; real boarding acceptance gate remains |

## Verified TAGO Route 365 variants

Official TAGO route lookup (`cityCode=39`, `routeNo=365`) returned:

- `JEB405136521`: 제주대학교 → 제주한라대학교(종점)
- `JEB405136522`: 제주한라대학교 → 제주대학교
- `JEB405136523`: 영주고등학교 → 제주한라대학교(종점)
- `JEB405136524`: 제주한라대학교 → 영주고등학교
- `JEB405136525`: 월성마을/선사유적지 → 제주대학교
- `JEB405136530`: 제주대학교병원 → 제주한라대학교(종점)

Do not collapse these IDs into one `365` identifier. Preserve route ID plus endpoint/stop topology. All six TAGO route rows reported `routetp=급행버스`; that field is not authoritative product classification for the Jeju pilot.

## Live cadence evidence

The two continuously active full-length directions were sampled 24 times each at a five-second target interval:

- `JEB405136521`: five vehicles stable across all 24 samples; snapshot-change interval median `27.52 s`, max `83.10 s`.
- `JEB405136522`: five vehicles stable across all 24 samples; snapshot-change interval median `27.52 s`, max `53.07 s`.
- Most five-second transitions were unchanged (`94/115` and `90/115`).
- No vehicle disappearance occurred during the probe, so no dropout distribution can yet be estimated.

## Evidence inventory

Three datasets exist. They answer different questions and are not
interchangeable. The table states what each one can and cannot support, because
the temptation to borrow strength from the wrong dataset is exactly how a
freshness threshold becomes fiction.

| Dataset | Date | What it is | Usable for | Not usable for |
|---|---|---|---|---|
| Bounded TAGO probe | 2026-09-11 | 24 samples per direction at a 5 s target interval against the live TAGO endpoint | How often TAGO *content* changes: median `27.52 s`, min `10.01 s`, max `83.10 s` | Provider observation lag; boarding accuracy; candidate margin |
| Railway background acceptance | 2026-09-22 | One clean server-side collector run; see below | Whether TAPSO's own collector maintains polling continuity while the phone is backgrounded | Anything about TAGO's data itself |
| Two physical rides (browser recorder) | earlier | Local/browser capture during real rides | Qualitative sanity checks only — retained as historical evidence | `CONFOUNDED`; see below |

### Railway background collector acceptance, 2026-09-22

| Measure | Value |
|---|---|
| `captureEngine` | `railway-background` |
| `snapshotCount` | `20` |
| Browser background time | `103.06 s` |
| Maximum collection/polling gap | `7.94 s` |
| Configured polling interval | `5 s` |
| Background acceptance | `PASS` |

This run proves three things and no more:

- Railway owned the polling, not the phone.
- iOS/Safari background suspension no longer stopped TAGO collection.
- The collector held acceptable polling continuity for the duration of this
  acceptance run — worst gap `7.94 s` against a `5 s` target.

It does **not** prove any of the following, and must not be cited for them:

- TAGO provider source observation time — still unavailable, still unmeasurable
- a provider timestamp of any kind
- real boarding candidate accuracy
- candidate-margin calibration
- marker-lag distribution
- arrival or alighting accuracy
- the 30-boardings acceptance gate
- broad automatic matching safety

It is also one run. It is not a distribution, and `PASS` is an acceptance
verdict against a configured threshold, not a measured reliability figure.

### Why the two earlier physical rides are confounded

Both used the local/browser recorder, and both suffered large Safari-induced
polling gaps when the phone backgrounded the page. A recorded gap from those
rides cannot be attributed: it may be TAGO not answering, or it may be iOS
suspending the recorder. The two are indistinguishable in the capture.

Those samples are therefore `CONFOUNDED` for freshness-threshold derivation.
Retain them as supporting and historical evidence only. Do **not** fold their
aggregate provider-lag or polling-gap values into any clean freshness
threshold, and do not average them with the 2026-09-22 background run — the
capture engines differ, so the numbers are not measurements of the same thing.

## The server-observed cadence policy, and why each number is provisional

`services/api/src/sourceFreshness.ts` implements `server_observed_cadence_v1`.
It is a liveness surrogate, not a freshness measurement. It answers "did this
server keep receiving snapshots, close together, in which this vehicle's
reported content actually changed and never moved backwards?" — and nothing
else. A `fresh` verdict means the provider is answering and the vehicle's row
is moving. It does not mean a position is N seconds old, because nothing in the
TAGO feed can support that claim.

| Gate | Value | Basis | Status |
|---|---|---|---|
| `historyWindow` | `90 s` | Above the `83.10 s` worst observed content-change interval, so a slow-but-live vehicle is not discarded for being slow | `PROVISIONAL` |
| `minimumSamples` | `3` | Three receipts give two intervals — the minimum needed to see a gap rather than a point | `PROVISIONAL` |
| `minimumSpan` | `10 s` | Two polling intervals at the configured 5 s rate; three receipts inside one second prove nothing | `PROVISIONAL` |
| `maximumReceiptAge` | `30 s` | Six consecutive lost polls at a 5 s target before evidence is refused | `PROVISIONAL` |
| `maximumReceiptGap` | `30 s` | Roughly 4× the `7.94 s` worst gap on the healthy 2026-09-22 collector: loose enough not to fire on jitter, tight enough that a suspended collector cannot pass | `PROVISIONAL` |

None of these is a provider timestamp threshold. None is calibrated against
real boardings. Where evidence was insufficient to justify a number, the more
conservative behaviour was kept and the number is marked provisional above.

Two classification rules matter more than the numbers:

- **Unchanged content is `aging`, never `stale`.** A bus held at a light
  reports the same row for minutes. Treating that as a dead feed would make
  every red light look like a provider outage. Unchanged content is simply
  never enough to unlock matching.
- **Recent receipts alone are never `fresh`.** The cadence surrogate requires
  *changed* provider content inside the window. "Recent receipts equal fresh"
  is precisely the inference this policy exists to prevent, because receipt
  time is TAPSO's own clock and says nothing about TAGO.

Sequence regression and an over-long receipt gap both fail closed to `stale`.
Too few samples fails closed to `unknown`.

## Phase 1 conservative behavior after live evidence

- Route-scoped caching still shares successful snapshots and never caches provider failures.
- Keep the default vehicle cache at **20 seconds**. It is shorter than the measured 27.52-second median content-change interval and avoids wasteful five-second upstream polling.
- Keep route stops cached for six hours pending change-frequency evidence.
- City and route-number discovery reads now use the same read-through cache with a six-hour window; they previously reached TAGO on every request.
- Successful responses also carry a CDN `s-maxage` equal to the in-process TTL, because each serverless instance holds its own memory. No `stale-while-revalidate` window is granted, so a stale snapshot is never served deliberately.
- Keep the 75-second missing-vehicle grace unchanged because the bounded probe observed no disappearance event.
- Keep the 120 m near-stop fallback unchanged; TAGO `nodeord` should be preferred whenever it maps to a verified route stop.
- TAGO observations set `timestampSource=unavailable`, keep receipt time in `receivedAt`, and use the epoch sentinel in `observedAt`. Matching and journey progress therefore fail closed instead of treating network receipt time as provider freshness.
- Once selected, a vehicle is never silently replaced by another candidate.
- Backward progress remains fail-closed.
- A failed provider read is not evidence. A transient TAGO failure inside a
  journey session leaves cadence history, the selected vehicle and the last
  accepted progress untouched, and reports `providerRead.state: "failed"`.
  After a bounded run of consecutive failures the error is returned to the
  caller instead, because a provider that is down must never read as a healthy
  session.

## Provider architecture

Jeju's verified live path is TAGO. The service constructs `TagoTransitProvider` directly and exposes `transitProvider=tago` in health output. B551982 is retained only as validation history in documentation.

One handler in `services/api/src/apiRouter.ts` serves both the local Node server and the production Vercel Functions, so the freshness rules below hold identically in development and in production. `/health`, `/v1/vehicles` and `/operator/snapshot` all publish the same `freshness` object: `providerObservationTimestamp: "unavailable"`, `policy: "server_observed_cadence_v1"`, `automaticMatching: "shadow_only_pending_field_validation"`, plus the open field-validation gate and the provisional cadence thresholds. See `PRODUCTION_TRANSIT_API.md`.

`RouteRequest.cityCode` carries the official TAGO identifier. API query parsing accepts only `cityCode`, so former B551982 `stdgCd` values cannot be reused accidentally.

TAGO live responses do not expose a provider timestamp. `TagoTransitProvider` stores TAPSO acquisition time in `receivedAt`, marks `timestampSource=unavailable`, and sets `receiveType=TAGO_SNAPSHOT`; cadence analysis must continue to use snapshot-content changes.

## Next validation gate

The API-data and HTTP integration gates are complete for the full-length Route 365 directions. The next validation gate is a controlled real ride:

1. Run the API locally with the private service key and resolve `cityCode` through `/v1/cities`. A deployed API is not required; the capture tool drives `TagoTransitProvider` directly.
2. Choose one exact `routeId`, one direction, and explicit boarding and destination stop sequences from that direction's topology. The capture tool is route-generic; Route 365's `JEB405136521` and `JEB405136522` are the recommended baseline because their topology and live vehicles are already verified, but any Jeju TAGO route may be used once its cityCode, official variants, ordered topology, chosen sequences, and live vehicles endpoint have all been confirmed against live data. Record identity as the `routeId`, never as the route number, and do not take a first ride on a route whose direction or topology is unclear. Repeating the capture on a second route afterwards is what shows the evidence is not fitted to Route 365.
3. During the ride, run `scripts/ride-capture/capture.ts` (see `exec-plans/RIDE_CAPTURE.md`). It prints the stop list for the chosen segment before its first poll, stores bounded TAGO snapshots only under ignored `work/rides/`, records the boarded vehicle from the `b` command after cross-checking what was typed against the vehicles the route is currently reporting, and accepts `p <stop-seq>` markers for physically passed stops. Aim for eight to ten `p` markers placed only where the bus certainly stopped.
4. Run `scripts/ride-capture/analyze.ts` on the capture. The sanitized report compares the tracked vehicle's `nodeord` progression, content-change cadence, coordinate movement, gaps, marker lag, and arrival against the rider markers, using per-run pseudonyms instead of vehicle numbers, and reports `INSUFFICIENT_EVIDENCE` rather than publishing a distribution it does not have the samples for.
5. Define and test a TAGO freshness rule from `freshnessEvidence` and `tracked.markerComparisons` before enabling journey-session matching or progress. That decision belongs to Task C: the ride produces observed distributions, not a threshold.

Status as of 2026-09-22: steps 1 and 2 are reproducible today. Two physical
rides have been captured with the local/browser recorder, but both are
`CONFOUNDED` by Safari background suspension (see the evidence inventory above)
and neither can support a freshness threshold. The 2026-09-22 Railway
background acceptance run fixed the collection mechanism, not the evidence gap:
no clean ride capture exists yet. Step 5 is therefore still open, and no number
in this document is clean real-ride evidence.

## Acceptance gate for broad real mode

Do not enable automatic matching for passengers until a source-freshness rule exists and at least 30 observed boardings across multiple routes demonstrate a clear candidate margin, no silent direction reversal, and bounded stale-data behavior. Unknown route variants or unsupported semantics must fail closed.

**Status: `OPEN`.** Zero of the 30 boardings have been observed. The gate is
enforced in code rather than left to discipline:

| Control | Where | Default |
|---|---|---|
| `TRANSIT_AUTOMATIC_MATCHING_ENABLED` | `services/api/src/apiConfig.ts` | `false` on every platform, including the local Node server |
| Shadow mode | `JourneySessionCoordinator` | on whenever the flag is false; ranks candidates and publishes cadence evidence but never assigns `selectedVehicleId` |
| `TRANSIT_SESSIONS_ENABLED` | `services/api/src/apiConfig.ts` | independent axis; enabling it makes the ride endpoints reachable and nothing more |

Enabling sessions alone cannot enable automatic selection. That is asserted
end to end in `services/api/test/apiRouter.test.ts`, with a paired test showing
the same evidence *does* select once an operator opts in explicitly — so the
gate is demonstrably the only thing holding it back.

Explicit rider confirmation remains available in shadow mode, and it creates no
freshness of its own: a confirmed vehicle whose server-observed cadence is not
`fresh` reports `degraded` with no progress, exactly as an unconfirmed one
would.

### What is still missing after this gate closes

Durable journey-session storage. Sessions live in one process's memory, which
is why `TRANSIT_SESSIONS_ENABLED` defaults to `false` on serverless. It is a
real gap and a separate task; it is **not** why automatic matching is withheld,
and the health payload must never say it is.

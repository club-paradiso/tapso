# Route 3001, vehicle ending 3913: the false "delay" on a healthy ride (2026-10-04)

Status: **root cause established from the code of main `a8f5940`; fix on
`fix/live-ride-reliability-v3`; physical-device re-ride `UNVERIFIED`.**

## What the rider saw

A real ride on route 3001 (제주국제공항 순환버스; six catalog variants
`JEB405900101`–`JEB405900106`, 13–38 stops) with the physical bus confirmed
(plate ending 3913). The ride screen showed, at various moments and sometimes
together:

- "응답이 늦어요 / 탑서 서버가 늦게 답하고 있어요" (`live.error.timedOut`)
- "업데이트 지연" on the data badge and the island eyebrow
- the count dimmed with "마지막 확인" and the "현재 위치를 정확히 확인하기
  어려워요" banner (`ride.delayed.*`; an older build renders "실시간 정보가
  잠시 늦고 있어요" for the same moment)

while the API answered requests with HTTP 200 and the provider was responding.

## Evidence available to this reconstruction

| Source | Status |
|---|---|
| Repository code at `a8f5940` | read in full along the chain below |
| Deterministic reproduction | `services/api/test/confirmedRideProgression.test.ts` ("false-delay acceptance") reproduces the state transition from a TAGO-shaped snapshot |
| Vercel runtime logs of `tapso-api` | **not accessible**: the connected Vercel account answers `403` for runtime logs and runtime errors on `prj_XTimnEWdrhaDMSJfgELHzQAo3Nn2`, and no Vercel CLI login exists on this machine |
| Redis session row of the ride | **gone by design**: rows live 4 h and an ended ride is deleted |
| The rider's iPhone screenshots | not found in this session's inputs; add them to the Figma page `Dynamic Island Coexistence V3 › 00 Evidence` |

No production log line is quoted below. Every step is a code path that exists
on `a8f5940`, and the end-to-end state transition is reproduced by a test.

## The causal chain

1. **iOS request.** During a live ride the app polls `GET /v1/sessions/:id`
   every 15 s, only while the ride screen is in the foreground
   (`apps/ios/TapsoApp/TapsoAppModel.swift:1523`), with a 20 s `URLSession`
   timeout (`apps/ios/TapsoApp/TapsoAPIClient.swift:19`).
2. **TAPSO API.** `session_read` calls `JourneySessionCoordinator.refresh`,
   which reads the route's vehicles through `CachedTransitProvider` (20 s TTL
   per warm instance, `services/api/src/cachedTransitProvider.ts:6`) and TAGO
   (one 9 s deadline per logical request).
3. **Provider.** TAGO answered. Its rows carry no observation time
   (`timestampSource: "unavailable"`), so every TAGO row is ordered by TAPSO's
   own receipt time.
4. **Cadence history.** Each refresh appends the row to the session's
   per-vehicle receipt history, but only when its receipt is newer than the
   last one held (`services/api/src/sourceFreshness.ts:181`). A row answered
   from the 20 s cache has the same receipt and adds nothing.
5. **`sourceFreshness`.** `classifyTagoCadenceFreshness` returns `fresh` only
   when, inside a 90 s window, there are at least 3 receipts spanning 10 s,
   the newest is at most 30 s old, no gap exceeds 30 s, and the row's content
   changed at least once (`sourceFreshness.ts:74–97`). Those gates were
   calibrated for the Railway collector polling at 5 s. Through the app's 15 s
   poll and the 20 s cache a healthy ride sits at the edge of every one of
   them: one slow answer, one backgrounded screen, one bus held at a stop for
   90 s, or the first 30 s after confirmation, and the verdict is `stale`,
   `aging` or `unknown`.
6. **Selected-vehicle evaluation.** On `a8f5940`,
   `evaluateSelectedObservation` required that verdict to be `fresh` for *any*
   selected vehicle, rider-confirmed or not
   (`services/api/src/journeySession.ts:978`). Anything else answered
   `state: "degraded"` with the retained count and the explanation "Selected
   TAGO vehicle lacks fresh server-observed cadence evidence". The test
   "explicit confirmation in shadow mode tracks, but invents no source
   freshness" asserted this: a confirmation answered `degraded`.
7. **Session state.** So the response was HTTP 200 with the confirmed vehicle
   present, provider responding, and `state: "degraded"`: a matching-safety
   gate reused as a ride-progress gate.
8. **`LiveSessionInterpreter`.** `degraded` maps to `freshness: .aging` with
   the retained phase
   (`packages/transit-core/Sources/TapsoTransit/LiveSessionInterpreter.swift:95`).
9. **`RideSignal` → `RideGuidancePolicy`.** `.aging` maps to the `.delayed`
   moment (`RideGuidance.swift:226`), `data: .delayed`, `count: .lastKnown`.
10. **`RideView`.** The `.delayed` moment renders the `StatusBanner`
    (`RideView.swift:254`), dims the numeral and labels it "마지막 확인"; the
    data badge reads "업데이트 지연"; the Lock Screen and island eyebrow read
    the same moment. On top of that, when a single poll exceeded the phone's
    20 s limit (a cold Vercel instance plus a slow TAGO read can), the app
    classified it `timedOut`, showed `LiveFailureNotice` ("탑서 서버가 늦게
    답하고 있어요") and aged the data locally as well
    (`TapsoAppModel.swift:1660`), so the next *successful* poll still showed
    the banner until the server's cadence window had rebuilt (≥ 30 s of
    uninterrupted, changing receipts).
11. **Live Activity.** The same `ContentState` carried `freshness: aging`, so
    the island showed the clock symbol and "업데이트 지연".

The rider was therefore told the server was late and the data delayed when
the server had answered, the provider had answered, and the bus they had
identified was in the snapshot. The only thing missing was *matcher* evidence
that nobody needed any more: the rider had already said which bus it was.

## Why the copy was not the problem

"응답이 늦어요" was true of one request that exceeded 20 s; the body "탑서
서버가 늦게 답하고 있어요" claimed a server fault the phone cannot see. The
banner and badge were honest renderings of `degraded`. Rewriting them would
have kept the wrong state and hidden it.

## The fix (`fix/live-ride-reliability-v3`)

- **Confirmed-ride progression policy** (`services/api/src/confirmedRideProgression.ts`).
  Once `selectionMode === "explicit"`, the selected bus advances on same
  route, same direction, monotonic sequence, a physically plausible distance
  for the elapsed time (35 m/s bound reused from the hybrid engine, chord
  distance over surveyed stop coordinates), a receipt inside the 90 s window,
  and a second sighting before any destination passage not seen coming. A row
  with unchanged content keeps the ride `tracking`. Every refusal names itself
  (`trackingIntegrity`) and retains the last count. The automatic matcher's
  gate is unchanged (`journeySession.test.ts` "the automatic matcher's gate is
  unchanged").
- **Reliability by dimension** (`JourneySessionView.reliability`): provider,
  observation, position, vehicle, the matcher's cadence verdict (published,
  not obeyed) and one rider-facing `trust` word.
- **One trust word per moment** in the Swift core (`RideTrust`,
  `RideGuidance.trust`) and **one message per root condition** on the ride
  screen (`RideView.showsFailureNotice`).
- **Truthful timeout copy**: `live.error.timedOut.body` now describes the
  phone's wait, not a server fault.

## Acceptance

| Test | Where |
|---|---|
| HTTP 200, provider responding, confirmed vehicle present, no provider timestamp, matcher cadence unknown → `tracking`, `trust: live` | `confirmedRideProgression.test.ts` "false-delay acceptance" |
| Same payload read by the app → `.riding`, trust `.live`, count shown, no banner | `LiveSessionInterpreterTests.testAConfirmedBusWithUnknownMatcherCadenceIsLiveNotDelayed` |
| Rejections: route, direction, identity change, backward, impossible jump, corrupt sequence, topology, stale, unseen passage | `confirmedRideProgression.test.ts` |
| Transient provider failure keeps the count and names the provider | same file |
| The failure notice is not stacked on the rechecking banner | `RidePresentationTests.testATransientFailureIsNotSaidTwice` |
| Timeout copy names no server | `RidePresentationTests.testTimeoutCopyBlamesNoServer` |

## What this does not claim

- No production log has been read; the Vercel log access must be restored to
  measure how often session reads exceed 20 s (`TAPSO_V1_RELEASE_CLOSURE.md`,
  workstream D).
- The fix is `UNVERIFIED` on a physical device until a confirmed ride on a
  current build shows a live count through a provider hiccup.

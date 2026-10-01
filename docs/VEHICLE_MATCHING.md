# Vehicle matching

The matcher answers one safety-sensitive question: which physical bus is this
rider's? It is deterministic and returns a status, a selection only when every
rule allows one, ranked candidates with their evidence and rejection reasons,
and the decision-level reasons it withheld.

## Which matcher decides

`services/api/src/matching.ts`, policy **`directed-route-progress-v1`**, serves
journey sessions and `POST /v1/matches`. The Swift `VehicleMatchingEngine`
drives only the deterministic demo; it models a different input, is not
equivalent, and `services/api/test/crossLanguageAuthority.test.ts` fails if real
data could ever reach it. The previous backend policy,
`symmetric-stop-distance-v0`, survives only in `matchingLegacy.ts` for
comparison and negative controls; no serving path may import it.

## The contract

**Before evidence establishes that the rider is aboard, no automatically
selected vehicle may be at or past the boarding stop in route order.**
`assertDirectedInvariant` checks it on every result and throws instead of
returning a violating selection.

The old stop-position term `20 − 5·|seq − S|` could not tell a bus approaching
the stop from one that had just left it, and committed to departed buses in 268
blind live cases (Passive Shadow v3, finding F1). The directed policy reads
route progress in its direction of travel.

## Rider state

The rider says whether they are waiting at the stop or already aboard
(`riderState`, default `waiting_at_stop`). Each state has its own rule. The
default is the one whose mistake is harmless: a rider who is really aboard gets
a confirmation prompt, whereas treating a waiting rider as aboard would admit
departed buses.

## Position rules

TAGO's `nodeord` convention (last stop passed or next stop; changing on arrival
or on departure) is unverified. A bus dwelling at stop S may report S − 1, S or
S + 1, and a bus reporting S may already have left. So:

| Offset from S | Waiting rider | On-board rider |
|---|---|---|
| ≤ −5 | ignored (beyond window) | ignored |
| −4 … −2 | selectable if fresh and leading | not theirs |
| −1 | selectable if fresh and leading | blocks |
| 0 | blocks | blocks |
| +1 | blocks | selectable if fresh and the only one |
| +2 … +4 | departed, ignored | selectable if fresh and the only one |
| ≥ +5 | departed, ignored | ignored |

"Blocks" means no vehicle at all is selected while it is there.

## Everything else fails closed

- **Freshness.** A TAGO row needs `fresh` server-observed cadence
  (`sourceFreshness.ts`) to be selected. A vehicle that is not fresh still
  *competes*: a leading bus held at a light is still the first to arrive.
- **Leader and margin.** Only the vehicle closest to the stop can be selected
  for a waiting rider, and only with at least three stops of lead over every
  other vehicle heading for the stop — current or remembered, fresh or not,
  inside the four-stop window or behind it (finding F9: counted only inside the
  window, a bus one stop behind a leader four stops out did not count, and it
  could overtake). An on-board rider's bus must be the only one in its window.
- **Contested approach** (findings F21, F22, F24). Once two buses heading for the
  stop have been less than three stops apart during a waiting session, the
  approach stays contested for the rest of that session and nothing is
  selected automatically, even if the gap later opens: the bus behind may
  still arrive first. A look counts whether or not a leader was selectable
  then (F22): a pair seen while the leader was stale, or while both were
  beyond the four-stop window, contests the approach too. The nearest place
  each bus could be, current or remembered, is what is compared, and one bus
  reported at two places is not a pair. The contest is part of the session's
  memory, carried to every later decision, not only the next one (F24). Round
  a loop the rule does not apply (the loop rules above already withhold
  across the seam).
- **Unknown position.** No stop sequence, or one the route does not have,
  blocks. Coordinates alone never select: they cannot say which side of the
  stop a bus is on.
- **Memory.** A vehicle missing from one poll is remembered for the evidence
  window. It is never selected, and it competes from anywhere it could have
  reached since it was last seen (one stop plus one per 15 s). Past the window
  it is not forgotten: it keeps blocking and competing from session memory,
  its reach growing with the time since (finding F15).
- **Session memory** (`PassageMemory`, finding F4). Once any bus has been seen
  at the boarding stop, seen crossing it (in the poll or only remembered,
  finding F10), or lost from sight while it could, by now, have reached it
  (F15), during a waiting session, the rider may already be aboard it, and no
  bus is ever selected automatically for the rest of that session. The same
  holds when a bus seen for the first time is already past the stop and could
  have been at it since the rider started waiting, at the session's first look
  (F12) or any later one (F16); when a bus whose route progress was unknown
  leaves the feed (F15); and for a stored session whose memory predates this
  policy (F11). Round a loop, each sighting is compared with the last by its
  distance to the stop each way, so a crossing next to the seam, or longer than
  half the lap, is still one (F17); so is a bus seen again after long enough
  to have gone round through the stop, though it reads as still approaching
  (R24). A bus whose distance still to go grew by only one or two stops may
  have gone all the way round, or read a stop or two back: that withholds as
  what the time allows, not as a sighting of the stop (R43). An on-board rider's bus
  must have been in the feed when they said they were aboard: a bus missing
  then is never selected, but it still competes, because the feed may have
  missed theirs (F16); a bus leaving the on-board window withholds for good.
  On board round a loop, a bus seen clear of the stop and later back at it or
  closer past it, or seen again after time enough to go round, may have
  reached the stop after the rider boarded: it is never selected and still
  competes (R23). A loop shorter than two on-board windows and the stop either
  side (a lap under ten stops) withholds on-board selection. A bus the
  snapshot places twice is never excluded by one of its places (R27), and is
  not forgotten either: on board it is of unknown progress, withholding once
  out of sight, and a bus seen at no trustworthy place (none, or two) and
  then beyond the window may be the rider's bus leaving it (R30), if the
  rider's bus could have got there since they said they were aboard. The
  window is a window of readings, and a reading may be a stop off: their bus,
  read at the window's far edge, may have stood one stop further on, gone as
  far as the motion model allows since, and be read one stop further still.
  So a bus beyond the window by no more than the model's reach and two stops
  may be theirs (R40, R46); round a loop, counted past the stop, so a bus
  before it only once there was time to go round (R40, R47). Without a
  declaration time nothing bounds it, and it withholds.
- **Time.** The session's own sightings are always earlier decisions' `now`;
  one dated after `now` means the clock stepped back, and nothing bounds the
  time since (R29). A mark of unknown progress is dated by the receipts of the
  rows that raised it, which arrive just after `now` (R28).
- **Receipts only move forward** (F13). A late, older receipt or a second row
  for one vehicle in one snapshot is not new evidence and never counts toward
  freshness.
- **Topology.** Without the route's stops, when the boarding stop's id or name
  appears twice on the route, or when two different stops are listed under one
  sequence, selection is withheld. On a loop, a bus may block or compete across
  the seam but is never selected across it, and the lap is measured in
  sequences, never by counting rows (F18).
- **Identity.** One vehicle reported at two positions that matter withholds,
  and so does one also reported under another route (F19).
  After a selection, a session never switches vehicles: a lost vehicle ends as
  `lost`, never rematched.
- **After an automatic selection** (F20). A selection for a waiting rider is a
  prediction: its margin is counted in stops, and a faster bus behind can
  still reach the stop first. Until the selected bus is seen at or past the
  stop, the session watches every other bus of the route with the same
  session-memory rules. One seen at the stop, seen crossing it, or first seen
  past it when it could have been there since the rider began waiting
  withdraws the selection for good, also when it is seen in the same poll as
  the selected bus; the rider is then asked which bus they are on, the bus
  that just left the stop included, and nothing is selected automatically
  again. What memory merely allows (a bus out of sight that could by now have
  reached the stop) withholds a selection but never withdraws one: every
  short dropout of the bus behind would otherwise undo it; so does another
  bus round a loop whose distance to the stop grew by only a stop or two
  (R43). Only a sighting ends the watch (R31): the selected bus at one place
  on this route, at the stop or one past it; or further past it, no faster
  since its last sighting at one place before the stop than the matcher's
  motion model allows and, round a loop, not where a reading up to two stops
  back would also put it. A sighting past the stop that came too soon is not
  where the next is measured from: the last one before the stop stays, so a
  bus seen past the stop ends the watch once the time since allows it (R42).
  From one stop short, two past takes 30 s at the least. A reading one stop
  back, a row listed twice or under another route, a remembered row and a
  bus merely out of sight never end it. What a request that lost a
  concurrent write saw of the stop is written onto the winning row while that
  row holds the same automatic selection: a withdrawal, unless that row saw
  the selected bus at the stop earlier (R33), and an end, the earlier kept
  (R44), but only if the request's snapshot, read against that row's memory
  of the other buses, shows none of them reaching the stop: the request's own
  memory may lack a sighting the row's holds, and an end written over it
  would hide that bus for good. If one did, a withdrawal is written instead
  (R50). A request whose merge gives up answers from the latest row it read
  (R54). A selection the rider confirmed, or one made on board, is never
  watched.

There is no best-available guess, and no score overrides a rule: rules decide
what may be selected, and the score only orders what they allow.

## When the matcher withholds

The session stays useful. It asks the rider to confirm from the buses they
could be boarding or riding, nearest the stop first — including a bus at the
stop, which the matcher never selects on its own but which is exactly the one a
waiting rider is most likely stepping onto. A departed bus is not offered,
except after a withdrawn selection (F20), when the rider may be on the bus that
has just left the stop, counted round a loop across its seam too (R34).

## Evidence and readiness

Automatic selection is off everywhere, and the configuration refuses it below
`READY_FOR_BOUNDED_AUTOMATION`. The evidence, the release gate
`matcher-passive-safety-v4` and the readiness it awards are in
`docs/exec-plans/HUMAN_LABOR_ELIMINATION.md` and
`docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md`.

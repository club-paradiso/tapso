# Journey Contract v3 (`tapso-journey-contract-v1`)

One vocabulary for a TAPSO journey and for what every surface shows during it.
The server, the Swift core and the marketing site read the same names; none of
them invents its own journey semantics.

| Where | Implementation | Runs the specification |
|---|---|---|
| Specification | `fixtures/journey/journey-contract-v1.json` (`SPECIFICATION`, written by hand from this page) | — |
| Server | `services/api/src/journeyContract.ts` | `services/api/test/journeyContract.test.ts` |
| Swift core | `packages/transit-core/Sources/TapsoTransit/JourneyContract.swift` | `packages/transit-core/Tests/TapsoTransitTests/JourneyContractTests.swift` |

Both test files check the vocabulary lists in order, every contract case, every
surface case, and an exhaustive sweep of every input combination (12 936) for
two safety properties: late or uncertain data never produces a get-off
milestone, and a discovery hint never shows while a connection is planned.

The contract does not choose a bus. Vehicle selection stays with the server's
`directed-route-progress-v1` matcher and the rider's confirmation
(`VEHICLE_MATCHING.md`).

## A journey

```text
TRIP     제주국제공항 → 협재
WALK     first mile (optional)
RIDE     182  board seq 3 → alight seq 9
TRANSFER 제주버스터미널 (walk between stops, 0 m when the same stop)
RIDE     202  board seq 4 → alight seq 31
WALK     last mile, 430 m (optional)
```

Rules (`validate`):

| Rule | Error |
|---|---|
| At least one ride | `noRide` |
| A ride alights after it boards (`alightSequence > boardSequence`) | `invalidRideOrder` |
| Two rides are always joined by a transfer | `missingTransfer` |
| A transfer sits between two rides | `danglingTransfer` |
| A walk is only the first or last mile; between rides it is a transfer | `walkBetweenRides` |
| A walking distance, when measured, is finite and not negative | `invalidDistance` |

Walking distance is optional because TAPSO does not always have a measured one.
An unmeasured distance stays absent; it is never filled with a guess.

## Vocabulary

| List | Values |
|---|---|
| Segment kinds | `walk`, `ride`, `transfer` |
| Pre-ride stages | `searching`, `proposed`, `similarBuses`, `choose` (below confirmation-assisted matcher readiness the rider picks the bus, even one; issue #80), `notFoundYet`, `confirmed` (Swift `VehicleCheckStage`) |
| Ride moments | `riding`, `prepare`, `nextStop`, `arrived`, `passedDestination`, `delayed`, `vehicleLost`, `offline`, `checking`, `ended` (Swift `RideMoment`, from `RideGuidancePolicy`) |
| Transfer risks | `safe`, `tight`, `atRisk`, `missed`, `recovering`, `unknown` |
| Safe Return levels | `comfortable`, `leaveBy`, `tight`, `notRecommended`, `unknown` |
| Surface states | `waiting`, `confirm`, `riding`, `prepare`, `nextStop`, `transfer`, `transferRisk`, `arrival`, `delayed`, `checking`, `discovery`, `recovery`, `ended` |
| Next actions | `walkToStop`, `waitForBus`, `confirmBus`, `stayOnBus`, `prepareToExit`, `pressStopButton`, `exitHere`, `exitAndTransfer`, `boardNextBus`, `checkBusDisplay`, `keepWatching`, `checkAlternative`, `followRecovery`, `considerStop`, `finish` |

`unknown` is a first-class value in both risk lists. It means TAPSO lacks the
data to say, and every surface renders it without urgency and without implying
safety.

## The single most important thing (`resolveSurface`)

Every surface (app hero, Lock Screen, each Dynamic Island region) shows one
state and one action. Precedence, highest first:

1. `ended` → `finish`.
2. An active recovery plan → `recovery` / `followRecovery`.
3. The current segment:
   - **walk**: before the first ride `waiting` / `walkToStop`; after the last ride `arrival` / `finish`.
   - **transfer**: `recovering` → `recovery`; `atRisk` or `missed` → `transferRisk` / `checkAlternative`; otherwise `transfer` / `boardNextBus`.
   - **ride, before a ride moment**: `searching`/`notFoundYet` → `waiting` / `waitForBus`; `proposed`/`similarBuses`/`choose` → `confirm` / `confirmBus`; anything else → `checking` / `keepWatching` (fail closed).
   - **ride, with a moment**:

| Ride moment | Final ride | Ride before a transfer |
|---|---|---|
| `passedDestination` | `recovery` / `followRecovery` | same |
| `arrived` | `arrival` / `exitHere` | `transfer` / `exitAndTransfer` |
| `nextStop` | `nextStop` / `pressStopButton` | same |
| `prepare` | `prepare` / `prepareToExit` | same (outranks a risky connection) |
| `delayed`, `offline` | `delayed` / `checkBusDisplay` | same (outranks every timing claim) |
| `vehicleLost` | `delayed` / `keepWatching` | same |
| `checking` | `checking` / `keepWatching` | same |
| `riding` | `discovery` / `considerStop` when a hint exists, else `riding` / `stayOnBus` | `atRisk`/`missed` → `transferRisk` / `checkAlternative`; `recovering` → `recovery`; else `riding` / `stayOnBus` |

Why this order:

- **Getting off at the right stop is the physical action that cannot wait.** A
  risky connection is shown while riding, but `prepare` and `nextStop` win.
- **Late data outranks everything that depends on timing.** Transfer margins
  and discovery are both timing claims; on `delayed` data TAPSO makes neither.
- **Discovery only on the final ride.** Suggesting an early stop while a
  connection is planned would trade a planned journey for a detour.
- **A tight connection does not interrupt riding.** `tight` is shown inside the
  transfer detail; only `atRisk` and `missed` take the surface.

## Copy

Copy keys are per surface: `journey.<state>.headline|detail|compact` and
`journey.action.<action>`. Korean is the source language. Dialect is used only
where it is natural and checked (`오늘 뭐하젠?`, `어디 가젠?`, `혼저 탑서`); action
labels stay plain Korean so they read instantly on a moving bus.

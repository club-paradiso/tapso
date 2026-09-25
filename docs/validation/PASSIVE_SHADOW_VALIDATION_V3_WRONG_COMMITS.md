# Passive Shadow Validation v3: every live wrong commit

Generated from `artifacts/passive-shadow-validation-v3-wrong-commits.json` (sha256 `a960d428caa9d967ddbde0e66f9f1a9963cfd65df519bc6acc58951532fd8773`). That ledger was produced by evaluation run `36108364969` at commit `db51667`, offline, over the raw streams of collection run `36098610702` (provider path `tapso-public-api`, raw tree `bce8b504e5b287d9f86eb79345f7e50bdce4537625247c0dee164c2afb8c82fb`). `LIVE_PASSIVE` only; pseudonyms only.

**268 wrong committed selections** in 142 boarding events, on 15 trajectories. Each row below is one case, inspected on its own record.

## Shared findings across all 268

- Scenario: `WAIT_AT_STOP` 268 of 268.
- Eligible candidates at the commit: exactly 1 in 268 of 268. No runner-up exists, so the 12-point ambiguity margin never applies.
- Selected bus: 1–4 stops **past** the boarding stop (offset 1: 17, 2: 60, 3: 95, 4: 96), cadence `fresh` in every case, score 70/65/60/55 by offset (= 30 route + 25 fresh + 20 − 5·offset).
- Ground-truth bus at the commit: **M1**, in the feed, `fresh`, but 5–14 stops *before* the stop and rejected `implausible_boarding_position` (200); **M2**, absent from that snapshot (68).
- Freshness: 0 selections on non-fresh cadence. Direction: 0 direction-code or stop-sequence reversals in the committed bus before the commit; 0 route/direction rejections.
- 14 records passed through an `ambiguous` decision before committing to the departed bus alone.

**Likely failure mechanism, the same for every row.** The stop-position term `20 − 5·|seq − boardingSeq|` is symmetric. A bus that has just left the rider's stop is moving (so fresh) and within 4 stops, while the bus the rider will actually board is still more than 4 stops away (M1) or not yet in the feed (M2). The departed bus is therefore the only eligible candidate, and the matcher commits to it. Nothing in the rule asks whether the candidate is before or after the stop.

Legend: GT = ground-truth bus, Sel = committed bus (run pseudonyms). Offsets are in stops relative to the boarding stop at the commit. Timeline: status changes relative to session start (`U` unavailable, `A` ambiguous, `M:sel` matched → the departed bus). Commit Δ = seconds from the commit to the true bus reaching the stop (negative = before).


## Route `JEB405136001`: 34 wrong commits

| # | Case (session start UTC) | S | GT | Sel | Sel offset / score / cadence | GT at commit | Eligible | Commit Δ s | Mech. | Timeline |
|---:|---|---:|---|---|---|---|---:|---:|---|---|
| 1 | t1 05:52:01 | 8 | veh-06 | veh-05 | +4 / 55 / fresh | not in feed | 1 | -690.2 | M2 | U@37s → M:sel@224s → U@274s → M:gt@650s → U@684s |
| 2 | t1 05:54:01 | 8 | veh-06 | veh-05 | +4 / 55 / fresh | not in feed | 1 | -690.2 | M2 | U@7s → M:sel@104s → U@154s → M:gt@530s → U@564s |
| 3 | t1 05:52:01 | 9 | veh-06 | veh-05 | +3 / 60 / fresh | not in feed | 1 | -931.7 | M2 | U@37s → M:sel@224s → U@274s → M:gt@1276s → U@1336s |
| 4 | t1 05:54:01 | 9 | veh-06 | veh-05 | +3 / 60 / fresh | not in feed | 1 | -931.7 | M2 | U@7s → M:sel@104s → U@154s → M:gt@1156s → U@1216s |
| 5 | t1 05:54:01 | 10 | veh-06 | veh-05 | +2 / 65 / fresh | not in feed | 1 | -961.7 | M2 | U@7s → M:sel@104s → U@154s → M:gt@1156s → U@1216s |
| 6 | t1 05:56:01 | 11 | veh-06 | veh-05 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -655.4 | M1 | U@34s → M:sel@410s → U@444s → M:gt@1036s → U@1096s |
| 7 | t1 05:58:01 | 11 | veh-06 | veh-05 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -655.4 | M1 | U@14s → M:sel@290s → U@324s → M:gt@916s → U@976s |
| 8 | t1 06:00:01 | 11 | veh-06 | veh-05 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -655.4 | M1 | U@20s → M:sel@170s → U@204s → M:gt@796s → U@856s |
| 9 | t1 05:58:01 | 12 | veh-06 | veh-05 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -778.9 | M1 | U@14s → M:sel@290s → U@324s → M:gt@916s → U@976s |
| 10 | t1 06:00:01 | 12 | veh-06 | veh-05 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -778.9 | M1 | U@20s → M:sel@170s → U@204s → M:gt@796s → U@856s |
| 11 | t1 06:00:01 | 13 | veh-06 | veh-05 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -866.1 | M1 | U@20s → M:sel@170s → U@204s → M:gt@796s → U@856s |
| 12 | t1 06:04:01 | 13 | veh-06 | veh-05 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -722.6 | M1 | U@21s → M:sel@73s → U@104s → M:gt@556s → U@616s |
| 13 | t1 06:04:01 | 14 | veh-06 | veh-05 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -812.8 | M1 | U@21s → M:sel@73s → U@104s → M:gt@556s → U@616s |
| 14 | t1 06:04:01 | 15 | veh-06 | veh-05 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -926.3 | M1 | U@21s → M:sel@73s → U@104s → M:gt@585s → U@616s |
| 15 | t4 05:28:01 | 2 | veh-05 | veh-01 | +4 / 55 / fresh | not in feed | 1 | -561 | M2 | U@0s → M:sel@163s → U@194s |
| 16 | t4 05:28:01 | 3 | veh-05 | veh-01 | +3 / 60 / fresh | not in feed | 1 | -741.4 | M2 | U@0s → M:sel@163s → U@194s |
| 17 | t4 05:52:01 | 17 | veh-05 | veh-01 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -540.2 | M1 | U@37s → M:sel@224s → U@274s → M:gt@650s → U@684s |
| 18 | t4 05:54:01 | 17 | veh-05 | veh-01 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -540.2 | M1 | U@7s → M:sel@104s → U@154s → M:gt@530s → U@564s |
| 19 | t4 05:52:01 | 18 | veh-05 | veh-01 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -660.3 | M1 | U@37s → M:sel@224s → U@274s → M:gt@650s → U@684s |
| 20 | t4 05:54:01 | 18 | veh-05 | veh-01 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -660.3 | M1 | U@7s → M:sel@104s → U@154s → M:gt@530s → U@564s |
| 21 | t4 05:56:01 | 20 | veh-05 | veh-01 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -423.6 | M1 | U@34s → M:sel@410s → U@444s → M:gt@1036s → U@1096s |
| 22 | t4 05:58:01 | 20 | veh-05 | veh-01 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -423.6 | M1 | U@14s → M:sel@290s → U@324s → M:gt@916s → U@976s |
| 23 | t4 06:00:01 | 20 | veh-05 | veh-01 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -423.6 | M1 | U@20s → M:sel@170s → U@204s → M:gt@796s → U@856s |
| 24 | t4 06:00:01 | 21 | veh-05 | veh-01 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -566.6 | M1 | U@20s → M:sel@170s → U@204s → M:gt@796s → U@856s |
| 25 | t4 06:04:01 | 22 | veh-05 | veh-01 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -572.5 | M1 | U@21s → M:sel@73s → U@104s → M:gt@556s → U@616s |
| 26 | t4 06:04:01 | 23 | veh-05 | veh-01 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -722.6 | M1 | U@21s → M:sel@73s → U@104s → M:gt@556s → U@616s |
| 27 | t5 06:04:01 | 3 | veh-07 | veh-06 | +3 / 60 / fresh | not in feed | 1 | -926.3 | M2 | U@21s → M:sel@73s → U@104s |
| 28 | t6 05:28:01 | 13 | veh-01 | veh-02 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -561 | M1 | U@0s → M:sel@163s → U@194s |
| 29 | t6 05:28:01 | 14 | veh-01 | veh-02 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -771.1 | M1 | U@0s → M:sel@163s → U@194s |
| 30 | t6 05:54:01 | 29 | veh-01 | veh-02 | +4 / 55 / fresh | -8, fresh, implausible_boarding_position | 1 | -992.9 | M1 | U@7s → M:sel@104s → U@154s → M:gt@1156s → U@1216s |
| 31 | t6 05:54:01 | 30 | veh-01 | veh-02 | +3 / 60 / fresh | -9, fresh, implausible_boarding_position | 1 | -1052.2 | M1 | U@7s → M:sel@104s → U@154s → M:gt@1156s → U@1216s |
| 32 | t7 05:28:01 | 25 | veh-02 | veh-03 | +4 / 55 / fresh | -8, fresh, implausible_boarding_position | 1 | -801.1 | M1 | U@0s → M:sel@163s → U@194s |
| 33 | t7 05:28:01 | 26 | veh-02 | veh-03 | +3 / 60 / fresh | -9, fresh, implausible_boarding_position | 1 | -861.1 | M1 | U@0s → M:sel@163s → U@194s |
| 34 | t7 05:28:01 | 27 | veh-02 | veh-03 | +2 / 65 / fresh | -10, fresh, implausible_boarding_position | 1 | -931.2 | M1 | U@0s → M:sel@163s → U@194s |

## Route `JEB405136002`: 100 wrong commits

| # | Case (session start UTC) | S | GT | Sel | Sel offset / score / cadence | GT at commit | Eligible | Commit Δ s | Mech. | Timeline |
|---:|---|---:|---|---|---|---|---:|---:|---|---|
| 35 | t2 05:28:03 | 4 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -670.1 | M2 | U@0s → M:sel@283s → U@313s → M:gt@1179s → U@1204s |
| 36 | t2 05:30:03 | 4 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -670.1 | M2 | U@20s → M:sel@163s → U@193s → M:gt@1059s → U@1084s |
| 37 | t2 05:30:03 | 5 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -730.1 | M2 | U@20s → M:sel@163s → U@193s → M:gt@1059s → U@1185s |
| 38 | t2 05:30:03 | 6 | veh-10 | veh-08 | +2 / 65 / fresh | not in feed | 1 | -771 | M2 | U@20s → M:sel@163s → U@193s → M:sel@374s → U@434s → M:gt@1059s … (+1) |
| 39 | t2 05:32:03 | 6 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -560 | M2 | U@13s → M:sel@254s → U@314s → M:gt@939s → U@1065s |
| 40 | t2 05:34:03 | 6 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -560 | M2 | U@13s → M:sel@134s → U@194s → M:gt@819s → U@945s |
| 41 | t2 05:32:03 | 7 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -659.1 | M2 | U@13s → M:sel@254s → U@344s → M:gt@939s → U@1065s |
| 42 | t2 05:34:03 | 7 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -659.1 | M2 | U@13s → M:sel@134s → U@224s → M:gt@819s → U@945s |
| 43 | t2 05:36:03 | 7 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -599.6 | M2 | U@14s → M:sel@74s → U@104s → M:gt@699s → U@825s |
| 44 | t2 05:34:03 | 8 | veh-10 | veh-08 | +2 / 65 / fresh | not in feed | 1 | -684.6 | M2 | U@13s → M:sel@134s → U@224s → M:sel@323s → U@386s → M:gt@819s … (+1) |
| 45 | t2 05:36:03 | 8 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -625 | M2 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+1) |
| 46 | t2 05:38:03 | 8 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -495.6 | M2 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s |
| 47 | t2 05:40:03 | 8 | veh-10 | veh-08 | +4 / 55 / fresh | not in feed | 1 | -375.6 | M2 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s |
| 48 | t2 05:36:03 | 9 | veh-10 | veh-08 | +2 / 65 / fresh | not in feed | 1 | -650.8 | M2 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+1) |
| 49 | t2 05:38:03 | 9 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -521.3 | M2 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s |
| 50 | t2 05:40:03 | 9 | veh-10 | veh-08 | +3 / 60 / fresh | not in feed | 1 | -401.4 | M2 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s |
| 51 | t2 05:38:03 | 10 | veh-10 | veh-08 | +2 / 65 / fresh | not in feed | 1 | -681.5 | M2 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s → M:gt@1063s |
| 52 | t2 05:40:03 | 10 | veh-10 | veh-08 | +2 / 65 / fresh | not in feed | 1 | -561.5 | M2 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@943s |
| 53 | t2 05:40:03 | 11 | veh-10 | veh-08 | +1 / 70 / fresh | not in feed | 1 | -704.2 | M2 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@943s … (+2) |
| 54 | t2 05:46:03 | 13 | veh-10 | veh-08 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@3s → M:sel@99s → A@124s → U@225s → M:gt@583s → U@654s … (+3) |
| 55 | t2 05:48:03 | 14 | veh-10 | veh-08 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -706.6 | M1 | U@4s → M:sel@63s → U@105s → M:gt@463s → U@534s → M:gt@584s … (+3) |
| 56 | t2 05:48:03 | 15 | veh-10 | veh-08 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -796.2 | M1 | U@4s → M:sel@63s → U@105s → M:gt@463s → U@534s → M:gt@584s … (+3) |
| 57 | t2 05:52:03 | 17 | veh-10 | veh-08 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -709 | M1 | U@6s → M:sel@223s → U@294s → M:gt@374s → U@404s → M:gt@649s … (+1) |
| 58 | t2 05:54:03 | 17 | veh-10 | veh-08 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -709 | M1 | U@7s → M:sel@103s → U@174s → M:gt@254s → U@284s → M:gt@529s … (+1) |
| 59 | t2 05:52:03 | 18 | veh-10 | veh-08 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -771.3 | M1 | U@6s → M:sel@223s → U@294s → M:sel@344s → U@404s → M:gt@649s … (+2) |
| 60 | t2 05:54:03 | 18 | veh-10 | veh-08 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -771.3 | M1 | U@7s → M:sel@103s → U@174s → M:sel@224s → U@284s → M:gt@529s … (+2) |
| 61 | t2 05:56:03 | 18 | veh-10 | veh-08 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -650.5 | M1 | U@12s → M:sel@104s → U@164s → M:gt@409s → U@443s → M:gt@1035s |
| 62 | t2 05:54:03 | 19 | veh-10 | veh-08 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -873.5 | M1 | U@7s → M:sel@103s → U@174s → M:sel@224s → U@284s → M:gt@529s … (+4) |
| 63 | t2 05:56:03 | 19 | veh-10 | veh-08 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -752.7 | M1 | U@12s → M:sel@104s → U@164s → M:gt@409s → U@443s → M:gt@1035s … (+2) |
| 64 | t2 05:56:03 | 20 | veh-10 | veh-08 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -872.5 | M1 | U@12s → M:sel@104s → U@164s → M:gt@1035s → U@1065s → M:gt@1155s … (+1) |
| 65 | t2 05:58:03 | 21 | veh-10 | veh-08 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -686.5 | M1 | U@14s → M:sel@289s → U@323s → M:gt@915s → U@945s → M:gt@1035s … (+1) |
| 66 | t2 06:00:03 | 21 | veh-10 | veh-08 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -686.5 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |
| 67 | t2 06:00:03 | 22 | veh-10 | veh-08 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -779.5 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |
| 68 | t3 05:46:03 | 4 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -880.8 | M2 | U@3s → M:sel@99s → U@124s → M:gt@1009s → U@1043s |
| 69 | t3 05:46:03 | 5 | veh-11 | veh-10 | +3 / 60 / fresh | not in feed | 1 | -970.8 | M2 | U@3s → M:sel@99s → U@225s → M:gt@1009s → U@1043s |
| 70 | t3 05:48:03 | 5 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -886.2 | M2 | U@4s → M:sel@63s → U@105s → M:gt@889s → U@923s |
| 71 | t3 05:48:03 | 6 | veh-11 | veh-10 | +3 / 60 / fresh | not in feed | 1 | -920.2 | M2 | U@4s → M:sel@63s → U@105s → M:gt@889s → U@923s |
| 72 | t3 05:48:03 | 7 | veh-11 | veh-10 | +2 / 65 / fresh | not in feed | 1 | -1018.9 | M2 | U@4s → M:sel@63s → U@105s → M:gt@889s → U@923s |
| 73 | t3 05:50:03 | 8 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -649.5 | M2 | U@15s → M:sel@343s → U@414s → M:sel@464s → U@494s → M:gt@769s … (+1) |
| 74 | t3 05:52:03 | 8 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -649.5 | M2 | U@6s → M:sel@223s → U@294s → M:sel@344s → U@374s → M:gt@649s … (+1) |
| 75 | t3 05:54:03 | 8 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -649.5 | M2 | U@7s → M:sel@103s → U@174s → M:sel@224s → U@254s → M:gt@529s … (+1) |
| 76 | t3 05:56:03 | 8 | veh-11 | veh-10 | +4 / 55 / fresh | not in feed | 1 | -528.7 | M2 | U@12s → M:sel@104s → U@134s → M:gt@409s → U@443s |
| 77 | t3 05:52:03 | 9 | veh-11 | veh-10 | +3 / 60 / fresh | not in feed | 1 | -739.3 | M2 | U@6s → M:sel@223s → U@294s → M:sel@344s → U@404s |
| 78 | t3 05:54:03 | 9 | veh-11 | veh-10 | +3 / 60 / fresh | not in feed | 1 | -739.3 | M2 | U@7s → M:sel@103s → U@174s → M:sel@224s → U@284s |
| 79 | t3 05:56:03 | 9 | veh-11 | veh-10 | +3 / 60 / fresh | not in feed | 1 | -618.5 | M2 | U@12s → M:sel@104s → U@164s |
| 80 | t3 05:54:03 | 10 | veh-11 | veh-10 | +2 / 65 / fresh | not in feed | 1 | -839.5 | M2 | U@7s → M:sel@103s → U@174s → M:sel@224s → U@284s → M:gt@1155s … (+1) |
| 81 | t3 05:56:03 | 10 | veh-11 | veh-10 | +2 / 65 / fresh | not in feed | 1 | -718.7 | M2 | U@12s → M:sel@104s → U@164s → M:gt@1035s → U@1065s |
| 82 | t3 05:56:03 | 11 | veh-11 | veh-10 | +1 / 70 / fresh | not in feed | 1 | -841.4 | M2 | U@12s → M:sel@104s → U@164s → M:sel@409s → U@443s → M:gt@1035s … (+3) |
| 83 | t3 05:58:03 | 11 | veh-11 | veh-10 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -536 | M1 | U@14s → M:sel@289s → U@323s → M:gt@915s → U@945s → M:gt@1035s … (+1) |
| 84 | t3 06:00:03 | 11 | veh-11 | veh-10 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -536 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |
| 85 | t3 06:00:03 | 12 | veh-11 | veh-10 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -596 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |
| 86 | t4 05:30:03 | 25 | veh-09 | veh-07 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -800.1 | M1 | U@20s → M:sel@163s → U@193s → M:gt@404s → U@464s → M:gt@563s … (+3) |
| 87 | t4 05:30:03 | 26 | veh-09 | veh-07 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -841.7 | M1 | U@20s → M:sel@163s → U@193s → M:gt@563s → U@626s → M:gt@1059s … (+1) |
| 88 | t4 05:32:03 | 27 | veh-09 | veh-07 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -659.1 | M1 | U@13s → M:sel@254s → U@344s → M:gt@939s → U@1065s |
| 89 | t4 05:34:03 | 27 | veh-09 | veh-07 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -659.1 | M1 | U@13s → M:sel@134s → U@224s → M:gt@819s → U@945s |
| 90 | t4 05:36:03 | 27 | veh-09 | veh-07 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -599.6 | M1 | U@14s → M:sel@74s → U@104s → M:gt@699s → U@825s |
| 91 | t4 05:34:03 | 28 | veh-09 | veh-07 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -811.2 | M1 | U@13s → M:sel@134s → U@224s → M:sel@323s → U@386s → M:gt@819s … (+1) |
| 92 | t4 05:36:03 | 28 | veh-09 | veh-07 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -751.7 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+1) |
| 93 | t4 05:38:03 | 28 | veh-09 | veh-07 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -622.2 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s |
| 94 | t4 05:36:03 | 29 | veh-09 | veh-07 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -811 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+1) |
| 95 | t4 05:38:03 | 29 | veh-09 | veh-07 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -681.5 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s |
| 96 | t4 05:40:03 | 29 | veh-09 | veh-07 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -561.5 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s |
| 97 | t4 05:36:03 | 30 | veh-09 | veh-07 | +1 / 70 / fresh | -9, fresh, implausible_boarding_position | 1 | -982.6 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+2) |
| 98 | t4 05:38:03 | 30 | veh-09 | veh-07 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -853.2 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s → M:gt@1214s |
| 99 | t4 05:40:03 | 30 | veh-09 | veh-07 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -733.2 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@1094s |
| 100 | t4 05:40:03 | 31 | veh-09 | veh-07 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -733.2 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@1094s |
| 101 | t4 05:42:03 | 32 | veh-09 | veh-07 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@23s → M:sel@339s → U@364s → M:gt@974s → U@1004s → M:gt@1249s |
| 102 | t4 05:44:03 | 32 | veh-09 | veh-07 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@23s → M:sel@219s → U@244s → M:gt@854s → U@884s → M:gt@1129s |
| 103 | t4 05:46:03 | 32 | veh-09 | veh-07 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@3s → M:sel@99s → U@124s → M:gt@734s → U@764s → M:gt@1009s |
| 104 | t4 05:42:03 | 33 | veh-09 | veh-07 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@23s → M:sel@339s → U@423s → M:gt@974s → U@1004s → M:gt@1249s |
| 105 | t4 05:44:03 | 33 | veh-09 | veh-07 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@23s → M:sel@219s → U@303s → M:gt@854s → U@884s → M:gt@1129s |
| 106 | t4 05:46:03 | 33 | veh-09 | veh-07 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -635.2 | M1 | U@3s → M:sel@99s → U@183s → M:gt@734s → U@764s → M:gt@1009s |
| 107 | t4 05:44:03 | 34 | veh-09 | veh-07 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -760.7 | M1 | U@23s → M:sel@219s → U@303s → M:gt@854s → U@884s → M:gt@1129s … (+1) |
| 108 | t4 05:46:03 | 34 | veh-09 | veh-07 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -760.7 | M1 | U@3s → M:sel@99s → U@183s → M:gt@734s → U@764s → M:gt@1009s … (+1) |
| 109 | t7 05:30:03 | 15 | veh-08 | veh-09 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -800.1 | M1 | U@20s → M:sel@163s → U@193s → M:gt@434s → U@464s → M:gt@563s … (+3) |
| 110 | t7 05:32:03 | 16 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -659.1 | M1 | U@13s → M:sel@254s → U@284s → M:gt@443s → U@506s → M:gt@939s … (+1) |
| 111 | t7 05:34:03 | 16 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -659.1 | M1 | U@13s → M:sel@134s → U@164s → M:gt@323s → U@386s → M:gt@819s … (+1) |
| 112 | t7 05:32:03 | 17 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -769.1 | M1 | U@13s → M:sel@254s → U@344s → M:gt@939s → U@1065s |
| 113 | t7 05:34:03 | 17 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -769.1 | M1 | U@13s → M:sel@134s → U@224s → M:gt@819s → U@945s |
| 114 | t7 05:36:03 | 17 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -709.6 | M1 | U@14s → M:sel@74s → U@104s → M:gt@699s → U@825s |
| 115 | t7 05:34:03 | 18 | veh-08 | veh-09 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -840.5 | M1 | U@13s → M:sel@134s → U@224s → M:sel@323s → U@386s → M:gt@819s … (+1) |
| 116 | t7 05:36:03 | 18 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -780.9 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+1) |
| 117 | t7 05:38:03 | 18 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -651.5 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s |
| 118 | t7 05:40:03 | 18 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -531.5 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s |
| 119 | t7 05:36:03 | 19 | veh-08 | veh-09 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -871 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@266s → M:gt@699s … (+2) |
| 120 | t7 05:38:03 | 19 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -741.5 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s → M:gt@1063s |
| 121 | t7 05:40:03 | 19 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -621.6 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@943s |
| 122 | t7 05:38:03 | 20 | veh-08 | veh-09 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -853.2 | M1 | U@27s → M:sel@83s → U@146s → M:gt@579s → U@705s → M:gt@1063s … (+2) |
| 123 | t7 05:40:03 | 20 | veh-08 | veh-09 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -733.2 | M1 | U@26s → M:sel@83s → U@115s → M:gt@459s → U@585s → M:gt@943s … (+2) |
| 124 | t7 05:40:03 | 21 | veh-08 | veh-09 | +1 / 70 / fresh | -9, fresh, implausible_boarding_position | 1 | -860.1 | M1 | U@26s → M:sel@83s → U@115s → M:gt@543s → U@585s → M:gt@943s … (+3) |
| 125 | t7 05:48:03 | 23 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -612.7 | M1 | U@4s → M:sel@63s → U@105s → M:gt@463s → U@534s → M:gt@584s … (+3) |
| 126 | t7 05:48:03 | 24 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -736.1 | M1 | U@4s → M:sel@63s → U@105s → M:gt@463s → U@534s → M:gt@584s … (+3) |
| 127 | t7 05:48:03 | 25 | veh-08 | veh-09 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -796.2 | M1 | U@4s → M:sel@63s → U@105s → M:gt@463s → U@534s → M:gt@584s … (+3) |
| 128 | t7 05:48:03 | 26 | veh-08 | veh-09 | +1 / 70 / fresh | -9, fresh, implausible_boarding_position | 1 | -886.2 | M1 | U@4s → M:sel@63s → U@105s → M:gt@584s → U@644s → M:gt@889s … (+1) |
| 129 | t7 05:54:03 | 29 | veh-08 | veh-09 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -648.4 | M1 | U@7s → M:sel@254s → U@284s → M:gt@529s → U@563s → M:gt@1155s … (+1) |
| 130 | t7 05:56:03 | 29 | veh-08 | veh-09 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -648.4 | M1 | U@12s → M:sel@134s → U@164s → M:gt@409s → U@443s → M:gt@1035s … (+1) |
| 131 | t7 05:54:03 | 30 | veh-08 | veh-09 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -811.5 | M1 | U@7s → M:sel@254s → U@284s → M:gt@1155s → U@1185s → M:gt@1275s … (+1) |
| 132 | t7 05:56:03 | 30 | veh-08 | veh-09 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -811.5 | M1 | U@12s → M:sel@134s → U@164s → M:gt@1035s → U@1065s → M:gt@1155s … (+1) |
| 133 | t7 06:00:03 | 31 | veh-08 | veh-09 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -596 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |
| 134 | t7 06:00:03 | 32 | veh-08 | veh-09 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -746 | M1 | U@19s → M:sel@169s → U@203s → M:gt@795s → U@825s → M:gt@915s … (+1) |

## Route `JEB405136521`: 133 wrong commits

| # | Case (session start UTC) | S | GT | Sel | Sel offset / score / cadence | GT at commit | Eligible | Commit Δ s | Mech. | Timeline |
|---:|---|---:|---|---|---|---|---:|---:|---|---|
| 135 | t1 05:28:04 | 30 | veh-15 | veh-16 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -716.1 | M1 | U@0s → M:sel@57s → U@88s → M:gt@163s → U@194s → M:gt@554s … (+3) |
| 136 | t1 05:28:04 | 31 | veh-15 | veh-16 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -805.5 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+3) |
| 137 | t1 05:28:04 | 32 | veh-15 | veh-16 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -925.8 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+4) |
| 138 | t1 05:28:04 | 33 | veh-15 | veh-16 | +1 / 70 / fresh | -8, fresh, implausible_boarding_position | 1 | -984.8 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@1205s … (+1) |
| 139 | t1 05:30:04 | 34 | veh-15 | veh-16 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@19s → M:sel@434s → U@464s → M:gt@1085s → U@1178s |
| 140 | t1 05:32:04 | 34 | veh-15 | veh-16 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@13s → M:sel@314s → U@344s → M:gt@965s → U@1058s |
| 141 | t1 05:34:04 | 34 | veh-15 | veh-16 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@13s → M:sel@194s → U@224s → M:gt@845s → U@938s |
| 142 | t1 05:36:04 | 34 | veh-15 | veh-16 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@14s → M:sel@74s → U@104s → M:gt@725s → U@818s |
| 143 | t1 05:32:04 | 35 | veh-15 | veh-16 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -853.8 | M1 | U@13s → M:sel@314s → U@344s → M:gt@965s → U@1058s → M:gt@1423s |
| 144 | t1 05:34:04 | 35 | veh-15 | veh-16 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -853.8 | M1 | U@13s → M:sel@194s → U@224s → M:gt@845s → U@938s → M:gt@1303s |
| 145 | t1 05:36:04 | 35 | veh-15 | veh-16 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -853.8 | M1 | U@14s → M:sel@74s → U@104s → M:gt@725s → U@818s → M:gt@1183s |
| 146 | t1 05:34:04 | 36 | veh-15 | veh-16 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -885.3 | M1 | U@13s → M:sel@194s → U@224s → M:gt@845s → U@938s → M:gt@1303s … (+1) |
| 147 | t1 05:36:04 | 36 | veh-15 | veh-16 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -885.3 | M1 | U@14s → M:sel@74s → U@104s → M:gt@725s → U@818s → M:gt@1183s … (+1) |
| 148 | t1 05:36:04 | 37 | veh-15 | veh-16 | +1 / 70 / fresh | -9, fresh, implausible_boarding_position | 1 | -941.5 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@233s → M:gt@725s … (+3) |
| 149 | t1 05:38:04 | 37 | veh-15 | veh-16 | +4 / 55 / fresh | -9, fresh, implausible_boarding_position | 1 | -812 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s → M:gt@1063s … (+1) |
| 150 | t3 05:48:04 | 2 | veh-18 | veh-17 | +3 / 60 / fresh | not in feed | 1 | -978.2 | M2 | U@5s → M:sel@63s → U@98s → M:gt@1041s → U@1093s → M:gt@1172s … (+1) |
| 151 | t3 05:52:04 | 6 | veh-18 | veh-17 | +4 / 55 / fresh | not in feed | 1 | -709 | M2 | U@25s → M:sel@223s → U@252s → M:gt@801s → U@853s → M:gt@932s … (+1) |
| 152 | t3 05:54:04 | 6 | veh-18 | veh-17 | +4 / 55 / fresh | not in feed | 1 | -736.4 | M2 | U@25s → M:sel@76s → U@132s → M:gt@681s → U@733s → M:gt@812s … (+1) |
| 153 | t3 05:52:04 | 7 | veh-18 | veh-17 | +3 / 60 / fresh | not in feed | 1 | -772 | M2 | U@25s → M:sel@223s → U@282s → M:gt@822s → U@853s → M:gt@932s … (+1) |
| 154 | t3 05:54:04 | 7 | veh-18 | veh-17 | +3 / 60 / fresh | not in feed | 1 | -799.5 | M2 | U@25s → M:sel@76s → U@162s → M:gt@702s → U@733s → M:gt@812s … (+1) |
| 155 | t3 05:54:04 | 8 | veh-18 | veh-17 | +2 / 65 / fresh | not in feed | 1 | -826.5 | M2 | U@25s → M:sel@76s → U@162s → M:gt@812s → U@843s |
| 156 | t3 05:58:04 | 11 | veh-18 | veh-17 | +4 / 55 / fresh | not in feed | 1 | -673.4 | M2 | U@14s → M:sel@290s → U@323s |
| 157 | t3 06:00:04 | 11 | veh-18 | veh-17 | +4 / 55 / fresh | not in feed | 1 | -673.4 | M2 | U@19s → M:sel@170s → U@203s |
| 158 | t3 06:00:04 | 12 | veh-18 | veh-17 | +3 / 60 / fresh | not in feed | 1 | -763.5 | M2 | U@19s → M:sel@170s → U@203s → M:sel@321s → U@373s |
| 159 | t3 06:02:04 | 12 | veh-18 | veh-17 | +4 / 55 / fresh | -10, fresh, implausible_boarding_position | 1 | -611.9 | M1 | U@20s → M:sel@201s → U@253s |
| 160 | t3 06:04:04 | 12 | veh-18 | veh-17 | +4 / 55 / fresh | -10, fresh, implausible_boarding_position | 1 | -611.9 | M1 | U@26s → M:sel@81s → U@133s |
| 161 | t3 06:06:04 | 12 | veh-18 | veh-17 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -508.2 | M1 | U@13s → M:sel@65s → U@92s |
| 162 | t3 06:02:04 | 13 | veh-18 | veh-17 | +3 / 60 / fresh | -11, fresh, implausible_boarding_position | 1 | -839 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s → M:gt@1167s … (+3) |
| 163 | t3 06:04:04 | 13 | veh-18 | veh-17 | +3 / 60 / fresh | -11, fresh, implausible_boarding_position | 1 | -839 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s → M:gt@1047s … (+3) |
| 164 | t3 06:06:04 | 13 | veh-18 | veh-17 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -735.3 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s … (+1) |
| 165 | t3 06:04:04 | 14 | veh-18 | veh-17 | +2 / 65 / fresh | -12, fresh, implausible_boarding_position | 1 | -1007.7 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s → M:gt@1047s … (+5) |
| 166 | t3 06:06:04 | 14 | veh-18 | veh-17 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -904.1 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s … (+3) |
| 167 | t4 05:28:04 | 2 | veh-17 | veh-13 | +2 / 65 / fresh | not in feed | 1 | -1055 | M2 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@1205s … (+1) |
| 168 | t4 05:28:04 | 3 | veh-17 | veh-13 | +1 / 70 / fresh | not in feed | 1 | -1096.2 | M2 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@1205s … (+1) |
| 169 | t4 05:32:04 | 7 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -770.1 | M2 | U@13s → M:sel@314s → U@344s → M:gt@965s → U@1058s |
| 170 | t4 05:34:04 | 7 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -770.1 | M2 | U@13s → M:sel@194s → U@224s → M:gt@845s → U@938s |
| 171 | t4 05:36:04 | 7 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -770.1 | M2 | U@14s → M:sel@74s → U@104s → M:gt@725s → U@818s |
| 172 | t4 05:34:04 | 8 | veh-17 | veh-13 | +3 / 60 / fresh | not in feed | 1 | -885.3 | M2 | U@13s → M:sel@194s → U@224s → M:gt@845s → U@938s → M:gt@1303s … (+1) |
| 173 | t4 05:36:04 | 8 | veh-17 | veh-13 | +3 / 60 / fresh | not in feed | 1 | -885.3 | M2 | U@14s → M:sel@74s → U@104s → M:gt@725s → U@818s → M:gt@1183s … (+1) |
| 174 | t4 05:36:04 | 9 | veh-17 | veh-13 | +2 / 65 / fresh | not in feed | 1 | -941.5 | M2 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@233s → M:gt@783s … (+3) |
| 175 | t4 05:38:04 | 9 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -812 | M2 | U@29s → M:sel@83s → U@113s → M:gt@663s → U@698s → M:gt@1063s … (+1) |
| 176 | t4 05:40:04 | 9 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -692.1 | M2 | U@27s → M:sel@83s → U@116s → M:gt@543s → U@578s → M:gt@943s … (+1) |
| 177 | t4 05:38:04 | 10 | veh-17 | veh-13 | +3 / 60 / fresh | not in feed | 1 | -952.6 | M2 | U@29s → M:sel@83s → U@113s → M:gt@1063s → U@1122s |
| 178 | t4 05:40:04 | 10 | veh-17 | veh-13 | +3 / 60 / fresh | not in feed | 1 | -832.6 | M2 | U@27s → M:sel@83s → U@116s → M:gt@943s → U@1002s |
| 179 | t4 05:40:04 | 11 | veh-17 | veh-13 | +2 / 65 / fresh | not in feed | 1 | -889.2 | M2 | U@27s → M:sel@83s → U@116s → M:gt@943s → U@1002s |
| 180 | t4 05:40:04 | 12 | veh-17 | veh-13 | +1 / 70 / fresh | not in feed | 1 | -919.5 | M2 | U@27s → M:sel@83s → U@116s → M:gt@943s → U@1002s |
| 181 | t4 05:44:04 | 12 | veh-17 | veh-13 | +4 / 55 / fresh | not in feed | 1 | -680.2 | M2 | U@23s → M:sel@82s → U@124s → M:gt@703s → U@762s |
| 182 | t4 05:44:04 | 13 | veh-17 | veh-13 | +3 / 60 / fresh | not in feed | 1 | -772 | M2 | U@23s → M:sel@82s → U@124s → M:sel@245s → U@338s → M:gt@703s … (+2) |
| 183 | t4 05:46:04 | 13 | veh-17 | veh-13 | +4 / 55 / fresh | -9, fresh, implausible_boarding_position | 1 | -609.2 | M1 | U@4s → M:sel@125s → U@218s → M:gt@583s → U@642s → M:gt@1010s |
| 184 | t4 05:48:04 | 13 | veh-17 | veh-13 | +4 / 55 / fresh | -8, fresh, implausible_boarding_position | 1 | -551.1 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s |
| 185 | t4 05:44:04 | 14 | veh-17 | veh-13 | +2 / 65 / fresh | not in feed | 1 | -927.6 | M2 | U@23s → M:sel@82s → U@124s → M:sel@245s → U@338s → M:gt@703s … (+4) |
| 186 | t4 05:46:04 | 14 | veh-17 | veh-13 | +3 / 60 / fresh | -10, fresh, implausible_boarding_position | 1 | -764.9 | M1 | U@4s → M:sel@125s → U@218s → M:gt@583s → U@642s → M:gt@1010s … (+2) |
| 187 | t4 05:48:04 | 14 | veh-17 | veh-13 | +3 / 60 / fresh | -9, fresh, implausible_boarding_position | 1 | -706.7 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s … (+2) |
| 188 | t4 05:46:04 | 15 | veh-17 | veh-13 | +2 / 65 / fresh | -11, fresh, implausible_boarding_position | 1 | -854.8 | M1 | U@4s → M:sel@125s → U@218s → M:gt@612s → U@642s → M:gt@1010s … (+3) |
| 189 | t4 05:48:04 | 15 | veh-17 | veh-13 | +2 / 65 / fresh | -10, fresh, implausible_boarding_position | 1 | -796.7 | M1 | U@5s → M:sel@63s → U@98s → M:gt@492s → U@522s → M:gt@890s … (+3) |
| 190 | t4 05:48:04 | 16 | veh-17 | veh-13 | +1 / 70 / fresh | -11, fresh, implausible_boarding_position | 1 | -886.2 | M1 | U@5s → M:sel@63s → U@98s → M:gt@890s → U@923s → M:gt@1041s … (+3) |
| 191 | t4 05:54:04 | 16 | veh-17 | veh-13 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -513.8 | M1 | U@25s → M:sel@76s → U@103s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 192 | t4 05:50:04 | 17 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -709 | M1 | U@4s → M:sel@343s → U@402s → M:gt@770s → U@803s → M:gt@921s … (+3) |
| 193 | t4 05:52:04 | 17 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -709 | M1 | U@25s → M:sel@223s → U@282s → M:gt@650s → U@683s → M:gt@801s … (+3) |
| 194 | t4 05:54:04 | 17 | veh-17 | veh-13 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -736.4 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 195 | t4 05:54:04 | 18 | veh-17 | veh-13 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -799.5 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 196 | t4 05:54:04 | 19 | veh-17 | veh-13 | +1 / 70 / fresh | -9, fresh, implausible_boarding_position | 1 | -948.1 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 197 | t4 06:00:04 | 22 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -895.6 | M1 | U@19s → M:sel@170s → U@203s → M:gt@1287s → U@1329s |
| 198 | t4 06:02:04 | 23 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -908.2 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s → M:gt@1167s … (+3) |
| 199 | t4 06:04:04 | 23 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -908.2 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s → M:gt@1047s … (+3) |
| 200 | t4 06:06:04 | 23 | veh-17 | veh-13 | +4 / 55 / fresh | -7, fresh, implausible_boarding_position | 1 | -804.6 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s … (+1) |
| 201 | t4 06:02:04 | 24 | veh-17 | veh-13 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -936.4 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s → M:gt@1167s … (+4) |
| 202 | t4 06:04:04 | 24 | veh-17 | veh-13 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -936.4 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s → M:gt@1047s … (+4) |
| 203 | t4 06:06:04 | 24 | veh-17 | veh-13 | +3 / 60 / fresh | -8, fresh, implausible_boarding_position | 1 | -832.8 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s … (+2) |
| 204 | t4 06:02:04 | 25 | veh-17 | veh-13 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -965.9 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s → M:gt@1167s … (+4) |
| 205 | t4 06:04:04 | 25 | veh-17 | veh-13 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -965.9 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s → M:gt@1047s … (+4) |
| 206 | t4 06:06:04 | 25 | veh-17 | veh-13 | +2 / 65 / fresh | -9, fresh, implausible_boarding_position | 1 | -862.3 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s … (+2) |
| 207 | t5 05:28:04 | 21 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -745.5 | M1 | U@0s → M:sel@57s → U@88s → M:gt@163s → U@194s → M:gt@554s … (+3) |
| 208 | t5 05:28:04 | 22 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -805.5 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+3) |
| 209 | t5 05:28:04 | 23 | veh-14 | veh-15 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -865.5 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+4) |
| 210 | t5 05:30:04 | 24 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -399.5 | M1 | U@19s → M:sel@434s → U@464s → A@563s → U@593s → M:gt@1085s |
| 211 | t5 05:32:04 | 24 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -399.5 | M1 | U@13s → M:sel@314s → U@344s → A@443s → U@473s → M:gt@965s |
| 212 | t5 05:34:04 | 24 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -399.5 | M1 | U@13s → M:sel@194s → U@224s → A@323s → U@353s → M:gt@845s |
| 213 | t5 05:36:04 | 24 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -399.5 | M1 | U@14s → M:sel@74s → U@104s → A@203s → U@233s → M:gt@725s |
| 214 | t5 05:30:04 | 25 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -530.1 | M1 | U@19s → M:sel@434s → U@464s → M:sel@563s → U@593s → M:gt@1085s … (+1) |
| 215 | t5 05:32:04 | 25 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -530.1 | M1 | U@13s → M:sel@314s → U@344s → M:sel@443s → U@473s → M:gt@965s … (+1) |
| 216 | t5 05:34:04 | 25 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -530.1 | M1 | U@13s → M:sel@194s → U@224s → M:sel@323s → U@353s → M:gt@845s … (+1) |
| 217 | t5 05:36:04 | 25 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -530.1 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@233s → M:gt@725s … (+1) |
| 218 | t5 05:38:04 | 25 | veh-14 | veh-15 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -400.6 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s |
| 219 | t5 05:34:04 | 26 | veh-14 | veh-15 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -558.9 | M1 | U@13s → M:sel@194s → U@224s → M:sel@323s → U@353s → M:gt@845s … (+1) |
| 220 | t5 05:36:04 | 26 | veh-14 | veh-15 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -558.9 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@233s → M:gt@725s … (+1) |
| 221 | t5 05:38:04 | 26 | veh-14 | veh-15 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -429.4 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s |
| 222 | t5 05:40:04 | 26 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -309.4 | M1 | U@27s → M:sel@83s → U@116s → M:gt@485s → U@578s |
| 223 | t5 05:38:04 | 27 | veh-14 | veh-15 | +1 / 70 / fresh | -7, fresh, implausible_boarding_position | 1 | -580.2 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s |
| 224 | t5 05:40:04 | 27 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -460.2 | M1 | U@27s → M:sel@83s → U@116s → M:gt@485s → U@578s |
| 225 | t5 05:44:04 | 29 | veh-14 | veh-15 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -620.8 | M1 | U@23s → M:sel@82s → U@124s → M:gt@245s → U@338s → M:gt@703s … (+1) |
| 226 | t5 05:44:04 | 30 | veh-14 | veh-15 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -872.8 | M1 | U@23s → M:sel@82s → U@124s → A@245s → U@338s → M:gt@703s … (+3) |
| 227 | t5 05:46:04 | 31 | veh-14 | veh-15 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -710.1 | M1 | U@4s → M:sel@125s → A@183s → U@218s → M:gt@583s → U@642s … (+2) |
| 228 | t5 05:46:04 | 32 | veh-14 | veh-15 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -734.3 | M1 | U@4s → M:sel@125s → U@218s → M:gt@583s → U@642s → M:gt@1010s … (+1) |
| 229 | t5 05:48:04 | 32 | veh-14 | veh-15 | +2 / 65 / fresh | -5, fresh, implausible_boarding_position | 1 | -676.2 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s … (+1) |
| 230 | t5 05:48:04 | 33 | veh-14 | veh-15 | +1 / 70 / fresh | -6, fresh, implausible_boarding_position | 1 | -706.7 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s … (+2) |
| 231 | t5 05:54:04 | 34 | veh-14 | veh-15 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -394.3 | M1 | U@25s → M:sel@76s → U@103s → M:gt@530s → U@563s → M:gt@681s … (+1) |
| 232 | t5 05:52:04 | 35 | veh-14 | veh-15 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -523 | M1 | U@25s → M:sel@223s → U@282s → M:gt@650s → U@683s → M:gt@801s … (+3) |
| 233 | t5 05:54:04 | 35 | veh-14 | veh-15 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -550.5 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 234 | t5 05:54:04 | 36 | veh-14 | veh-15 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -687 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+3) |
| 235 | t6 05:28:04 | 12 | veh-13 | veh-14 | +4 / 55 / fresh | -8, fresh, implausible_boarding_position | 1 | -571.4 | M1 | U@0s → M:sel@57s → U@88s → M:gt@554s → U@584s → M:gt@683s … (+1) |
| 236 | t6 05:28:04 | 13 | veh-13 | veh-14 | +3 / 60 / fresh | -9, fresh, implausible_boarding_position | 1 | -625.6 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+3) |
| 237 | t6 05:28:04 | 14 | veh-13 | veh-14 | +2 / 65 / fresh | -10, fresh, implausible_boarding_position | 1 | -805.5 | M1 | U@0s → M:sel@57s → U@88s → M:sel@163s → U@194s → M:gt@554s … (+3) |
| 238 | t6 05:32:04 | 16 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -459.5 | M1 | U@13s → M:sel@314s → U@344s → A@443s → U@473s → M:gt@965s … (+1) |
| 239 | t6 05:34:04 | 16 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -459.5 | M1 | U@13s → M:sel@194s → U@224s → A@323s → U@353s → M:gt@845s … (+1) |
| 240 | t6 05:36:04 | 16 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -459.5 | M1 | U@14s → M:sel@74s → U@104s → A@203s → U@233s → M:gt@725s … (+1) |
| 241 | t6 05:34:04 | 17 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@13s → M:sel@194s → U@224s → A@323s → U@353s → M:gt@845s … (+1) |
| 242 | t6 05:36:04 | 17 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -600.1 | M1 | U@14s → M:sel@74s → U@104s → A@203s → U@233s → M:gt@725s … (+1) |
| 243 | t6 05:34:04 | 18 | veh-13 | veh-14 | +1 / 70 / fresh | -7, fresh, implausible_boarding_position | 1 | -744.4 | M1 | U@13s → M:sel@194s → U@224s → M:sel@323s → U@353s → M:gt@845s … (+1) |
| 244 | t6 05:36:04 | 18 | veh-13 | veh-14 | +1 / 70 / fresh | -7, fresh, implausible_boarding_position | 1 | -744.4 | M1 | U@14s → M:sel@74s → U@104s → M:sel@203s → U@233s → M:gt@725s … (+1) |
| 245 | t6 05:38:04 | 18 | veh-13 | veh-14 | +2 / 65 / fresh | -5, fresh, implausible_boarding_position | 1 | -615 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s |
| 246 | t6 05:40:04 | 18 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -495 | M1 | U@27s → M:sel@83s → U@116s → M:gt@485s → U@578s |
| 247 | t6 05:38:04 | 19 | veh-13 | veh-14 | +1 / 70 / fresh | -6, fresh, implausible_boarding_position | 1 | -782.3 | M1 | U@29s → M:sel@83s → U@113s → M:gt@605s → U@698s → M:gt@1063s … (+1) |
| 248 | t6 05:40:04 | 19 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -662.3 | M1 | U@27s → M:sel@83s → U@116s → M:gt@485s → U@578s → M:gt@943s … (+1) |
| 249 | t6 05:44:04 | 21 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -620.8 | M1 | U@23s → M:sel@82s → U@124s → M:gt@245s → U@338s → M:gt@703s … (+1) |
| 250 | t6 05:44:04 | 22 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -680.2 | M1 | U@23s → M:sel@82s → U@124s → M:sel@245s → U@303s → M:gt@703s … (+1) |
| 251 | t6 05:46:04 | 22 | veh-13 | veh-14 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -517.5 | M1 | U@4s → M:sel@125s → U@183s → M:gt@583s → U@642s |
| 252 | t6 05:44:04 | 23 | veh-13 | veh-14 | +1 / 70 / fresh | -7, fresh, implausible_boarding_position | 1 | -772 | M1 | U@23s → M:sel@82s → U@124s → M:sel@245s → U@338s → M:gt@703s … (+2) |
| 253 | t6 05:46:04 | 23 | veh-13 | veh-14 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -609.2 | M1 | U@4s → M:sel@125s → U@218s → M:gt@583s → U@642s → M:gt@1010s |
| 254 | t6 05:48:04 | 23 | veh-13 | veh-14 | +4 / 55 / fresh | -6, fresh, implausible_boarding_position | 1 | -551.1 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s |
| 255 | t6 05:48:04 | 24 | veh-13 | veh-14 | +3 / 60 / fresh | -7, fresh, implausible_boarding_position | 1 | -613.5 | M1 | U@5s → M:sel@63s → U@98s → M:gt@463s → U@522s → M:gt@890s … (+1) |
| 256 | t6 05:48:04 | 25 | veh-13 | veh-14 | +2 / 65 / fresh | -8, fresh, implausible_boarding_position | 1 | -736.2 | M1 | U@5s → M:sel@63s → U@98s → A@463s → U@522s → M:gt@890s … (+3) |
| 257 | t6 05:54:04 | 25 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -363.7 | M1 | U@25s → M:sel@76s → A@103s → U@162s → M:gt@530s → U@563s … (+2) |
| 258 | t6 05:50:04 | 26 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -366.8 | M1 | U@4s → M:sel@343s → U@402s → M:gt@770s → U@803s → M:gt@921s … (+1) |
| 259 | t6 05:52:04 | 26 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -366.8 | M1 | U@25s → M:sel@223s → U@282s → M:gt@650s → U@683s → M:gt@801s … (+1) |
| 260 | t6 05:54:04 | 26 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -394.3 | M1 | U@25s → M:sel@76s → U@162s → M:gt@530s → U@563s → M:gt@681s … (+1) |
| 261 | t6 06:02:04 | 32 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -611.9 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s |
| 262 | t6 06:04:04 | 32 | veh-13 | veh-14 | +3 / 60 / fresh | -5, fresh, implausible_boarding_position | 1 | -611.9 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s |
| 263 | t6 06:06:04 | 32 | veh-13 | veh-14 | +4 / 55 / fresh | -5, fresh, implausible_boarding_position | 1 | -508.2 | M1 | U@13s → M:sel@65s → U@123s |
| 264 | t6 06:02:04 | 33 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -654 | M1 | U@20s → M:sel@201s → U@253s → M:sel@332s → U@363s |
| 265 | t6 06:04:04 | 33 | veh-13 | veh-14 | +2 / 65 / fresh | -6, fresh, implausible_boarding_position | 1 | -654 | M1 | U@26s → M:sel@81s → U@133s → M:sel@212s → U@243s |
| 266 | t6 06:06:04 | 33 | veh-13 | veh-14 | +3 / 60 / fresh | -6, fresh, implausible_boarding_position | 1 | -550.4 | M1 | U@13s → M:sel@65s → U@123s |
| 267 | t6 06:06:04 | 34 | veh-13 | veh-14 | +2 / 65 / fresh | -7, fresh, implausible_boarding_position | 1 | -671.2 | M1 | U@13s → M:sel@65s → U@123s → M:gt@927s → U@969s → M:gt@1028s |

## Route `JEB405320112`: 1 wrong commits

| # | Case (session start UTC) | S | GT | Sel | Sel offset / score / cadence | GT at commit | Eligible | Commit Δ s | Mech. | Timeline |
|---:|---|---:|---|---|---|---|---:|---:|---|---|
| 268 | t5 05:30:05 | 96 | veh-25 | veh-26 | +4 / 55 / fresh | -14, fresh, implausible_boarding_position | 1 | -1011.4 | M1 | U@28s → M:sel@74s → U@105s → M:gt@952s → U@1181s |

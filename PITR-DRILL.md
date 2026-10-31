# PITR drill — HW #15 (bonus, beyond the graded restore-drill)

`RESTORE-DRILL.md` proves "last night's dump restores" (RPO ≈ 24h). This
drill proves the stronger claim: **recover to the exact second before an
incident** (RPO ≈ 0), using point-in-time recovery — a base backup plus
continuous WAL archiving.

**This is not the drill HW#15's grading line requires** — `RESTORE-DRILL.md`
already satisfies that on its own. This is an explicitly-requested bonus
exploration, kept separate because it's destructive to real data (see below)
and needs infrastructure (`archive_mode`, two extra volumes) the required
drill doesn't.

## What the drill does

1. Takes a base backup (`pg_basebackup`) of the real `postgres` service —
   **T0**.
2. Inserts one "good" order after the backup — a transaction that only
   exists in WAL, not in the base backup itself.
3. Captures **T1** = now — the recovery target — and checksums `orders` at
   this exact moment.
4. **Simulates an incident**: `TRUNCATE orders CASCADE` on the real
   `postgres` service — **T2**.
5. Forces the current WAL segment to archive (`pg_switch_wal()`).
6. Populates a fresh, throwaway Postgres data directory from the T0 base
   backup, writes `restore_command`/`recovery_target_time = T1`/
   `recovery_target_action = promote` into it, and starts it as the `pitr`
   service (`docker compose --profile pitr up`).
7. Postgres replays archived WAL up to T1 and auto-promotes. Checksums
   `orders` there and compares against T1's checksum.

If step 2's insert weren't recovered, or step 4's truncate leaked through,
the checksums wouldn't match.

⚠️ **Destructive by design.** Step 4 really does wipe `orders`
(`order_items`/`fulfillments` cascade with it) on the actual dev `postgres`
service — that's the incident being recovered from. Run `npm run seed`
afterward to get demo data back. This is why the script isn't part of `##
Grading`.

## Executed run — 2026-09-16

```
━━━ 0. Clean slate ━━━
  removed any previous pitr container/volume/base backup, provisioned a fresh pgdata_pitr volume
━━━ 1. Baseline checksum ━━━
  orders now: 9|508778  (count|sum(amount_cents))
━━━ 2. T0 — base backup ━━━
  base backup: 46.4M in 0.931s
━━━ 3. T0 → T1 — a 'good' transaction after the backup ━━━
  inserted 1 order after the backup — this must survive the drill
  recovery target (T1): 2026-09-16 16:44:37.034794+00
  orders at T1: 10|933020
━━━ 4. T2 — simulated incident ━━━
  $ TRUNCATE orders CASCADE;  (order_items/fulfillments reference orders — a plain DELETE would fail on that FK)
NOTICE:  truncate cascades to table "order_items"
NOTICE:  truncate cascades to table "fulfillments"
  orders on postgres now: 0|0
━━━ 5. Force the WAL archive ━━━
  WAL segments archived so far: 8
━━━ 6. Recovery starts: populate pgdata_pitr from the base backup ━━━
━━━ 7. Write recovery config, targeting T1 ━━━
━━━ 8. Bring up pitr — it replays WAL and stops/promotes at T1 ━━━
━━━ 9. Verify ━━━
  orders on pitr: 10|933020  (expected: 10|933020)
  pg_is_in_recovery: f  (expected: f — promoted)
  MATCH — recovered exactly to the moment before the incident
━━━ 10. RTO / RPO ━━━
  RTO (this drill): 9.580s — from starting recovery (populate volume) to a verified, promoted instance
  RPO: 0 — recovered to the instant before the incident, thanks to continuous WAL archiving
```

First attempt actually used a plain `DELETE FROM orders`, which failed with
a foreign-key violation (`order_items` references `orders`, no `ON DELETE
CASCADE`) — switched to `TRUNCATE ... CASCADE`, arguably a more realistic
"operator fat-fingered a truncate" incident anyway. Left in as a real example
of the kind of thing a restore-drill is supposed to surface.

## RTO / RPO

- **RTO — measured**: 9.58s end to end, from populating the fresh data
  directory through a verified, promoted instance. At this dataset size,
  that's dominated by container startup + WAL replay setup, not the actual
  WAL replay itself (only a handful of segments existed between T0 and T2).
  At production scale, the base backup's restore time and the volume of WAL
  to replay would both grow and could dominate instead.
- **RPO — 0, by construction**: `recovery_target_time` was set to T1, the
  instant before the incident — every transaction up to and including the
  "good" order survived, and nothing from the incident did. This is the
  entire point of PITR over the plain nightly-dump drill in
  `RESTORE-DRILL.md`, whose RPO is bounded by backup frequency (~24h worst
  case) instead of ~0.

## Cleanup

```bash
docker compose --profile pitr rm -sf pitr
docker volume rm $(docker volume ls -q --filter name=pgdata_pitr)
npm run seed   # orders/order_items/fulfillments were truncated on the real postgres — recreate demo data
```

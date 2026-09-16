# Restore drill — HW #15

One executed run of `scripts/restore-drill.sh`, proving `scripts/backup.sh`'s
dumps actually restore — not just that a `.dump` file exists on disk.

## What the drill does

1. Takes a fresh dump (`bash scripts/backup.sh`).
2. Checksums `orders` on the real `postgres` service.
3. Brings up `restore` — a throwaway Postgres (`docker compose --profile
drill up`), its own volume, its own port (`5434`), no `db/init.sql`, no
   shared state with the real database. Confirms it's genuinely empty before
   proceeding.
4. `pg_restore`s the dump into it, timing the restore.
5. Checksums `orders` again on the restored target and compares.

If the schema and data weren't fully recoverable from the dump alone, step 5
would show a mismatch or the restore itself would fail outright.

## Executed run — 2026-09-16

```
━━━ 1. Fresh dump ━━━
backup: dumping ecom → backups/ecom_20260916T162658Z.dump
backup: done —  28K in 0s
  using: backups/ecom_20260916T162658Z.dump
━━━ 2. Checksum on the real postgres ━━━
  orders before: 8|84536  (count|sum(amount_cents))
━━━ 3. Clean slate: throwaway 'restore' target ━━━
  orders table present in clean restore target: 0 (must be 0)
━━━ 4. pg_restore + timing (RTO) ━━━
━━━ 5. Checksum on the restored target ━━━
  orders after restore: 8|84536
  MATCH — restored data is identical to the source, by checksum
━━━ 6. RTO / RPO ━━━
  RTO (this drill): 0.211s — pg_restore itself, on top of the already-running restore target
  RPO: bounded by the backup schedule (backup.cron, nightly) — up to ~24h of data lost in the worst case
```

Re-run a second time immediately after (same dump, freshly re-created
`restore` target) to confirm the result wasn't a fluke: `0.224s`, MATCH
again.

## RTO / RPO

- **RTO (Recovery Time Objective) — measured**: `pg_restore` itself took
  ~0.2s for the current dataset (8 orders, 11 products, 13 order items — a
  homework-scale DB). On top of that, bringing up a fresh `restore` container
  from a cold image takes a few seconds (`docker compose --profile drill up
--wait`) — the total wall-clock time to a usable recovered database is
  dominated by container startup, not `pg_restore`, at this data size. At
  production scale the balance would flip: `pg_restore`'s own duration would
  dominate as the dataset grows, while container startup stays constant.
- **RPO (Recovery Point Objective) — stated, not measured**: bounded by the
  backup schedule in `backup.cron` (nightly, 03:00). Worst case, if Postgres
  is lost moments before the next scheduled dump, up to ~24h of writes since
  the last backup are unrecoverable with this mechanism alone. Shrinking
  this further requires continuous WAL archiving (point-in-time recovery) —
  a separate, deferred piece of this homework, not part of this drill.

## Cleanup

```bash
docker compose --profile drill rm -sf restore
docker volume rm $(docker volume ls -q --filter name=pgdata_restore)
```

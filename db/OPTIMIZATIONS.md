# Optimizations — HW #12

Setup: `db/schema.sql` → `db/seed.sql` (200,000 `orders`, 5,000 `users`, 1,000
`products`, ~1-4 `order_items` per order) → "before" `EXPLAIN` per query →
`db/indexes.sql` → `ANALYZE;` → "after" `EXPLAIN` per query. All output below
is from a real run against the seeded data, not hand-written.

---

## Query 1 — search by owner + period

```sql
SELECT *
FROM orders
WHERE user_id = 1
  AND created_at >= now() - interval '90 days';
```

### Before

```
 Gather  (cost=1000.00..5884.34 rows=614 width=65) (actual time=0.649..32.134 rows=618 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=2470
   ->  Parallel Seq Scan on orders  (cost=0.00..4822.94 rows=361 width=65) (actual time=0.093..26.086 rows=309 loops=2)
         Filter: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
         Rows Removed by Filter: 99691
         Buffers: shared hit=2470
 Planning:
   Buffers: shared hit=109
 Planning Time: 0.999 ms
 Execution Time: 32.297 ms
(12 rows)
```

### Index added

```sql
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);
```

### After

```
 Bitmap Heap Scan on orders  (cost=19.02..1488.58 rows=643 width=65) (actual time=3.395..22.579 rows=618 loops=1)
   Recheck Cond: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
   Heap Blocks: exact=538
   Buffers: shared hit=538 read=5
   ->  Bitmap Index Scan on idx_orders_user_id_created_at  (cost=0.00..18.86 rows=643 width=0) (actual time=3.070..3.070 rows=618 loops=1)
         Index Cond: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
         Buffers: shared read=5
 Planning:
   Buffers: shared hit=171 read=2
 Planning Time: 2.231 ms
 Execution Time: 23.308 ms
(11 rows)
```

**What changed:** The `Parallel Seq Scan` (2,470 buffers, 32.3 ms) is gone,
replaced by a `Bitmap Index Scan` on the composite index (5 index-page
reads) feeding a `Bitmap Heap Scan` (538 hit + 5 read on the table itself)
— 548 buffers total, ~4.5x fewer. (Re-captured after widening the money
columns to `bigint` and adding the `users.email` unique index — wider rows
mean slightly more pages per scan than the original run, but the same
shape of improvement holds.)

---

## Query 2 — filter by status (+ recent window)

```sql
SELECT uuid, user_id, amount_cents, discount_cents, created_at
FROM orders
WHERE status = 'pending'
  AND created_at >= now() - interval '30 days';
```

Originally `SELECT *`. An admin queue doesn't need every column — and
narrowing it is what makes the fix below actually pay off, not just a
style choice.

### Before

```
 Gather  (cost=1000.00..5986.44 rows=1635 width=44) (actual time=0.708..11.032 rows=1606 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=2470
   ->  Parallel Seq Scan on orders  (cost=0.00..4822.94 rows=962 width=44) (actual time=0.016..7.564 rows=803 loops=2)
         Filter: ((status = 'pending'::text) AND (created_at >= (now() - '30 days'::interval)))
         Rows Removed by Filter: 99197
         Buffers: shared hit=2470
 Planning:
   Buffers: shared hit=100
 Planning Time: 0.427 ms
 Execution Time: 11.127 ms
(12 rows)
```

### Index added — partial, with INCLUDE

```sql
CREATE INDEX idx_orders_pending_created_at ON orders (created_at)
INCLUDE (uuid, user_id, amount_cents, discount_cents)
WHERE status = 'pending';
```

First pass at this index only carried `created_at` as a key column — the
query still had to fetch every matching row from the heap for the other
columns (1,181-1,195 heap pages for ~1,620 rows, one page per row,
essentially no better than a targeted Seq Scan). `INCLUDE` carries the
exact columns the query selects as extra index payload, so once the query
stopped asking for columns the index doesn't have (`SELECT *`), the whole
thing became answerable from the index alone.

### After

```
 Index Only Scan using idx_orders_pending_created_at on orders  (cost=0.29..83.22 rows=1539 width=44) (actual time=0.130..0.495 rows=1606 loops=1)
   Index Cond: (created_at >= (now() - '30 days'::interval))
   Heap Fetches: 0
   Buffers: shared hit=1 read=15
 Planning:
   Buffers: shared hit=154
 Planning Time: 0.689 ms
 Execution Time: 0.591 ms
(8 rows)
```

**What changed:** `Bitmap Heap Scan` is gone entirely — this is now an
`Index Only Scan` with `Heap Fetches: 0`. Buffers dropped from 2,470 to
16 (1 hit + 15 read), ~154x fewer, and execution time from 11.1 ms to
0.59 ms, ~19x faster — a dramatically bigger win than the first version of
this fix, because the query no longer needs the heap at all. The lesson
this replaced: a partial index alone doesn't help much when the query
still asks for columns the index doesn't carry — `INCLUDE` (or, as here,
also narrowing the `SELECT`) is what actually gets you to Index Only.

---

## Query 3 — case-insensitive email lookup

```sql
SELECT *
FROM users
WHERE lower(email) = lower('user2500@example.com');
```

### Fix — a UNIQUE expression index, in `db/schema.sql`, not `db/indexes.sql`

```sql
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
```

This index is a correctness constraint first (case-insensitive email
uniqueness — a plain `UNIQUE` on `email` doesn't catch `'Bob@x.com'` vs
`'bob@x.com'`) that happens to also serve this query, so it lives in
`db/schema.sql` next to the other `UNIQUE` constraints, not in
`db/indexes.sql`. That means it exists from the moment the schema is
created — there's no separate "before this index" state in the normal
pipeline. The "before" below was captured by temporarily dropping it
inside a transaction that gets rolled back (`BEGIN; DROP INDEX
users_email_lower_key; EXPLAIN ...; ROLLBACK;`), the same technique the
lecture material uses to A/B a plan without losing the real index.

### Before (index dropped inside a rolled-back transaction)

```
 Seq Scan on users  (cost=0.00..132.00 rows=25 width=70) (actual time=1.015..1.895 rows=1 loops=1)
   Filter: (lower(email) = 'user2500@example.com'::text)
   Rows Removed by Filter: 4999
   Buffers: shared hit=57
 Planning:
   Buffers: shared hit=90
 Planning Time: 0.893 ms
 Execution Time: 1.958 ms
(8 rows)
```

### After (real state — this index is always present)

```
 Index Scan using users_email_lower_key on users  (cost=0.28..8.30 rows=1 width=70) (actual time=0.059..0.060 rows=1 loops=1)
   Index Cond: (lower(email) = 'user2500@example.com'::text)
   Buffers: shared hit=3
 Planning:
   Buffers: shared hit=132
 Planning Time: 0.582 ms
 Execution Time: 0.088 ms
(7 rows)
```

**What changed:** `Seq Scan` + `Filter` (57 buffers, 1.96 ms) becomes a
plain `Index Scan` with `Index Cond` on the expression itself (3 buffers,
0.09 ms) — ~19x fewer buffers, ~22x faster. Still a plain Index Scan, not
Index Only: `SELECT *` needs every column of `users`, and the expression
index only stores `lower(email)` plus a row pointer, so one heap fetch for
the matching row is unavoidable.

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
 Gather  (cost=1000.00..5686.34 rows=604 width=57) (actual time=1.124..46.947 rows=620 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=2273
   ->  Parallel Seq Scan on orders  (cost=0.00..4625.94 rows=355 width=57) (actual time=0.240..41.174 rows=310 loops=2)
         Filter: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
         Rows Removed by Filter: 99690
         Buffers: shared hit=2273
 Planning:
   Buffers: shared hit=109
 Planning Time: 2.457 ms
 Execution Time: 47.352 ms
(12 rows)
```

### Index added

```sql
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);
```

### After

```
 Bitmap Heap Scan on orders  (cost=18.89..1428.78 rows=631 width=57) (actual time=0.442..5.334 rows=620 loops=1)
   Recheck Cond: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
   Heap Blocks: exact=542
   Buffers: shared hit=542 read=5
   ->  Bitmap Index Scan on idx_orders_user_id_created_at  (cost=0.00..18.74 rows=631 width=0) (actual time=0.353..0.353 rows=620 loops=1)
         Index Cond: ((user_id = 1) AND (created_at >= (now() - '90 days'::interval)))
         Buffers: shared read=5
 Planning:
   Buffers: shared hit=147 read=2
 Planning Time: 9.231 ms
 Execution Time: 5.809 ms
(11 rows)
```

**What changed:** The `Parallel Seq Scan` (2,273 buffers, 47.4 ms) is gone,
replaced by a `Bitmap Index Scan` on the new composite index (5 index-page
reads) feeding a `Bitmap Heap Scan` (542 hit + 5 read on the table itself)
— 552 buffers total, ~4x fewer, and execution time down ~8x, because the
index goes straight to the ~620 matching rows instead of reading and
discarding the other ~199,380.

---

## Query 2 — filter by status (+ recent window)

```sql
SELECT *
FROM orders
WHERE status = 'pending'
  AND created_at >= now() - interval '30 days';
```

### Before

```
 Gather  (cost=1000.00..5778.34 rows=1524 width=57) (actual time=0.381..12.801 rows=1622 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=2273
   ->  Parallel Seq Scan on orders  (cost=0.00..4625.94 rows=896 width=57) (actual time=0.027..8.588 rows=811 loops=2)
         Filter: ((status = 'pending'::text) AND (created_at >= (now() - '30 days'::interval)))
         Rows Removed by Filter: 99189
         Buffers: shared hit=2273
 Planning:
   Buffers: shared hit=109
 Planning Time: 0.766 ms
 Execution Time: 12.936 ms
(12 rows)
```

### Index added — partial

```sql
CREATE INDEX idx_orders_pending_created_at ON orders (created_at)
WHERE status = 'pending';
```

### After

```
 Bitmap Heap Scan on orders  (cost=32.61..2232.26 rows=1589 width=57) (actual time=0.611..6.260 rows=1621 loops=1)
   Recheck Cond: ((created_at >= (now() - '30 days'::interval)) AND (status = 'pending'::text))
   Heap Blocks: exact=1181
   Buffers: shared hit=1181 read=6
   ->  Bitmap Index Scan on idx_orders_pending_created_at  (cost=0.00..32.21 rows=1589 width=0) (actual time=0.505..0.505 rows=1621 loops=1)
         Index Cond: (created_at >= (now() - '30 days'::interval))
         Buffers: shared read=6
 Planning:
   Buffers: shared hit=149
 Planning Time: 0.737 ms
 Execution Time: 6.520 ms
(11 rows)
```

**What changed:** The `Parallel Seq Scan` (2,273 buffers, 12.9 ms) is
replaced by a `Bitmap Index Scan` on the partial index (6 index-page reads)
feeding a `Bitmap Heap Scan` (1,181 hit + 6 read on the table) — 1,193
buffers total, 6.5 ms. Only ~1.9x fewer buffers, a smaller win than the
other two queries, because `pending` rows are scattered across almost as
many heap pages (1,181) as there are matching rows (1,621): the index
still finds them precisely, but the underlying rows were never physically
clustered together, so the heap fetch still touches nearly one page per row.

---

## Query 3 — case-insensitive email lookup

```sql
SELECT *
FROM users
WHERE lower(email) = lower('user2500@example.com');
```

### Before

```
 Seq Scan on users  (cost=0.00..132.00 rows=25 width=65) (actual time=1.296..2.744 rows=1 loops=1)
   Filter: (lower(email) = 'user2500@example.com'::text)
   Rows Removed by Filter: 4999
   Buffers: shared hit=57
 Planning:
   Buffers: shared hit=92
 Planning Time: 1.097 ms
 Execution Time: 2.779 ms
(8 rows)
```

### Index added — expression

```sql
CREATE INDEX idx_users_email_lower ON users (lower(email));
```

### After

```
 Index Scan using idx_users_email_lower on users  (cost=0.28..8.30 rows=1 width=65) (actual time=0.081..0.081 rows=1 loops=1)
   Index Cond: (lower(email) = 'user2500@example.com'::text)
   Buffers: shared hit=1 read=2
 Planning:
   Buffers: shared hit=116 read=1
 Planning Time: 0.575 ms
 Execution Time: 0.112 ms
(7 rows)
```

**What changed:** `Seq Scan` + `Filter` (57 buffers, 2.78 ms) becomes a
plain `Index Scan` with `Index Cond` on the expression itself (3 buffers,
0.11 ms) — ~19x fewer buffers, ~25x faster. Still a plain Index Scan, not
Index Only: `SELECT *` needs every column of `users`, and the expression
index only stores `lower(email)` plus a row pointer, so one heap fetch for
the matching row is unavoidable.

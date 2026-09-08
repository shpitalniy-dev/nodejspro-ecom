-- Demonstrates: "my orders in the last N days" — the classic owner+period
-- lookup. user_id = 1 is the seed's reserved "hero" account (~500+ orders),
-- so this always has a real, reproducible number of matches out of 200k
-- rows, regardless of how the rest of the data was randomized.
--
-- Expected before (no index on user_id/created_at): Seq Scan on orders,
-- Rows Removed by Filter close to the full 200k.
--
-- Fix: a composite index on (user_id, created_at) — equality column first,
-- range column second, the leftmost-prefix rule from the lecture. Add it in
-- db/indexes.sql, then re-run this with ANALYZE (ANALYZE, BUFFERS) — expect
-- an Index Scan (or Bitmap), Index Cond covering both columns, buffers down
-- from ~thousands of pages to single digits.
SELECT *
FROM orders
WHERE user_id = 1
  AND created_at >= now() - interval '90 days';

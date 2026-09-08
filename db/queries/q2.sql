-- Demonstrates: an admin "pending orders from the last 30 days" queue.
-- status = 'pending' is a real minority of all orders (~10% by seed
-- design), intersected with the last-30-days minority (~8%) — a genuinely
-- selective slice (~0.8% of 200k rows), not a coin flip and not close to
-- the "93% of the table" case where the planner would rightly ignore an
-- index anyway.
--
-- Expected before (no index on status/created_at): Seq Scan on orders.
--
-- Fix: a partial index — CREATE INDEX ... ON orders (created_at)
-- WHERE status = 'pending' — indexing only the slice that's actually
-- queried, not all 200k rows (see db/indexes.sql). This is also the file
-- that satisfies the assignment's "at least one partial or expression
-- index" requirement on its own.
--
-- SELECT * originally forced a heap fetch per matching row even with the
-- index in place (an admin queue doesn't need every column anyway — the
-- caller already knows status = 'pending' for every row returned, so it's
-- dropped here too). Narrowed to exactly what INCLUDE on the index carries,
-- so the whole query is answerable from the index alone. Re-run with
-- EXPLAIN (ANALYZE, BUFFERS) after adding the index and re-running ANALYZE
-- — expect an Index Only Scan, Heap Fetches: 0.
SELECT uuid, user_id, amount_cents, discount_cents, created_at
FROM orders
WHERE status = 'pending'
  AND created_at >= now() - interval '30 days';

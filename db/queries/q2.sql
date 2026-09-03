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
-- index" requirement on its own. Re-run with EXPLAIN (ANALYZE, BUFFERS)
-- after adding the index and re-running ANALYZE — expect an Index Scan
-- using that partial index, no Seq Scan left.
SELECT *
FROM orders
WHERE status = 'pending'
  AND created_at >= now() - interval '30 days';

-- The minimal set that fixes all three queries in db/queries/. Run once
-- against the seeded database, then `ANALYZE;` so the planner actually
-- picks these up (see db/OPTIMIZATIONS.md for the before/after proof).

-- Query 1 — owner + period. Equality column first, range column second:
-- the leftmost-prefix rule. Also transparently serves any query filtering
-- on user_id alone.
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);

-- Query 2 — status + recent window. Partial: 'pending' is a real minority
-- of orders, so this indexes that slice only, not all 200k rows. Only
-- covers status = 'pending' — a query for any other status won't use it,
-- by design.
CREATE INDEX idx_orders_pending_created_at ON orders (created_at)
WHERE status = 'pending';

-- Query 3 — case-insensitive email lookup. Expression index: a plain index
-- on email wouldn't be reachable through lower(email) at all.
CREATE INDEX idx_users_email_lower ON users (lower(email));

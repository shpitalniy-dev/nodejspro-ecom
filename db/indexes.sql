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
-- by design. INCLUDE carries the columns q2 actually selects, so the whole
-- query is answerable from the index alone — no heap fetch per row.
CREATE INDEX idx_orders_pending_created_at ON orders (created_at)
INCLUDE (uuid, user_id, amount_cents, discount_cents)
WHERE status = 'pending';

-- Query 3 — case-insensitive email lookup. Handled by the UNIQUE index on
-- lower(email) in db/schema.sql (users_email_lower_key) — that index
-- enforces uniqueness and serves this lookup, so nothing extra is needed
-- here.

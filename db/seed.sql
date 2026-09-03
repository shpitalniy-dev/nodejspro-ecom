-- Realistic-volume seed data
-- Every insert is one set-based statement over generate_series — no
-- per-row PL/pgSQL loop. Distributions are deliberately skewed (see the
-- comment on each table) instead of uniform, so EXPLAIN has something real
-- to say later.

-- ~5,000 users. Not the head table, so no special skew needed here.
INSERT INTO users (name, email, created_at)
SELECT
  'User ' || i,
  'user' || i || '@example.com',
  now() - (random() * interval '730 days')
FROM generate_series(1, 5000) AS i;

-- ~1,000 products.
INSERT INTO products (key, price_cents, currency, created_at)
SELECT
  'SKU-' || i,
  (500 + floor(random() * 20000))::int,
  'USD',
  now() - (random() * interval '730 days')
FROM generate_series(1, 1000) AS i;

-- 200,000 orders — the head table (well past the 100k floor). Three
-- deliberate skews, none of them 33/33/33:
--   * status: mostly 'paid', a real tail of 'pending'/'unpaid'/'canceled'/
--     'refunded'.
--   * user_id: power-law-ish — most orders belong to a minority of users.
--     user_id = 1 is a reserved "hero" account guaranteed a known, moderate
--     slice (~500+ orders), so the "search by owner" query stays
--     reproducible across re-seeds instead of depending on where pure
--     randomness happens to land.
--   * created_at: spread over ~19 months, with only ~8% falling in the last
--     30 days — makes "status = X AND created_at >= now() - 30 days"
--     genuinely selective rather than a coin flip.
-- All volatile draws (amount, discount_rate, status_roll, time_offset) are
-- computed once per row in the inner subquery, then only referenced (never
-- re-rolled) in the outer SELECT — random() evaluates independently on
-- every reference, so rolling it again per derived column would silently
-- decorrelate status/amount/discount from each other.
INSERT INTO orders (user_id, currency, amount_cents, discount_cents, status, created_at)
SELECT
  CASE WHEN i % 400 = 0 THEN 1
       ELSE (1 + floor(4999 * power(random(), 2)))::int
  END,
  'USD',
  amount,
  (floor(amount * discount_rate))::int,
  CASE
    WHEN status_roll < 0.70 THEN 'paid'
    WHEN status_roll < 0.80 THEN 'pending'
    WHEN status_roll < 0.90 THEN 'unpaid'
    WHEN status_roll < 0.96 THEN 'canceled'
    ELSE 'refunded'
  END,
  now() - time_offset
FROM (
  SELECT
    i,
    (500 + floor(random() * 49500))::int AS amount,
    (CASE WHEN random() < 0.3 THEN random() * 0.2 ELSE 0 END) AS discount_rate,
    random() AS status_roll,
    CASE WHEN random() < 0.08
         THEN random() * interval '30 days'
         ELSE interval '30 days' + random() * interval '540 days'
    END AS time_offset
  FROM generate_series(1, 200000) AS i
) base;

-- order_items: 1-4 lines per order, skewed toward 1-2. price/currency are
-- snapshotted from the product at insert time — matches the schema's
-- intentional denormalization (see db/schema.sql), not a duplicate to clean
-- up. The two inner LATERALs (product pick, quantity) re-run once per
-- generated line rather than once per statement, so each line gets its own
-- independent random product and quantity, not the same one copied 500k
-- times.
INSERT INTO order_items (key, currency, price_cents, quantity, product_id, order_id)
SELECT p.key, p.currency, p.price_cents, q.quantity, p.id, o.id
FROM orders o
CROSS JOIN LATERAL (
  SELECT (1 + floor(random() * random() * 4))::int AS item_count
) ic
CROSS JOIN LATERAL generate_series(1, ic.item_count) AS line(n)
CROSS JOIN LATERAL (
  SELECT id, key, currency, price_cents
  FROM products
  ORDER BY random()
  LIMIT 1
) p
CROSS JOIN LATERAL (
  SELECT (1 + floor(random() * random() * 4))::int AS quantity
) q;

-- VACUUM (ANALYZE), not bare ANALYZE: ANALYZE alone gives the planner fresh
-- statistics, but only VACUUM updates the visibility map. Without it, an
-- Index Only Scan in a later "after" EXPLAIN would still show non-zero
-- Heap Fetches, and buffers would be far worse than they need to be.
VACUUM (ANALYZE);

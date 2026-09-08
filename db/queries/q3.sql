-- Demonstrates: case-insensitive "find user by email" lookup — a real login
-- / account-lookup pattern. lower(email) wraps the column in a function, so
-- a plain index on email (if one existed) couldn't be used here at all —
-- the condition would show up under Filter, not Index Cond.
--
-- user2500@example.com is generated deterministically by db/seed.sql
-- ('user' || i || '@example.com' for i in 1..5000), so this always matches
-- exactly one real row regardless of how the rest of the seed was
-- randomized.
--
-- Expected before: Seq Scan on users.
--
-- Fix: a UNIQUE expression index — users_email_lower_key in db/schema.sql
-- (it enforces case-insensitive email uniqueness, and doubles as this
-- query's lookup index — see db/schema.sql for why it lives there and not
-- in db/indexes.sql). Re-run with EXPLAIN (ANALYZE, BUFFERS) after
-- re-running ANALYZE — expect an Index Scan with Index Cond on the
-- lower(email) expression itself (not a Filter). This will always be a
-- plain Index Scan, not an Index Only Scan — SELECT * needs every column
-- of users, and the expression index only stores lower(email) + a row
-- pointer, so one heap fetch for the matching row is unavoidable here.
SELECT *
FROM users
WHERE lower(email) = lower('user2500@example.com');

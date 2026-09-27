CREATE ROLE app_user LOGIN PASSWORD 'postgres_app_password';
GRANT CONNECT ON DATABASE ecom TO app_user;

-- HW #18: the api container itself now connects as app_user (see
-- docker-compose.yml's db-password-seed), not admin — previously nothing
-- ever did, so app_user having zero table privileges was never noticed.
-- No table exists yet when this script runs (init.sql fires once at the
-- very first Postgres startup; migrations, which create every table, run
-- afterward as admin) — ALTER DEFAULT PRIVILEGES is what makes a grant
-- apply automatically to whatever admin creates LATER, not just what
-- already exists right now. No DDL rights included on purpose (see
-- src/data-source.ts's own comment) — app_user reads/writes rows, it
-- doesn't migrate schema.
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

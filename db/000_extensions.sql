-- Extensions required by sondar_schema.sql (unaccent() in generated columns,
-- gen_random_uuid() as default for all primary keys). Must run before the
-- schema itself.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Postgres marks unaccent() STABLE, not IMMUTABLE, so it cannot be used
-- directly inside a GENERATED ALWAYS AS column (sondar_schema.sql uses it
-- for name_normalized/pattern_normalized). This wrapper is functionally
-- identical (same dictionary, same output) but is explicitly declared
-- IMMUTABLE, which is the standard, documented Postgres workaround for this
-- exact situation. sondar_schema.sql calls this wrapper instead of calling
-- unaccent() directly in its generated columns — a syntax-level fix only,
-- the normalization behavior itself is unchanged.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

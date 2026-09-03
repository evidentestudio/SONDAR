-- ============================================================================
-- Extension to sondar_schema.sql — NOT part of the original document.
-- ============================================================================
-- sondar_schema.sql's `users` table has no credential field (it only models
-- identity: email/display_name). Etapa 0 asks for basic login for a shared
-- household, so a password needs to live somewhere. Adding a column here
-- (rather than editing sondar_schema.sql in place) keeps the original file
-- byte-for-byte as delivered, while making this addition easy to spot and
-- reverse if a different auth approach is preferred later.
--
-- There is no open signup: users are seeded directly (scripts/seed.ts) from
-- known household members, matching "autenticação básica pra você e sua
-- esposa" rather than a generic multi-user signup flow.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

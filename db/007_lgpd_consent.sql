-- LGPD — etapa 1: registro de consentimento (base legal do tratamento de
-- dados pessoais) e ponto de partida para exportação/exclusão de dados.
--
-- Tabela própria (não colunas em `users`) porque consentimento é um
-- HISTÓRICO, não um estado atual só: se a política mudar de versão no
-- futuro e o usuário aceitar de novo, o aceite anterior precisa continuar
-- registrado (prova de quando cada versão foi aceita), não ser sobrescrito.
--
-- Pertence ao usuário, não a um household (mesma família como
-- users/auth_tokens) — fica de fora do RLS por household_id (db/006_rls.sql)
-- pela mesma razão que essas tabelas ficam.
CREATE TABLE consent_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version  TEXT NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_records_user ON consent_records(user_id);

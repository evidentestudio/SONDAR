-- Multi-Família — etapa 1: cadastro de conta (antes só existia login pra
-- usuários semeados manualmente).

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Um token só serve pra uma finalidade (nunca um mesmo token verifica email
-- E reseta senha) e só pode ser usado uma vez — usado_at marca isso.
-- Guarda-se o hash do token, nunca o valor puro (mesmo padrão de senha):
-- um vazamento do banco não dá pra ninguém logar como outra pessoa.
CREATE TABLE auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_tokens_user_purpose ON auth_tokens (user_id, purpose);

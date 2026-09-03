-- ============================================================================
-- SONDAR — Schema de banco de dados (PostgreSQL)
-- Baseado em tudo que foi validado no protótipo "Controle financeiro" (Sonar 1.0/2.0)
-- ============================================================================
--
-- DECISÕES DE DESIGN QUE JÁ CORRIGEM PROBLEMAS REAIS DO PROTÓTIPO:
--
-- 1. Categorias com maiúscula/minúscula diferente NUNCA mais duplicam:
--    usamos um índice único sobre o nome NORMALIZADO (lower + sem acento),
--    não sobre o nome literal. Isso resolve de vez o bug "MESADA PAPAI" vs
--    "Mesada Papai" — no banco, é estruturalmente impossível criar as duas.
--
-- 2. "Reserva de emergência", "Auxílio Saúde", "Aguardando Revisão" deixam de
--    ser nomes de categoria hardcoded no código — viram um campo `category_type`.
--    Qualquer categoria pode ser marcada como "reserva" (exclui do orçado/gasto
--    total) sem precisar mexer em código. Isso generaliza o que era um caso
--    especial no protótipo.
--
-- 3. Exclusão nunca é definitiva na hora — usamos soft delete (deleted_at).
--    Isso substitui o sistema de "desfazer" (Ctrl+Z) do protótipo por algo mais
--    robusto: nada é apagado de verdade, só fica oculto, e dá pra recuperar
--    a qualquer momento (inclusive semanas depois, não só "a última ação").
--
-- 4. Créditos e gastos são a mesma tabela (financial_entries) com um campo
--    `entry_type`. Isso evita duplicar toda a lógica de mês/categoria/valor
--    que existia separadamente para "transactions" e "credits" no protótipo.
--
-- 5. Parcelamentos são uma tabela própria (installment_plans), e cada parcela
--    lançada referencia o plano via installment_plan_id. O "avanço automático"
--    de parcela (1/12 -> 2/12) vira uma função/job que roda mensalmente,
--    em vez de lógica recalculada a cada render como no protótipo.
--
-- 6. Nunca guardamos a imagem da fatura — só o resultado da extração da IA.
--    Essa decisão do protótipo era boa e continua aqui.
--
-- ============================================================================
--
-- NOTA DE APLICAÇÃO (únicas 2 mudanças em relação ao arquivo original entregue,
-- ambas puramente sintáticas para o Postgres aceitar o schema, sem alterar
-- nenhum comportamento):
-- 1. As 3 colunas `*_normalized` chamavam `unaccent(...)` diretamente dentro
--    de GENERATED ALWAYS AS. O Postgres exige que a função usada aí seja
--    IMMUTABLE, e unaccent() é apenas STABLE — a coluna gerada não compilava.
--    Trocamos as 3 chamadas por immutable_unaccent() (wrapper de uma linha
--    definido em db/000_extensions.sql, mesmo dicionário, mesmo resultado).
-- 2. O índice idx_entries_household_month usava date_trunc('month', entry_date)
--    numa CREATE INDEX; o Postgres resolve isso pro overload STABLE
--    (timestamptz) e rejeita índice de expressão não-IMMUTABLE. Adicionado
--    ::timestamp explícito em entry_date pra forçar o overload IMMUTABLE.
--    Mesmos valores indexados, só a escolha de overload muda.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- USUÁRIOS
-- ---------------------------------------------------------------------------
-- Mesmo sendo uso único no início (só você), já modelamos com user_id em tudo.
-- Isso custa quase nada agora e evita reescrever todo o schema quando o
-- Sondar virar multiusuário de verdade.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Famílias/casais que compartilham o mesmo controle (ex: você e sua esposa).
-- Um household tem N usuários; todo o resto do schema pertence ao household,
-- não ao usuário individual — assim vocês dois veem os mesmos dados.

CREATE TABLE households (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL DEFAULT 'Minha família',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);


-- ---------------------------------------------------------------------------
-- CATEGORIAS (com hierarquia pai/filho e tipos especiais)
-- ---------------------------------------------------------------------------

CREATE TYPE category_type AS ENUM (
  'normal',           -- categoria comum, conta no orçado/gasto do mês
  'reserve',          -- tipo "Reserva de emergência" / reservas roxas: tem
                      -- orçado e gasto próprios, mas NUNCA entra no total do mês
  'awaiting_review'   -- tipo "Aguardando Revisão": sempre vermelha quando tem
                      -- valor, sinaliza lançamento que a IA não conseguiu classificar
);

CREATE TABLE categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  -- nome normalizado (minúsculo, sem acento) usado só pra checar duplicidade;
  -- gerado automaticamente, nunca editado manualmente
  -- uses immutable_unaccent() (defined in db/000_extensions.sql), not unaccent()
  -- directly, because Postgres requires an IMMUTABLE function inside a
  -- GENERATED column and unaccent() is only STABLE. Same output either way.
  name_normalized   TEXT GENERATED ALWAYS AS (
                      lower(immutable_unaccent(name))
                    ) STORED,
  category_type     category_type NOT NULL DEFAULT 'normal',
  icon              TEXT,               -- emoji/ícone, ex: "🛒"
  color             TEXT,               -- cor de destaque opcional (hex)
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,        -- soft delete

  -- Trava estrutural: dentro de um household, duas categorias/subcategorias
  -- não podem ter o mesmo nome normalizado, MESMO com pai diferente.
  -- Isso é o que impede o bug "MESADA PAPAI" de existir no banco.
  CONSTRAINT uq_category_name_per_household
    UNIQUE (household_id, name_normalized)
);

CREATE INDEX idx_categories_household ON categories(household_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_parent ON categories(parent_id) WHERE deleted_at IS NULL;

-- Nota de implementação: "categoria com subcategoria" = uma linha em `categories`
-- que tem outras linhas apontando pra ela via parent_id. Uma categoria só pode
-- receber lançamentos diretamente se NÃO tiver filhos ativos (regra de app,
-- não de banco — validar na camada de aplicação antes de gravar um lançamento).


-- ---------------------------------------------------------------------------
-- ORÇAMENTO MENSAL POR CATEGORIA
-- ---------------------------------------------------------------------------

CREATE TABLE budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month         DATE NOT NULL,   -- sempre o dia 1 do mês, ex: 2026-08-01
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_budget_category_month UNIQUE (category_id, month)
);

CREATE INDEX idx_budgets_household_month ON budgets(household_id, month);


-- ---------------------------------------------------------------------------
-- PLANOS DE PARCELAMENTO
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ORIGENS DE GASTO (cartão de crédito, poupança, reserva, pix, carnê, etc.)
-- ---------------------------------------------------------------------------
-- Dimensão livre, criada e nomeada pelo próprio usuário — nada hardcoded.
-- O sistema pode sugerir exemplos na hora de criar a primeira, mas não limita
-- quantas nem quais nomes o usuário pode usar.

CREATE TABLE payment_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  name_normalized   TEXT GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED,
  color             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT uq_payment_source_name_per_household
    UNIQUE (household_id, name_normalized)
);
-- Exemplos sugeridos na UI (não pré-criados no banco): "Cartão de crédito",
-- "Pix", "Poupança", "Reserva financeira", "Carnê", "Cheque", "Nota promissória".


CREATE TABLE installment_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  description         TEXT NOT NULL,
  category_id         UUID NOT NULL REFERENCES categories(id),
  payment_source_id   UUID REFERENCES payment_sources(id),  -- ex: parcelado no Pix vs no cartão
  installment_amount  NUMERIC(12,2) NOT NULL,
  total_installments  INTEGER NOT NULL CHECK (total_installments > 1),
  anchor_month        DATE NOT NULL,   -- mês da parcela 1/N
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

-- View: quantas parcelas já deveriam existir até um mês de referência.
-- Usada por um job mensal (ou trigger) que garante que cada mês ativo do
-- plano tenha seu lançamento correspondente em `financial_entries`.
CREATE OR REPLACE FUNCTION installment_number_for_month(p_anchor DATE, p_month DATE)
RETURNS INTEGER AS $$
  SELECT (
    (EXTRACT(YEAR FROM p_month) - EXTRACT(YEAR FROM p_anchor)) * 12
    + (EXTRACT(MONTH FROM p_month) - EXTRACT(MONTH FROM p_anchor))
    + 1
  )::INTEGER;
$$ LANGUAGE sql IMMUTABLE;


-- ---------------------------------------------------------------------------
-- LANÇAMENTOS E CRÉDITOS (unificados)
-- ---------------------------------------------------------------------------

CREATE TYPE entry_type AS ENUM ('expense', 'income');
CREATE TYPE review_status AS ENUM ('confirmed', 'needs_review', 'possible_duplicate');
CREATE TYPE input_method AS ENUM ('manual', 'ai_image', 'ai_text', 'ai_audio', 'system_installment');

CREATE TABLE financial_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  entry_type            entry_type NOT NULL DEFAULT 'expense',
  entry_date            DATE NOT NULL,
  description           TEXT NOT NULL,
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category_id           UUID REFERENCES categories(id),  -- NULL só é válido pra entry_type = 'income'
  payment_source_id     UUID REFERENCES payment_sources(id),  -- de onde saiu o dinheiro (cartão, pix, poupança...)
  installment_plan_id   UUID REFERENCES installment_plans(id),
  installment_number    INTEGER,          -- ex: 3 (a "3" de "3/12")
  installment_confirmed BOOLEAN NOT NULL DEFAULT true,  -- false = número da parcela incerto, aguardando confirmação do usuário
  review_status         review_status NOT NULL DEFAULT 'confirmed',
  input_method          input_method NOT NULL DEFAULT 'manual',
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT chk_expense_has_category
    CHECK (entry_type = 'income' OR category_id IS NOT NULL)
);

-- entry_date::timestamp (not left as date) is required: Postgres resolves
-- date_trunc('month', date) to its STABLE timestamptz overload, which a
-- CREATE INDEX expression rejects; the explicit ::timestamp cast picks the
-- IMMUTABLE timestamp overload instead. Same values indexed either way.
CREATE INDEX idx_entries_household_month
  ON financial_entries (household_id, date_trunc('month', entry_date::timestamp))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_category ON financial_entries(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_plan ON financial_entries(installment_plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_payment_source ON financial_entries(payment_source_id) WHERE deleted_at IS NULL;

-- Detecção de possível duplicidade (mesma categoria + valor no mesmo mês):
-- roda como CHECK na aplicação antes de inserir (não trava a gravação,
-- só sinaliza via review_status = 'possible_duplicate'), replicando o
-- comportamento do protótipo.


-- ---------------------------------------------------------------------------
-- REGRAS DE CATEGORIZAÇÃO POR ESTABELECIMENTO
-- ---------------------------------------------------------------------------

CREATE TABLE merchant_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  pattern         TEXT NOT NULL,   -- trecho do nome do estabelecimento, ex: "ifood"
  pattern_normalized TEXT GENERATED ALWAYS AS (lower(immutable_unaccent(pattern))) STORED,
  category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_ambiguous    BOOLEAN NOT NULL DEFAULT false,  -- true = nunca auto-aplica,
                                                    -- sempre manda pra revisão
                                                    -- (ex: "Anthropic", "Angeloni")
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT uq_merchant_rule UNIQUE (household_id, pattern_normalized)
);


-- ---------------------------------------------------------------------------
-- NOTAS / IDEIAS FUTURAS
-- ---------------------------------------------------------------------------
-- Espaço livre pro usuário anotar melhorias/ideias sem misturar com
-- categorias financeiras (era um hábito real do usuário no protótipo, que
-- acabava criando categorias-lixo tipo "MELHORIAS NA PLANILHA").

CREATE TABLE notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  is_done       BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);


-- ---------------------------------------------------------------------------
-- HISTÓRICO DE AÇÕES (auditoria + suporte a desfazer)
-- ---------------------------------------------------------------------------
-- Em vez de guardar só "a última ação" como no protótipo, guardamos um log
-- de tudo. Combinado com soft delete acima, dá pra desfazer qualquer coisa,
-- não só a última.

CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id),
  action        TEXT NOT NULL,        -- ex: 'delete_category', 'edit_entry'
  table_name    TEXT NOT NULL,
  record_id     UUID NOT NULL,
  before_data   JSONB,
  after_data    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_household ON audit_log(household_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- CONTROLE DE PROCESSAMENTO DE FATURA POR IA (sem guardar a imagem)
-- ---------------------------------------------------------------------------

CREATE TABLE ai_extraction_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL,   -- 'image' | 'text' | 'audio'
  entries_created INTEGER NOT NULL DEFAULT 0,
  flagged_count   INTEGER NOT NULL DEFAULT 0,  -- quantos vieram como needs_review
  model_used      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Só metadados de auditoria/custo de API — a imagem em si nunca é persistida,
-- mantendo a mesma decisão de privacidade do protótipo.


-- ============================================================================
-- VIEWS DE APOIO (equivalentes ao que era calculado no front-end no protótipo)
-- ============================================================================

-- Gasto e orçado por categoria e mês, já somando filhas dentro da mãe
-- (equivalente ao "soma das subcategorias" do protótipo).
CREATE OR REPLACE VIEW category_month_summary AS
WITH RECURSIVE category_tree AS (
  SELECT id, id AS root_id, household_id, category_type
  FROM categories WHERE deleted_at IS NULL
  UNION ALL
  SELECT c.id, ct.root_id, c.household_id, c.category_type
  FROM categories c
  JOIN category_tree ct ON c.parent_id = ct.id
  WHERE c.deleted_at IS NULL
)
SELECT
  ct.root_id AS category_id,
  date_trunc('month', e.entry_date)::DATE AS month,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'expense') AS gasto,
  COALESCE(b.amount, 0) AS orcado
FROM category_tree ct
LEFT JOIN financial_entries e ON e.category_id = ct.id AND e.deleted_at IS NULL
LEFT JOIN budgets b ON b.category_id = ct.root_id
  AND b.month = date_trunc('month', e.entry_date)::DATE
GROUP BY ct.root_id, date_trunc('month', e.entry_date), b.amount;

-- Total gasto por origem (cartão, pix, poupança, reserva...) no mês —
-- permite ao usuário ver "quanto saiu do cartão vs quanto consumiu a reserva".
CREATE OR REPLACE VIEW payment_source_month_summary AS
SELECT
  ps.household_id,
  ps.id AS payment_source_id,
  ps.name AS payment_source_name,
  date_trunc('month', e.entry_date)::DATE AS month,
  SUM(e.amount) AS total
FROM financial_entries e
JOIN payment_sources ps ON ps.id = e.payment_source_id
WHERE e.deleted_at IS NULL AND e.entry_type = 'expense'
GROUP BY ps.household_id, ps.id, ps.name, date_trunc('month', e.entry_date);

CREATE OR REPLACE VIEW month_totals AS
SELECT
  c.household_id,
  date_trunc('month', e.entry_date)::DATE AS month,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'expense' AND c.category_type = 'normal') AS gasto_total,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'income') AS creditos_total
FROM financial_entries e
JOIN categories c ON c.id = e.category_id
WHERE e.deleted_at IS NULL
GROUP BY c.household_id, date_trunc('month', e.entry_date);

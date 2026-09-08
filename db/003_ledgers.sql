-- ============================================================================
-- Etapa 3.5 — Orçamentos paralelos ("ledgers")
-- ============================================================================
-- Até aqui, "origem" (payment_sources) misturava dois conceitos: método de
-- pagamento (Cartão, Pix, Dinheiro — dimensão livre, sem orçamento próprio)
-- e o que o usuário realmente queria, que é um ORÇAMENTO PARALELO ao
-- principal (Reserva de Emergência, Investimentos, Empresa, Mesadas...),
-- com sua própria árvore de categorias e seus próprios totais, sem
-- influenciar o orçamento principal nem os demais.
--
-- payment_sources continua exatamente como está — é método de pagamento,
-- compartilhado por todos os orçamentos (o mesmo Cartão de Crédito pode
-- pagar uma despesa do Principal e uma da Empresa).
--
-- Esta migração introduz `ledgers`: cada household sempre tem um ledger
-- "Principal" (criado automaticamente, não pode ser excluído), e quantos
-- outros o usuário quiser criar livremente, sem lista fixa nem limite.
-- ============================================================================

CREATE TABLE ledgers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_normalized TEXT GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT uq_ledger_name_per_household UNIQUE (household_id, name_normalized)
);

-- No máximo um "Principal" ativo por household.
CREATE UNIQUE INDEX uq_ledger_default_per_household
  ON ledgers(household_id) WHERE is_default AND deleted_at IS NULL;

CREATE INDEX idx_ledgers_household ON ledgers(household_id) WHERE deleted_at IS NULL;

-- Cria o "Principal" pra todo household que já existir.
INSERT INTO ledgers (household_id, name, is_default)
SELECT id, 'Principal', true FROM households
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- categories.ledger_id
-- ---------------------------------------------------------------------------

ALTER TABLE categories ADD COLUMN ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE;

UPDATE categories c
SET ledger_id = l.id
FROM ledgers l
WHERE l.household_id = c.household_id AND l.is_default AND c.ledger_id IS NULL;

ALTER TABLE categories ALTER COLUMN ledger_id SET NOT NULL;
CREATE INDEX idx_categories_ledger ON categories(ledger_id) WHERE deleted_at IS NULL;

-- A trava de nome único deixa de ser por household e passa a ser por ledger:
-- a mesma "Combustível" pode existir em dois orçamentos diferentes sem
-- colidir, porque agora são árvores de categoria independentes.
ALTER TABLE categories DROP CONSTRAINT uq_category_name_per_household;
ALTER TABLE categories ADD CONSTRAINT uq_category_name_per_ledger UNIQUE (ledger_id, name_normalized);


-- ---------------------------------------------------------------------------
-- financial_entries.ledger_id
-- ---------------------------------------------------------------------------
-- Guardado explicitamente (não só derivado da categoria) porque um crédito
-- (entry_type = 'income') não tem categoria — precisa saber a qual
-- orçamento pertence de outro jeito.

ALTER TABLE financial_entries ADD COLUMN ledger_id UUID REFERENCES ledgers(id);

UPDATE financial_entries e
SET ledger_id = c.ledger_id
FROM categories c
WHERE c.id = e.category_id AND e.ledger_id IS NULL;

UPDATE financial_entries e
SET ledger_id = l.id
FROM ledgers l
WHERE l.household_id = e.household_id AND l.is_default AND e.ledger_id IS NULL;

ALTER TABLE financial_entries ALTER COLUMN ledger_id SET NOT NULL;
CREATE INDEX idx_entries_ledger ON financial_entries(ledger_id) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- installment_plans.ledger_id (Etapa 4 ainda não usa esta tabela, mas já
-- nasce com o campo pra não precisar de outra migração)
-- ---------------------------------------------------------------------------

ALTER TABLE installment_plans ADD COLUMN ledger_id UUID REFERENCES ledgers(id);

UPDATE installment_plans p
SET ledger_id = c.ledger_id
FROM categories c
WHERE c.id = p.category_id AND p.ledger_id IS NULL;

UPDATE installment_plans p
SET ledger_id = l.id
FROM ledgers l
WHERE l.household_id = p.household_id AND l.is_default AND p.ledger_id IS NULL;

ALTER TABLE installment_plans ALTER COLUMN ledger_id SET NOT NULL;


-- ---------------------------------------------------------------------------
-- Views: agrupar/filtrar por ledger
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE VIEW cannot reorder/insert columns mid-list (only append
-- at the end) — these three views gain ledger_id ahead of existing columns,
-- so they're dropped and recreated instead.
DROP VIEW IF EXISTS category_month_summary;
DROP VIEW IF EXISTS payment_source_month_summary;
DROP VIEW IF EXISTS month_totals;

CREATE VIEW category_month_summary AS
WITH RECURSIVE category_tree AS (
  SELECT id, id AS root_id, household_id, ledger_id, category_type
  FROM categories WHERE deleted_at IS NULL
  UNION ALL
  SELECT c.id, ct.root_id, c.household_id, c.ledger_id, c.category_type
  FROM categories c
  JOIN category_tree ct ON c.parent_id = ct.id
  WHERE c.deleted_at IS NULL
)
SELECT
  ct.root_id AS category_id,
  ct.ledger_id,
  date_trunc('month', e.entry_date)::DATE AS month,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'expense') AS gasto,
  COALESCE(b.amount, 0) AS orcado
FROM category_tree ct
LEFT JOIN financial_entries e ON e.category_id = ct.id AND e.deleted_at IS NULL
LEFT JOIN budgets b ON b.category_id = ct.root_id
  AND b.month = date_trunc('month', e.entry_date)::DATE
GROUP BY ct.root_id, ct.ledger_id, date_trunc('month', e.entry_date), b.amount;

-- payment_sources continua sendo uma dimensão só do household (método de
-- pagamento é compartilhado entre orçamentos) — o ledger_id vem do
-- lançamento em si, pra permitir filtrar "quanto saiu do Cartão só na
-- Empresa" sem tornar o método de pagamento também dependente de ledger.
CREATE VIEW payment_source_month_summary AS
SELECT
  ps.household_id,
  e.ledger_id,
  ps.id AS payment_source_id,
  ps.name AS payment_source_name,
  date_trunc('month', e.entry_date)::DATE AS month,
  SUM(e.amount) AS total
FROM financial_entries e
JOIN payment_sources ps ON ps.id = e.payment_source_id
WHERE e.deleted_at IS NULL AND e.entry_type = 'expense'
GROUP BY ps.household_id, e.ledger_id, ps.id, ps.name, date_trunc('month', e.entry_date);

-- month_totals agrupa por e.ledger_id (não pela categoria) porque um
-- crédito não tem categoria, mas sempre tem ledger_id.
CREATE VIEW month_totals AS
SELECT
  e.household_id,
  e.ledger_id,
  date_trunc('month', e.entry_date::timestamp)::DATE AS month,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'expense' AND c.category_type = 'normal') AS gasto_total,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'income') AS creditos_total
FROM financial_entries e
LEFT JOIN categories c ON c.id = e.category_id
WHERE e.deleted_at IS NULL
GROUP BY e.household_id, e.ledger_id, date_trunc('month', e.entry_date::timestamp);

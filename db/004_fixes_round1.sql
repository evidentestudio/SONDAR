-- Round 1 de correções pós-revisão manual (categorias, formas de pagamento,
-- regras de estabelecimento, orçamento).

-- Bug: as constraints UNIQUE abaixo contavam linhas com soft delete
-- (deleted_at preenchido) como ocupando o nome — excluir "Lazer" e tentar
-- recriar uma categoria "Lazer" batia direto na constraint antiga, sem
-- nenhum jeito de contornar pela aplicação. UNIQUE de tabela não aceita
-- WHERE, então cada uma vira um índice único parcial equivalente (mesmo
-- efeito pra ON CONFLICT/erro de duplicidade), agora ignorando linhas
-- excluídas.
ALTER TABLE categories DROP CONSTRAINT uq_category_name_per_ledger;
CREATE UNIQUE INDEX uq_category_name_per_ledger
  ON categories (ledger_id, name_normalized) WHERE deleted_at IS NULL;

ALTER TABLE payment_sources DROP CONSTRAINT uq_payment_source_name_per_household;
CREATE UNIQUE INDEX uq_payment_source_name_per_household
  ON payment_sources (household_id, name_normalized) WHERE deleted_at IS NULL;

ALTER TABLE merchant_rules DROP CONSTRAINT uq_merchant_rule;
CREATE UNIQUE INDEX uq_merchant_rule
  ON merchant_rules (household_id, pattern_normalized) WHERE deleted_at IS NULL;

-- "Forma de pagamento principal" — pré-seleciona no formulário de lançamento.
-- Só uma pode ser default por household; a aplicação garante isso ao gravar
-- (zera todas as outras antes de marcar a nova), não precisa de constraint.
ALTER TABLE payment_sources ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

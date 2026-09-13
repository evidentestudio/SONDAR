-- ---------------------------------------------------------------------------
-- financial_entries.split_group_id
-- ---------------------------------------------------------------------------
-- Etapa 5 (sondar-etapas-implementacao.md): "dividir lançamento salvo em N
-- categorias (não só 2)". Uma divisão vira N linhas normais de
-- financial_entries — cada uma com sua própria categoria e sua fatia do
-- valor —, marcadas com o mesmo split_group_id pra saber que pertencem ao
-- mesmo lançamento original e poder reagrupar/editar juntas. Nenhuma view
-- ou relatório precisa mudar: cada parte já soma certo na categoria dela,
-- exatamente como qualquer outro lançamento.
-- NULL = lançamento normal, não dividido (o caso de sempre).
ALTER TABLE financial_entries ADD COLUMN split_group_id UUID;
CREATE INDEX idx_entries_split_group ON financial_entries(split_group_id) WHERE deleted_at IS NULL;

-- Melhorias de ingestão multimodal — sub-etapa 1: fundação de dados.
-- Ver sondar-melhorias-multimodal.md. Puro schema, sem mudança de
-- comportamento ainda (toda coluna nova tem default que preserva o
-- comportamento atual) — as sub-etapas seguintes é que passam a usar isto.

-- ---------------------------------------------------------------------------
-- financial_entries.amount_confidence
-- ---------------------------------------------------------------------------
-- "confianca_valor" do documento: áudio às vezes arredonda ("uns quarenta"),
-- fatura/print nunca. Default 'exact' preserva todo lançamento existente e
-- todo lançamento manual/de imagem futuro como estava.
CREATE TYPE amount_confidence AS ENUM ('exact', 'approximate');
ALTER TABLE financial_entries
  ADD COLUMN amount_confidence amount_confidence NOT NULL DEFAULT 'exact';

-- Nota: "origem" (foto/áudio/texto) do documento já existe — é
-- input_method (ai_image/ai_audio/ai_text/manual/system_installment).
-- Não duplicar em outra coluna.


-- ---------------------------------------------------------------------------
-- ai_extraction_logs.ledger_id / period_start / period_end
-- ---------------------------------------------------------------------------
-- "periodo_coberto" do documento: guardado na extração da imagem, não no
-- lançamento — sem isso não dá pra saber se um print novo substitui ou soma
-- ao período de um print anterior. NULL pra extrações de texto/áudio, que
-- não cobrem um intervalo de datas.
--
-- ledger_id também estava faltando aqui desde a Etapa 3.5 (ledgers) — a
-- extração já é feita por ledger (processExtractedItems recebe ledgerId),
-- só o log de auditoria não registrava. Nullable porque logs antigos não
-- têm como saber retroativamente.
ALTER TABLE ai_extraction_logs ADD COLUMN ledger_id UUID REFERENCES ledgers(id);
ALTER TABLE ai_extraction_logs ADD COLUMN period_start DATE;
ALTER TABLE ai_extraction_logs ADD COLUMN period_end DATE;


-- ---------------------------------------------------------------------------
-- merchant_rules.rule_type
-- ---------------------------------------------------------------------------
-- "Apelido falado no dicionário de comerciantes" do documento: mesmo
-- mecanismo de regras, mas uma fala como "mercado" não deve ser
-- fuzzy-casada contra texto de fatura (colide com nomes reais de
-- estabelecimento) — precisa de um tipo de chave próprio. Default
-- 'invoice_pattern' preserva toda regra existente exatamente como está.
ALTER TABLE merchant_rules
  ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'invoice_pattern'
    CHECK (rule_type IN ('invoice_pattern', 'spoken_alias'));

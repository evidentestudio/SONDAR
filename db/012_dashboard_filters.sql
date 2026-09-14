-- ---------------------------------------------------------------------------
-- dashboard_filters
-- ---------------------------------------------------------------------------
-- Etapa 6 (sondar-etapas-implementacao.md): "painel compartilhável" — nome
-- herdado da época da planilha (print pra compartilhar por fora); hoje é só
-- um painel dentro do próprio app, com "baixar como imagem". O "segundo
-- painel economizável" não é uma tela separada: é o MESMO painel com um
-- filtro de quais categorias aparecem (decisão do usuário — só ele sabe
-- quais categorias não tem margem pra economizar), e esse filtro pode ser
-- salvo com nome pra acesso rápido (ex: "Economizável").
CREATE TABLE dashboard_filters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- Categorias-folha incluídas quando esse filtro é aplicado. Guardado como
  -- lista explícita (não "todas exceto X") pra continuar correto mesmo se
  -- novas categorias forem criadas depois — uma categoria nova nunca entra
  -- sozinha num filtro salvo antes dela existir.
  category_ids    UUID[] NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_dashboard_filter_name_per_ledger UNIQUE (ledger_id, name)
);

CREATE INDEX idx_dashboard_filters_ledger ON dashboard_filters(ledger_id);

ALTER TABLE dashboard_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON dashboard_filters
  USING (household_id = current_setting('app.current_household_id', true)::uuid)
  WITH CHECK (household_id = current_setting('app.current_household_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_filters TO sondar_app;

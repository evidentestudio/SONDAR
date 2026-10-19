-- ---------------------------------------------------------------------------
-- duplicate_dismissals
-- ---------------------------------------------------------------------------
-- Buscador de lançamentos duplicados (pedido fora do roteiro sequenciado,
-- 2026-10-19): ao rodar a busca, o par fica marcado como "não é duplicado"
-- quando a pessoa escolhe "Ignorar" — nunca mais reaparece nas buscas
-- seguintes, mesmo escopo de "Não me avise mais" (gap_alerts_silenced em
-- categories), só que por par de lançamento em vez de por categoria.
-- entry_id_a < entry_id_b é uma ordem canônica (menor UUID primeiro) pra um
-- mesmo par nunca gerar duas linhas diferentes dependendo da ordem em que os
-- dois lançamentos foram comparados.
CREATE TABLE duplicate_dismissals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  entry_id_a      UUID NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  entry_id_b      UUID NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_duplicate_dismissal_order CHECK (entry_id_a < entry_id_b),
  CONSTRAINT uq_duplicate_dismissal UNIQUE (entry_id_a, entry_id_b)
);

CREATE INDEX idx_duplicate_dismissals_household ON duplicate_dismissals(household_id);

ALTER TABLE duplicate_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON duplicate_dismissals
  USING (household_id = current_setting('app.current_household_id', true)::uuid)
  WITH CHECK (household_id = current_setting('app.current_household_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON duplicate_dismissals TO sondar_app;

-- Multi-Família — etapa 3: isolamento entre famílias reforçado no próprio
-- banco (Row-Level Security), como segunda camada além do filtro por
-- household_id que cada serviço já faz em toda consulta.
--
-- PRÉ-REQUISITO (feito à mão no console do Neon antes de rodar esta
-- migração): criar um role novo chamado `sondar_app` (aba "Roles" do
-- projeto no Neon → "Add Role"). O Neon gera a senha e a connection string
-- sozinho — essa connection string vira a variável DATABASE_URL_APP.
--
-- Por quê um role novo? O role que já existe (dono das tabelas, usado em
-- DATABASE_URL) continua tendo acesso irrestrito — é ele quem roda
-- migrações e o script de seed, que legitimamente precisam enxergar/alterar
-- dados de mais de um household ao mesmo tempo (ex: as migrações 003/004
-- fizeram UPDATE em massa em todos os households). Só o `sondar_app` (usado
-- pela aplicação em produção, em DATABASE_URL_APP) fica sujeito às políticas
-- de RLS abaixo — é a conexão que atende pedidos de usuários reais.
--
-- Como funciona a política: cada request autenticado roda suas consultas
-- dentro de uma transação que define app.current_household_id = <household
-- da sessão> (ver dbForHousehold em src/lib/db.ts). As políticas abaixo
-- comparam household_id da linha com essa variável — o Postgres nunca
-- devolve (nem aceita gravar) uma linha de outro household, mesmo que um
-- bug futuro no código esqueça o filtro na query.
--
-- Tabelas de identidade/acesso (users, households, household_members,
-- auth_tokens) ficam DE FORA do RLS: não fazem sentido filtradas por "um"
-- household (households é o próprio dono do dado; users/auth_tokens
-- pertencem a um usuário, não a um household; household_members é
-- justamente a tabela que resolve a qual household um usuário pertence,
-- antes de existir contexto de household na sessão).

GRANT USAGE ON SCHEMA public TO sondar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sondar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sondar_app;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'budgets', 'payment_sources', 'installment_plans',
    'financial_entries', 'merchant_rules', 'notes', 'ledgers',
    'audit_log', 'ai_extraction_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I
         USING (household_id = current_setting(''app.current_household_id'', true)::uuid)
         WITH CHECK (household_id = current_setting(''app.current_household_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

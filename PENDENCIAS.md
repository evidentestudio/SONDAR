# Pendências antes do comercial

Itens combinados durante o desenvolvimento que ficaram propositalmente
adiados — não são bugs em aberto, são decisões de quando agir. Cada um tem
o gatilho de quando revisitar.

## Infra / backup

- **Upgrade do plano Neon (snapshots agendados)**: hoje a janela de restauração
  automática é de só 6 horas, e não há snapshot recorrente configurado (só
  manual, sob demanda). Decisão do usuário: manter manual (criar snapshot à
  mão antes de mudanças de schema) até as primeiras vendas, e pagar o
  upgrade com a receita inicial. **Gatilho: primeira venda confirmada.**
- **Monitoramento de erro em produção** (ex: Sentry): hoje, se algo quebrar
  em produção, só se descobre por relato manual. **Gatilho: antes de abrir
  para clientes externos.**

## Segurança / LGPD (nascem juntas com Multi-Família)

- ✅ **Termo de consentimento com registro de aceite** (2026-09-10) —
  checkbox obrigatório no cadastro ("Li e aceito a Política de
  Privacidade"), registrado em `consent_records` (usuário + versão da
  política + data). `createAccount` recusa o cadastro sem esse aceite.
- ✅ **Política de privacidade — rascunho técnico** (2026-09-10) — página
  pública em `/politica-privacidade`, conteúdo em
  `src/lib/legal/privacy-policy.ts`. Mapeia com precisão o que o Sondar
  faz de verdade (dados coletados, operadores — Vercel, Neon, Anthropic,
  Resend —, retenção, direitos do titular). **Falta**: revisão por
  advogado antes de valer como documento legal definitivo (marcado com
  aviso de rascunho na própria página) e preencher os campos pendentes
  (razão social/CNPJ e contato do responsável).
- ⬜ Exportar meus dados / excluir minha conta (direitos do titular) —
  decisão já tomada: exclusão é soft delete imediato (some do app na
  hora) + expurgo definitivo em até 30 dias. Falta implementar a tela em
  Configurações.
- ⬜ Trilha de auditoria — a tabela `audit_log` já existe no schema desde a
  Etapa 0, mas nunca foi usada. Serve tanto pra LGPD quanto para o futuro
  "desfazer".
- **Gatilho: junto com a implementação de Multi-Família, antes da Etapa 5.**

## Limpeza antes do lançamento comercial

- Remover (ou esconder atrás de flag) a caixa de teste "Avançar parcelas
  pra esse mês" em `/installment-plans` — é só ferramenta de
  desenvolvimento, não deveria existir pra um cliente pagante.
- **Gatilho: quando o avanço automático via cron já estiver validado em
  produção por tempo suficiente sem intervenção manual.**

## Funcionalidades adiadas por decisão explícita (não esquecidas)

- Desfazer / Ctrl+Z — combinar escopo antes de implementar (desfazer só a
  última ação vs. histórico navegável).
- Regras de estabelecimento não alteradas na revisão de fatura deveriam
  salvar sozinhas — falta alinhar o critério exato de "não alterada".
- Calculadora no cabeçalho (cabeçalho fixo durante rolagem já implementado
  em 2026-09-10, em todas as telas).
- Protótipo de chat com IA pra tirar dúvidas sobre a planilha (respostas
  curtas + limite de uso).

## Multi-Família — em andamento (ordem combinada: 1 → 2 → 3, depois LGPD e cobrança)

1. ✅ **Cadastro de conta** (2026-09-10) — signup, confirmação de email,
   esqueci/redefinir senha. Testado end-to-end em produção, inclusive
   recebimento real do email de redefinição de senha via Resend.
   **Falta**: o Resend está em modo sandbox — só entrega email pro
   endereço dono da conta (`evidentestudio@gmail.com`), não pra clientes
   de verdade. Pra enviar pra qualquer destinatário é preciso verificar um
   domínio próprio em resend.com/domains e trocar o `EMAIL_FROM` pra usar
   esse domínio. **Gatilho: antes de abrir cadastro pra usuários reais
   (fora da equipe).**
2. ✅ **Abrir o sistema pra múltiplas famílias** (2026-09-10) — na prática já
   funcionava (login/sessão nunca assumiram household único; todo
   household_id vem da sessão verificada no servidor, nunca do cliente).
3. ✅ **Row-Level Security no Postgres** (2026-09-10) — segunda camada de
   isolamento além do filtro por household_id em cada query: role restrito
   `sondar_app` + política em toda tabela household-scoped (categorias,
   orçamentos, formas de pagamento, parcelamentos, lançamentos, regras,
   notas, ledgers, audit_log, ai_extraction_logs). Mesmo uma query futura
   que esqueça o filtro não consegue ler/gravar dado de outra família — o
   Postgres recusa. Setup em produção concluído: role `sondar_app` criado
   no Neon, `DATABASE_URL_APP` configurada no Vercel (Production/Preview/
   Development), migração `db/006_rls.sql` aplicada e registrada em
   `_sondar_migrations` (junto com 004 e 005, que também estavam
   faltando no registro).
   tem a proteção ainda.
4. 🟡 LGPD — em andamento (ver seção "Segurança / LGPD" acima): consentimento
   e política de privacidade concluídos; exportar/excluir dados e trilha de
   auditoria ainda pendentes.
5. ⬜ Cobrança — depende de decisão de negócio (preço/plano) antes de
   integrar qualquer serviço.

## Roteiro

- `sondar-etapas-implementacao.md` ainda precisa ser reenviado pra
  confirmar o escopo exato da Etapa 5 em diante.

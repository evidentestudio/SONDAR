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
4. 🟡 LGPD — em andamento (ver seção "Segurança / LGPD" acima): consentimento
   e política de privacidade concluídos; exportar/excluir dados e trilha de
   auditoria ainda pendentes.
5. ⬜ Cobrança — depende de decisão de negócio (preço/plano) antes de
   integrar qualquer serviço.

## Roteiro

- `sondar-etapas-implementacao.md` (recebido em 2026-09-11) — roteiro
  mestre, salvo na raiz do repositório. Status de cada etapa frente ao que
  já foi construído:
  - ✅ Etapa 0 (Fundação), 1 (Categorias), 2 (Orçamento/lançamento manual/
    origem), 3 (Extração por IA/regras), 4 (Parcelamento) — concluídas.
  - ✅ Etapa 3.5 (Orçamentos paralelos / ledgers) — não existia neste
    documento original, foi inserida depois entre a 3 e a 4; concluída.
  - 🟡 Multi-Família — inserida antes da Etapa 5 por decisão do usuário
    (também não prevista neste documento original): cadastro/multi-tenant/
    RLS concluídos, LGPD em andamento (ver seção acima).
  - ⬜ Etapa 5 (Divisão de lançamento em N categorias) — não iniciada.
  - ⬜ Etapa 6 (Painéis e relatórios, radar financeiro, sugestão por IA) —
    não iniciada.
  - ⬜ Etapa 7 (Navegação/busca/desfazer via audit_log/exportar-importar
    backup/confiabilidade) — não iniciada. Observação: "desfazer" e
    "exportar backup" se sobrepõem com os itens de LGPD (trilha de
    auditoria, exportar meus dados) — ao chegar nessa etapa, decidir se
    são a mesma implementação ou duas coisas separadas.
  - Depois da Etapa 7: cobrança/planos pagos entra só aí, conforme o
    próprio documento — o que a Multi-Família adiantou (cadastro,
    isolamento) já cobre parte disso mais cedo, por decisão explícita do
    usuário de trazer para antes da Etapa 5.
- `sondar-melhorias-multimodal.md` (2026-09-11) — complemento ao roteiro
  acima, ainda não encaixado por prioridade (decisão do usuário, não
  decidida ainda). Resumo de cada seção, pra não perder de vista:
  1. **Ingestão multimodal** — áudio nunca vira lançamento direto, sempre
     rascunho pendente de confirmação; campos novos por lançamento
     (`origem`, `confianca_valor`, `periodo_coberto`); transcrição de áudio
     no próprio celular antes de mandar pra IA; apelido falado ("mercado")
     tratado como chave própria no dicionário de comerciantes, não
     casamento direto com string de fatura.
  2. **Deduplicação e conciliação** — pessoa sempre confirma fusão de
     lançamentos parecidos; só alerta quando as origens são diferentes;
     print que repete período já importado gera uma pergunta agregada, não
     N perguntas; fatura/extrato é sempre a verdade, áudio é sempre
     estimativa (janela ±3 dias, valor ±20%, mesma forma de pagamento);
     chave determinística de duplicata pra mesma origem estruturada.
  3. **Lacunas de registro (dinheiro/Pix)** — sem reconciliação de saldo de
     carteira (descartado). Aviso de queda de lançamentos manuais numa
     categoria + lembrete de recorrente que sumiu, sempre sem sugerir
     valor. Exige 3 meses do mesmo padrão, dispara 1x/mês agregado, com
     opção obrigatória de silenciar por categoria.
  4. **Custo e volume** — teto de extrações por período por usuário,
     pré-checagem barata antes de chamar a IA (imagem ilegível/sem
     transação é recusada antes de custar), recalcular o teto de preço.
  5. **Revisão em lote** — lista com edição rápida + aplicar regra de
     comerciante direto da tela de revisão.
  6. **Backlog pós-lançamento**: recorrentes automáticos (aluguel/
     assinaturas), saldo previsto até fim do mês, exportação CSV/PDF,
     alerta de estouro de categoria.
  7. **Fora de escopo (decidido)**: sem Open Finance/conexão bancária —
     argumento de venda é controle sobre a descrição do gasto, não
     segurança. "Reset financeiro" adiado (não cancelado) — se entrar,
     precisa de `user_id`/escopo de acesso desde já no schema (retrofit
     depois com dado real é caro).
  Princípio que atravessa tudo: **o sistema nunca decide sozinho em caso de
  dúvida** — incerto vai pra "revisar", nunca é lançado silenciosamente.
  - **Status de implementação ("Etapa Multimodal", sequenciada por
    decisão do usuário em 2026-09):**
    1. ✅ Fundação de dados (schema: `amount_confidence`,
       `ai_extraction_logs.ledger_id`/`period_start`/`period_end`,
       `merchant_rules.rule_type`) — `db/008_multimodal_foundation.sql`.
    2. ✅ Áudio como rascunho — botão "🎤 Falar" (só mobile), dita no
       teclado, sempre passa pela revisão normal antes de salvar.
    3. ✅ Apelido falado no dicionário — `rule_type` isola apelido falado
       de padrão de fatura (nunca colidem), invisível na UI (continua
       "Salvar regra" pros dois casos, por decisão do usuário).
    4. ✅ Custo e volume — teto de 300 extrações/mês por household
       (`src/lib/ai/limits.ts`, checado em `/api/ai/extract` antes de
       qualquer chamada de IA); pré-checagem barata com Haiku
       (`precheckImage` em `src/lib/ai/extract.ts`) recusa imagem
       ilegível ou sem lançamento antes de rodar a extração cara (Opus).
    5. ⬜ Deduplicação e conciliação real — não iniciada.
    6. ⬜ Lacunas de registro (dinheiro/Pix) — não iniciada.
    7. ⬜ Revisão em lote — não iniciada.

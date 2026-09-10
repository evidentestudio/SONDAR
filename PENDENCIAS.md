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

- Termo de consentimento com registro de aceite (usuário + versão + data).
- Política de privacidade — texto jurídico precisa de revisão de advogado;
  o conteúdo técnico (quem processa o dado: Vercel, Neon, Anthropic) já
  está mapeado nesta conversa.
- Exportar meus dados / excluir minha conta (direitos do titular).
- Trilha de auditoria — a tabela `audit_log` já existe no schema desde a
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

## Roteiro

- Multi-Família entra **antes** da Etapa 5 (decisão já tomada).
- `sondar-etapas-implementacao.md` ainda precisa ser reenviado pra
  confirmar o escopo exato da Etapa 5 em diante.

# Sondar — Etapas de implementação (projeto único, entrega faseada)

> Substitui o `sondar-mvp-scope.md` anterior. Diferença importante: isto **não é** um MVP com escopo reduzido — é o sistema completo (ver `sondar-checklist-final.md`) entregue em etapas **só para permitir teste e conferência a cada passo**, não porque alguma etapa "vale menos" que outra. Nenhuma etapa é opcional; a ordem existe pra pegar problema cedo, não pra cortar recurso.

## Regra de avanço entre etapas

Nenhuma etapa começa antes da anterior passar nos dois testes: **automatizado** (Claude Code roda e confirma) e **manual** (você usa de verdade e confirma). Se uma etapa falhar no teste manual, ela é corrigida ali mesmo — não se acumula dívida pra frente.

---

## Etapa 0 — Fundação

**Entrega:** Next.js + Postgres conectado, schema (`sondar_schema.sql`) aplicado por completo (todas as tabelas, incluindo as que só serão usadas em etapas futuras — o banco nasce inteiro, só a interface é que vem por partes), autenticação básica pra você e sua esposa (household compartilhado).

- Teste automatizado: banco conecta, todas as tabelas do schema existem, app sobe sem erro, login funciona.
- Teste seu: você consegue entrar no sistema e ver uma tela vazia (sem erro).

## Etapa 1 — Categorias e subcategorias

**Entrega:** CRUD completo de categorias e subcategorias — criação com detecção de nome duplicado (fusão), exclusão com pergunta sobre o que fazer com lançamentos existentes (categoria **e** subcategoria, os dois níveis), menu hierárquico expansível, ordem alfabética, campo de cor por categoria, criação de reservas (qualquer nome, cor escolhida pelo usuário), categoria "Aguardando Revisão" criada automaticamente no onboarding.

- Teste automatizado: normalização de nome impede duplicata por maiúscula/acento; fusão de nome idêntico funciona; nenhuma reserva é pré-criada exceto "Aguardando Revisão".
- Teste seu: criar/excluir categoria e subcategoria de verdade, tentar duplicar de propósito, criar uma reserva com nome e cor à sua escolha.

## Etapa 2 — Orçamento, lançamento manual e origem de gastos

**Entrega:** orçado por categoria/mês, "copiar orçamento do mês anterior", "planejar próximo mês", lançamento manual de despesa e crédito, tabela categoria × gasto (incluindo a linha "sem subcategoria"), CRUD de origens de gastos (cartão, pix, poupança etc., livre) associável a qualquer lançamento, filtro e totais por origem, campo de notas separado.

- Teste automatizado: soma de categoria com subcategoria bate, incluindo lançamento órfão; total por origem bate com a soma manual.
- Teste seu: lançar valores manuais, conferir totais, testar filtro por origem, usar o campo de notas.

## Etapa 3 — Extração por IA e regras de categorização

**Entrega:** processamento de fatura por imagem e por texto colado, tela de revisão antes de salvar (com badges de "revisar categoria" e "possível duplicidade"), regras de estabelecimento editáveis com correspondência tolerante a grafia, lista de termos ambíguos, botão de salvar regra na revisão, aviso de categoria inexistente.

- Teste automatizado: casos de teste conhecidos (faturas de exemplo já usadas no protótipo) não geram mês nem categoria inventados.
- Teste seu: subir uma fatura real, conferir a extração ponta a ponta.

## Etapa 4 — Parcelamento e origem por parcelamento

**Entrega:** reconhecimento automático de compra parcelada via IA, criação manual, avanço automático mês a mês, cálculo de parcela correto (busca plano existente antes de assumir 1ª parcela — nunca chuta às cegas), lista de planos ativos com exclusão, origem de gasto aplicada ao parcelamento (cartão vs carnê vs pix), filtro de parcelamento por origem.

- Teste automatizado: cálculo de mês da parcela certo, inclusive virada de ano; plano existente é reconhecido e reaproveitado corretamente.
- Teste seu: criar um parcelamento (via fatura e manual), conferir se avança sozinho no mês seguinte.

## Etapa 5 — Divisão de lançamento

**Entrega:** dividir lançamento salvo em N categorias (não só 2), com "+ mais uma parte" e remover parte; dividir também na tela de revisão, antes de salvar (recurso que nunca existiu no protótipo — construir certo desde o início aqui).

- Teste automatizado: soma das partes precisa bater com o valor original, nas duas telas (revisão e lançamento salvo).
- Teste seu: dividir um lançamento de cada jeito, testar remover uma parte no meio.

## Etapa 6 — Painéis e relatórios

**Entrega:** painel compartilhável (categoria × gasto/meta/restante/%/status), radar financeiro, sugestão gerada por IA com base nos números reais, segundo painel "economizável", toggle de abrir/recolher, clicar em categoria dentro do painel mostra lançamentos individuais com valor.

- Teste automatizado: painel não inventa número fora do que está no banco; toggle não rechama a IA desnecessariamente.
- Teste seu: gerar os dois painéis com dados reais, conferir se o texto da sugestão faz sentido.

## Etapa 7 — Navegação, busca e confiabilidade

**Entrega:** abas "Mês"/"Categorias", janela de lançamentos em destaque, busca por descrição, botão de excluir direto na tabela principal, desfazer via soft delete + log de auditoria, exportar/importar backup (como funcionalidade de portabilidade, não rede de segurança), seletor de mês agrupado por ano, botões com área de toque mobile adequada.

- Teste automatizado: qualquer exclusão é reversível via log; exportação reimportada reproduz o estado exato.
- Teste seu: uso normal por 1-2 semanas antes de considerar o sistema pronto pra virar seu controle financeiro principal.

---

## Depois da Etapa 7

Só depois de tudo acima validado é que entra qualquer conversa de comercialização (autenticação multiusuário de verdade, planos pagos, integração de pagamento) — isso fica fora deste plano de propósito, como já alinhamos na conversa sobre o Manus pulando pra Kiwify cedo demais.

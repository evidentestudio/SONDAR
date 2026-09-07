/**
 * Ported verbatim from sondar-full-build-instructions.md section 4 — this
 * prompt went through several rounds of real bug fixes (invented month,
 * invented installment number) and the instructions say to use it as-is,
 * only swapping in the household's real category list and merchant rules.
 * Do not "clean up" the wording — every sentence here is pinned to a
 * specific failure mode it was written to prevent.
 */
export function buildExtractionPrompt(params: {
  leafCategoryNames: string[];
  merchantRules: { pattern: string; category: string }[];
  currentMonth: number; // 1-12
  currentYear: number;
}): string {
  const rulesText = params.merchantRules
    .map((r) => `- se o nome contiver "${r.pattern}" → categoria "${r.category}"`)
    .join("\n");

  return `Você vai extrair lançamentos de uma fatura de cartão de crédito brasileira (a partir da imagem ou texto fornecido).

Para cada lançamento, retorne: data (formato YYYY-MM-DD). Regra crítica sobre a data: a imagem geralmente só mostra o DIA do mês (ex: "12", "18", "19") sem repetir o mês/ano em cada linha — nesses casos, use o mês e ano ATUAIS (mês ${params.currentMonth}, ano ${params.currentYear}) combinados com o dia mostrado. NUNCA invente ou assuma um mês diferente do atual (como janeiro) só porque o mês não está explícito na linha — isso é um erro grave. Só use um mês diferente do atual se houver uma indicação CLARA e explícita na imagem de outro mês/ano (ex: um cabeçalho da fatura mostrando "Fatura de Janeiro/2026", ou uma data completa escrita tipo "18/01/2026"). Descrição (nome do estabelecimento, limpo e legível), valor (número positivo em reais, sem "R$", use ponto decimal), categoria (escolha a mais apropriada dentre exatamente estas opções: ${params.leafCategoryNames.join(", ")}) e revisar (booleano).

Regras de categorização já validadas pelo usuário — aplique sempre que o nome do estabelecimento corresponder, mesmo que outra categoria pareça plausível:
${rulesText}

Compras parceladas: o orçamento mensal NUNCA recebe o valor total da compra parcelada — recebe sempre o valor de uma única parcela. Duas situações possíveis:
(a) A fatura mostra o valor TOTAL da compra junto com o número de parcelas, SEM indicar qual parcela está em andamento (ex: "R$ 289,90 em 12x no crédito", "R$ 740,88 em 12x") → calcule amount = valor total ÷ número de parcelas, e SEMPRE assuma installment_current = 1. Regra crítica: a frase "em Nx" ou "em Nx no crédito" NUNCA informa qual parcela está em andamento — ela só informa o total de parcelas. Você NUNCA deve inventar um número de parcela atual (como "8/12") quando a fatura só mostra "em 12x"; isso é uma invenção proibida. Exemplo correto: "R$ 289,90 em 12x no crédito" → amount = 24.16, installment_current = 1, installment_total = 12, descrição com "(1/12)".
(b) A fatura mostra explicitamente uma fração no formato "x/y" (ex: "3/12", "8 de 12") ao lado do valor → esse valor já é o da parcela específica indicada; use installment_current = x, installment_total = y, e use o valor exibido diretamente como amount, SEM dividir de novo.
Resumindo: só use um installment_current diferente de 1 quando a fatura mostrar explicitamente esse número no formato fração (x/y). Qualquer outra situação (só "em Nx", "em Nx no crédito", sem fração visível) é sempre installment_current = 1.
Em ambos os casos, registre o indicador de parcela na descrição, ex: "Hotmart Acel*acelerape (1/12)". Além disso, quando identificar uma compra parcelada, inclua também os campos "installment_current" e "installment_total" no JSON. Para lançamentos que não são parcelados, omita esses dois campos ou deixe null.

Marque "revisar": true sempre que o nome do estabelecimento não deixar claro o tipo de gasto e a categoria escolhida for um palpite (ex: nomes genéricos, siglas, maquininhas de pagamento tipo "STONE", "PAG*", holdings, pessoas físicas não reconhecidas, restaurantes/cafés genéricos sem contexto). Nesses casos escolha a categoria mais provável mesmo assim, mas marque revisar true. Só marque revisar false quando a categoria for razoavelmente óbvia ou coberta pelas regras acima.

Ignore linhas que não são lançamentos individuais (total da fatura, limite, encargos gerais, etc), a menos que sejam claramente uma cobrança específica.
Ignore completamente qualquer lançamento que apareça com o texto riscado (tachado/strikethrough) na imagem — isso indica que a compra foi cancelada ou estornada, e não deve entrar na lista de lançamentos de forma alguma.
Responda APENAS com um array JSON válido, sem markdown, sem texto antes ou depois, neste formato exato:
[{"date":"2026-08-05","description":"Nome do estabelecimento","amount":123.45,"category":"Categoria","revisar":false,"installment_current":null,"installment_total":null}]`;
}

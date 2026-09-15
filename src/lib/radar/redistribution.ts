import { formatBRL } from "@/lib/format";

/**
 * Redistribuição de orçados (Radar Financeiro — sondar-etapas-implementacao.md
 * Etapa 6). Puro e sem banco de propósito: mexer em dinheiro é aritmética
 * exata, então essa conta nunca passa pela IA generativa (que fica só com o
 * diagnóstico/dicas em texto, na service.ts irmã) — decisão explícita, pra
 * nunca arriscar um valor "alucinado" numa redistribuição de orçamento real.
 */

export type CategoryBudgetInput = {
  categoryId: string;
  label: string;
  orcado: number;
  gasto: number;
};

export type RedistributionObjective = "nao_estourar" | "economizar";

export type RedistributionItem = {
  categoryId: string;
  label: string;
  oldOrcado: number;
  newOrcado: number;
};

export type RedistributionPlan =
  | { status: "ok"; items: RedistributionItem[]; totalBefore: number; totalAfter: number }
  | { status: "infeasible"; message: string; maxFeasible: number };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * "Não estourar a meta": fecha o estouro (gasto > orçado) das categorias
 * selecionadas tirando folga (orçado > gasto) de outras categorias
 * selecionadas, proporcional à folga de cada uma — a soma orçada do grupo
 * nunca muda, só é redistribuída. Sem folga suficiente no grupo escolhido,
 * a meta é irrealista e nada é alterado (a pessoa decide se inclui mais
 * categorias ou aceita o estouro parcial).
 */
function planNaoEstourar(categories: CategoryBudgetInput[]): RedistributionPlan {
  const totalBefore = round2(categories.reduce((s, c) => s + c.orcado, 0));

  const deficits = categories.filter((c) => c.gasto > c.orcado);
  const totalDeficit = deficits.reduce((s, c) => s + (c.gasto - c.orcado), 0);
  if (totalDeficit <= 0) {
    return { status: "ok", items: [], totalBefore, totalAfter: totalBefore };
  }

  const slacks = categories.filter((c) => c.orcado > c.gasto);
  const totalSlack = slacks.reduce((s, c) => s + (c.orcado - c.gasto), 0);
  if (totalSlack < totalDeficit) {
    return {
      status: "infeasible",
      message: `Não é possível cobrir todo o estouro só com as categorias selecionadas — falta ${formatBRL(
        totalDeficit - totalSlack,
      )} de folga. Selecione mais categorias com espaço sobrando, ou aceite manter parte do estouro.`,
      maxFeasible: round2(totalSlack),
    };
  }

  const items: RedistributionItem[] = [];
  for (const c of deficits) {
    items.push({ categoryId: c.categoryId, label: c.label, oldOrcado: c.orcado, newOrcado: round2(c.gasto) });
  }
  for (const c of slacks) {
    const slack = c.orcado - c.gasto;
    const cut = slack * (totalDeficit / totalSlack);
    items.push({ categoryId: c.categoryId, label: c.label, oldOrcado: c.orcado, newOrcado: round2(c.orcado - cut) });
  }
  return { status: "ok", items, totalBefore, totalAfter: totalBefore };
}

/**
 * "Economizar R$X" (base: total orçado atual do mês, confirmado pelo
 * usuário) — reduz o orçado das categorias selecionadas em X no total,
 * proporcional à folga (orçado - gasto) de cada uma. Nunca corta um orçado
 * abaixo do que já foi gasto neste mês (isso criaria um estouro instantâneo,
 * o oposto do objetivo). Meta maior que a folga disponível é irrealista.
 */
function planEconomizar(categories: CategoryBudgetInput[], targetAmount: number): RedistributionPlan {
  const totalBefore = round2(categories.reduce((s, c) => s + c.orcado, 0));

  const cuttable = categories.filter((c) => c.orcado > c.gasto);
  const totalCuttable = cuttable.reduce((s, c) => s + (c.orcado - c.gasto), 0);

  if (targetAmount > totalCuttable) {
    return {
      status: "infeasible",
      message: `Meta de economizar ${formatBRL(targetAmount)} não é viável com essas categorias — a folga máxima disponível nelas é ${formatBRL(
        totalCuttable,
      )}. Selecione mais categorias ou reduza a meta.`,
      maxFeasible: round2(totalCuttable),
    };
  }

  const items: RedistributionItem[] = cuttable.map((c) => {
    const slack = c.orcado - c.gasto;
    const cut = totalCuttable > 0 ? slack * (targetAmount / totalCuttable) : 0;
    return { categoryId: c.categoryId, label: c.label, oldOrcado: c.orcado, newOrcado: round2(c.orcado - cut) };
  });
  return { status: "ok", items, totalBefore, totalAfter: round2(totalBefore - targetAmount) };
}

export function planRedistribution(
  categories: CategoryBudgetInput[],
  objective: RedistributionObjective,
  targetAmount: number | null,
): RedistributionPlan {
  if (objective === "economizar") {
    if (!targetAmount || !Number.isFinite(targetAmount) || targetAmount <= 0) {
      return {
        status: "infeasible",
        message: "Informe um valor de economia maior que zero.",
        maxFeasible: 0,
      };
    }
    return planEconomizar(categories, targetAmount);
  }
  return planNaoEstourar(categories);
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { resolveLedgerId } from "@/lib/ledgers/service";
import { getCategoryMonthSummary } from "@/lib/budget-summary/service";
import { applyBudgetRedistribution } from "@/lib/budgets/service";
import { flattenLeafBudgets } from "@/lib/radar/service";
import { planRedistribution, type RedistributionObjective } from "@/lib/radar/redistribution";
import { isValidMonthKey } from "@/lib/date";

/**
 * Calcula (e, se `apply`, também aplica) a redistribuição de orçados do
 * Radar Financeiro. Orçado/gasto de cada categoria são sempre relidos do
 * banco aqui — nunca confiados do que o cliente mandou — pra planRedistribution
 * (aritmética pura, sem IA) nunca rodar em cima de um número que a pessoa
 * poderia ter adulterado ou que já ficou desatualizado na tela.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }
  const objective: RedistributionObjective = body?.objective === "economizar" ? "economizar" : "nao_estourar";
  const targetAmount = typeof body?.targetAmount === "number" ? body.targetAmount : null;
  const categoryIds: string[] = Array.isArray(body?.categoryIds)
    ? body.categoryIds.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const apply = body?.apply === true;

  if (categoryIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma categoria." }, { status: 400 });
  }

  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);
  const summary = await getCategoryMonthSummary(session.householdId, ledgerId, month);
  const allLeaves = flattenLeafBudgets(summary);

  const selected = allLeaves.filter((c) => categoryIds.includes(c.categoryId));
  if (selected.length !== categoryIds.length) {
    return NextResponse.json(
      { error: "Uma ou mais categorias selecionadas não existem mais neste orçamento." },
      { status: 400 },
    );
  }

  const plan = planRedistribution(selected, objective, targetAmount);

  if (plan.status === "infeasible") {
    return NextResponse.json({ plan });
  }

  if (apply && plan.items.length > 0) {
    await applyBudgetRedistribution(
      session.householdId,
      month,
      plan.items.map((i) => ({ categoryId: i.categoryId, amount: i.newOrcado })),
    );
  }

  return NextResponse.json({ plan, applied: apply });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { resolveLedgerId } from "@/lib/ledgers/service";
import { getCategoryMonthSummary } from "@/lib/budget-summary/service";
import { formatMonthLabel, isValidMonthKey, previousMonthKey } from "@/lib/date";
import { buildRadarDiagnosis, classifyStatus, flattenLeafBudgets } from "@/lib/radar/service";

const HISTORY_MONTHS = 3;

/**
 * Sempre sob pedido (nunca chamado automaticamente ao abrir o Painel) — a
 * própria tela chama esta rota só quando a pessoa clica em "Gerar
 * diagnóstico", decisão explícita do usuário pra manter o custo de IA sob
 * controle sem precisar de um teto adicional.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }
  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);

  const currentSummary = await getCategoryMonthSummary(session.householdId, ledgerId, month);
  const current = flattenLeafBudgets(currentSummary);

  if (current.length === 0) {
    return NextResponse.json({
      diagnosis: "Nenhuma categoria com orçamento definido neste mês ainda — defina os orçados pra receber um diagnóstico.",
      tips: [],
      patterns: [],
      categories: [],
    });
  }

  const historyMonths: string[] = [];
  let cursor = month;
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    cursor = previousMonthKey(cursor);
    historyMonths.push(cursor);
  }
  const historyFlats = await Promise.all(
    historyMonths.map(async (m) => flattenLeafBudgets(await getCategoryMonthSummary(session.householdId, ledgerId, m))),
  );

  const categories = current.map((c) => ({
    ...c,
    status: classifyStatus(c.gasto, c.orcado),
    historicoGasto: [...historyMonths]
      .map((m, idx) => ({ mes: m, gasto: historyFlats[idx].find((h) => h.categoryId === c.categoryId)?.gasto ?? 0 }))
      .reverse(),
  }));

  try {
    const result = await buildRadarDiagnosis(categories, formatMonthLabel(month));
    return NextResponse.json({ ...result, categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível gerar o diagnóstico." },
      { status: 502 },
    );
  }
}

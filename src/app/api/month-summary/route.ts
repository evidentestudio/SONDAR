import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import {
  getCategoryMonthSummary,
  getMonthTotals,
  getPaymentSourceTotals,
} from "@/lib/budget-summary/service";
import { listLedgers, resolveLedgerId } from "@/lib/ledgers/service";
import { isValidMonthKey, currentMonthKey } from "@/lib/date";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? currentMonthKey();
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  // "Visão combinada" (vários orçamentos de uma vez) — pedido do usuário pra
  // conseguir ver, por exemplo, quanto gastou de Cartão somando vários
  // orçamentos. Categorias/orçados ficam de fora de propósito: cada ledger
  // tem sua própria árvore de categorias independente, sem forma correta de
  // somar automaticamente uma com a outra.
  const ledgerIdsParam = searchParams.get("ledgerIds");
  if (ledgerIdsParam) {
    const requested = ledgerIdsParam.split(",").filter(Boolean);
    const ledgers = await listLedgers(session.householdId);
    const validIds = requested.filter((id) => ledgers.some((l) => l.id === id));
    if (validIds.length === 0) {
      return NextResponse.json({ error: "Nenhum orçamento válido selecionado." }, { status: 400 });
    }
    const [totals, paymentSourceTotals] = await Promise.all([
      getMonthTotals(session.householdId, validIds, month),
      getPaymentSourceTotals(session.householdId, validIds, month),
    ]);
    return NextResponse.json({ month, ledgerIds: validIds, categories: [], totals, paymentSourceTotals });
  }

  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const [categories, totals, paymentSourceTotals] = await Promise.all([
    getCategoryMonthSummary(session.householdId, ledgerId, month),
    getMonthTotals(session.householdId, ledgerId, month),
    getPaymentSourceTotals(session.householdId, ledgerId, month),
  ]);

  return NextResponse.json({ month, ledgerId, categories, totals, paymentSourceTotals });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import {
  getCategoryMonthSummary,
  getMonthTotals,
  getPaymentSourceTotals,
} from "@/lib/budget-summary/service";
import { resolveLedgerId } from "@/lib/ledgers/service";
import { isValidMonthKey, currentMonthKey } from "@/lib/date";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? currentMonthKey();
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const [categories, totals, paymentSourceTotals] = await Promise.all([
    getCategoryMonthSummary(session.householdId, ledgerId, month),
    getMonthTotals(session.householdId, ledgerId, month),
    getPaymentSourceTotals(session.householdId, ledgerId, month),
  ]);

  return NextResponse.json({ month, ledgerId, categories, totals, paymentSourceTotals });
}

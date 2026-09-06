import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import {
  getCategoryMonthSummary,
  getMonthTotals,
  getPaymentSourceTotals,
} from "@/lib/budget-summary/service";
import { isValidMonthKey, currentMonthKey } from "@/lib/date";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? currentMonthKey();
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  const [categories, totals, paymentSourceTotals] = await Promise.all([
    getCategoryMonthSummary(session.householdId, month),
    getMonthTotals(session.householdId, month),
    getPaymentSourceTotals(session.householdId, month),
  ]);

  return NextResponse.json({ month, categories, totals, paymentSourceTotals });
}

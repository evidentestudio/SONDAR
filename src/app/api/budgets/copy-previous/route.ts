import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { copyBudgetsFromPreviousMonth } from "@/lib/budgets/service";
import { resolveLedgerId } from "@/lib/ledgers/service";
import { isValidMonthKey } from "@/lib/date";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const month = typeof body?.month === "string" ? body.month : "";
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);
  const result = await copyBudgetsFromPreviousMonth(session.householdId, ledgerId, month);
  return NextResponse.json(result);
}

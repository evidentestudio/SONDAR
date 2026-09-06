import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { setBudget } from "@/lib/budgets/service";
import { isValidMonthKey } from "@/lib/date";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  const month = typeof body?.month === "string" ? body.month : "";
  const amount = Number(body?.amount);

  if (!categoryId || !isValidMonthKey(month)) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const result = await setBudget(session.householdId, categoryId, month, amount);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ budget: result.budget });
}

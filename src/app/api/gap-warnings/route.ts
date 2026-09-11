import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { findGapWarnings } from "@/lib/gap-warnings/service";
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
  const warnings = await findGapWarnings(session.householdId, ledgerId, month);
  return NextResponse.json({ warnings });
}

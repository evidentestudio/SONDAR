import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { advanceInstallmentsForMonth } from "@/lib/installment-plans/service";
import { currentMonthKey, isValidMonthKey, nextMonthKey } from "@/lib/date";

/**
 * Session-authenticated twin of /api/cron/advance-installments, for testing
 * the monthly advance without waiting for the actual 1st of the month —
 * calls the exact same function the cron calls, so it's a faithful test of
 * what will happen automatically. Defaults to next month since the current
 * month's installments were already created when each plan was saved.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const month = typeof body?.month === "string" && isValidMonthKey(body.month)
    ? body.month
    : nextMonthKey(currentMonthKey());

  const result = await advanceInstallmentsForMonth(month);
  return NextResponse.json({ month, ...result });
}

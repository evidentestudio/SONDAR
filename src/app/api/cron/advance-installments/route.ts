import { NextResponse } from "next/server";
import { advanceInstallmentsForMonth } from "@/lib/installment-plans/service";
import { currentMonthKey } from "@/lib/date";

/**
 * Vercel Cron calls this once a month (see vercel.json) with
 * `Authorization: Bearer ${CRON_SECRET}` — the standard pattern Vercel
 * documents for protecting cron routes, since they'd otherwise be a public
 * unauthenticated endpoint that mints financial entries. No CRON_SECRET set
 * means the route refuses every request rather than running unprotected.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const month = currentMonthKey();
  const result = await advanceInstallmentsForMonth(month);
  return NextResponse.json({ month, ...result });
}

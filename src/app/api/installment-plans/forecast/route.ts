import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { getInstallmentForecastGrid } from "@/lib/installment-plans/service";
import { resolveLedgerId } from "@/lib/ledgers/service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const paymentSourceId = searchParams.get("paymentSourceId") || undefined;

  const grid = await getInstallmentForecastGrid(session.householdId, ledgerId, { paymentSourceId });
  return NextResponse.json(grid);
}

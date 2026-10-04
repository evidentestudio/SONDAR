import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { getInstallmentForecastGrid } from "@/lib/installment-plans/service";
import { listLedgers, resolveLedgerId } from "@/lib/ledgers/service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const paymentSourceId = searchParams.get("paymentSourceId") || undefined;

  const ledgerIdsParam = searchParams.get("ledgerIds");
  if (ledgerIdsParam) {
    const requested = ledgerIdsParam.split(",").filter(Boolean);
    const ledgers = await listLedgers(session.householdId);
    const validIds = requested.filter((id) => ledgers.some((l) => l.id === id));
    if (validIds.length === 0) {
      return NextResponse.json({ error: "Nenhum orçamento válido selecionado." }, { status: 400 });
    }
    const grid = await getInstallmentForecastGrid(session.householdId, validIds, { paymentSourceId });
    return NextResponse.json(grid);
  }

  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const grid = await getInstallmentForecastGrid(session.householdId, ledgerId, { paymentSourceId });
  return NextResponse.json(grid);
}

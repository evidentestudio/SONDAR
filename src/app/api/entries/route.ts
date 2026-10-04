import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createEntry, listEntries } from "@/lib/entries/service";
import { listLedgers, resolveLedgerId } from "@/lib/ledgers/service";
import { isValidMonthKey, currentMonthKey } from "@/lib/date";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? currentMonthKey();
  const paymentSourceId = searchParams.get("paymentSourceId") ?? undefined;

  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  // Filtro "Orçamentos" em Lançamentos: cada lançamento já carrega seu
  // próprio ledger_id, então combinar vários orçamentos numa lista só é
  // seguro e mostra de qual orçamento cada lançamento é. Checado por
  // presença do parâmetro (não truthiness) pra "ledgerIds=" (vazio, todos
  // os orçamentos desmarcados) cair aqui também, em vez de silenciosamente
  // voltar pro orçamento padrão.
  const ledgerIdsParam = searchParams.get("ledgerIds");
  if (searchParams.has("ledgerIds")) {
    const requested = (ledgerIdsParam ?? "").split(",").filter(Boolean);
    const ledgers = await listLedgers(session.householdId);
    const validIds = requested.filter((id) => ledgers.some((l) => l.id === id));
    if (validIds.length === 0) {
      return NextResponse.json({ entries: [] });
    }
    const entries = await listEntries(session.householdId, validIds, month, { paymentSourceId });
    return NextResponse.json({ entries });
  }

  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const entries = await listEntries(session.householdId, ledgerId, month, { paymentSourceId });
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryType = body?.entryType === "income" ? "income" : "expense";
  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);

  const result = await createEntry(session.householdId, {
    ledgerId,
    entryType,
    entryDate: typeof body?.entryDate === "string" ? body.entryDate : "",
    description: typeof body?.description === "string" ? body.description : "",
    amount: Number(body?.amount),
    categoryId: typeof body?.categoryId === "string" ? body.categoryId : null,
    paymentSourceId: typeof body?.paymentSourceId === "string" ? body.paymentSourceId : null,
    createdBy: session.userId,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ entry: result.entry }, { status: 201 });
}

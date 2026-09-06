import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createEntry, listEntries } from "@/lib/entries/service";
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

  const entries = await listEntries(session.householdId, month, { paymentSourceId });
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryType = body?.entryType === "income" ? "income" : "expense";

  const result = await createEntry(session.householdId, {
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

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createLedger, listLedgers } from "@/lib/ledgers/service";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const ledgers = await listLedgers(session.householdId);
  return NextResponse.json({ ledgers });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ error: "Nome não pode ser vazio." }, { status: 400 });
  }

  const result = await createLedger(session.householdId, { name });
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ledger: result.ledger }, { status: 201 });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { dismissDuplicatePair } from "@/lib/entries/service";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryIdA = typeof body?.entryIdA === "string" ? body.entryIdA : "";
  const entryIdB = typeof body?.entryIdB === "string" ? body.entryIdB : "";
  if (!entryIdA || !entryIdB) {
    return NextResponse.json({ error: "Par de lançamentos inválido." }, { status: 400 });
  }

  await dismissDuplicatePair(session.householdId, entryIdA, entryIdB);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createPaymentSource, listPaymentSources } from "@/lib/payment-sources/service";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const sources = await listPaymentSources(session.householdId);
  return NextResponse.json({ sources });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";

  const result = await createPaymentSource(session.householdId, {
    name,
    color: typeof body?.color === "string" ? body.color : null,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ source: result.source }, { status: 201 });
}

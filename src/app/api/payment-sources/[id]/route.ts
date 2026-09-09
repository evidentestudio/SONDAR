import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deletePaymentSource, setDefaultPaymentSource, updatePaymentSource } from "@/lib/payment-sources/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (body?.isDefault === true) {
    await setDefaultPaymentSource(session.householdId, id);
    return NextResponse.json({ ok: true });
  }

  const input: { name?: string; color?: string | null } = {};
  if (typeof body?.name === "string") input.name = body.name;
  if ("color" in (body ?? {})) input.color = body.color;

  const result = await updatePaymentSource(session.householdId, id, input);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ source: result.source });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  await deletePaymentSource(session.householdId, id);
  return NextResponse.json({ ok: true });
}

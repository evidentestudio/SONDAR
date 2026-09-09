import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deleteEntry, updateEntry } from "@/lib/entries/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const input: {
    description?: string;
    amount?: number;
    entryDate?: string;
    categoryId?: string | null;
    paymentSourceId?: string | null;
    ledgerId?: string;
  } = {};
  if (typeof body?.description === "string") input.description = body.description;
  if (body?.amount !== undefined) input.amount = Number(body.amount);
  if (typeof body?.entryDate === "string") input.entryDate = body.entryDate;
  if ("categoryId" in (body ?? {})) input.categoryId = body.categoryId;
  if ("paymentSourceId" in (body ?? {})) input.paymentSourceId = body.paymentSourceId;
  if (typeof body?.ledgerId === "string") input.ledgerId = body.ledgerId;

  const result = await updateEntry(session.householdId, id, input);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  await deleteEntry(session.householdId, id);
  return NextResponse.json({ ok: true });
}

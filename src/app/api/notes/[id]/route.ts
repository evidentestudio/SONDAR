import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deleteNote, setNoteDone } from "@/lib/notes/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (typeof body?.isDone === "boolean") {
    await setNoteDone(session.householdId, id, body.isDone);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  await deleteNote(session.householdId, id);
  return NextResponse.json({ ok: true });
}

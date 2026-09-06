import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createNote, listNotes } from "@/lib/notes/service";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const notes = await listNotes(session.householdId);
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content : "";

  const note = await createNote(session.householdId, content, session.userId);
  if (!note) return NextResponse.json({ error: "Conteúdo não pode ser vazio." }, { status: 400 });

  return NextResponse.json({ note }, { status: 201 });
}

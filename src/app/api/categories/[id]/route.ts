import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deleteCategory, updateCategory } from "@/lib/categories/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const input: { name?: string; color?: string | null; icon?: string | null } = {};
  if (typeof body?.name === "string") input.name = body.name;
  if ("color" in (body ?? {})) input.color = body.color;
  if ("icon" in (body ?? {})) input.icon = body.icon;

  const result = await updateCategory(session.householdId, id, input);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ category: result.category });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const onEntries = body?.onEntries === "move" || body?.onEntries === "delete" ? body.onEntries : undefined;
  const moveToCategoryId = typeof body?.moveToCategoryId === "string" ? body.moveToCategoryId : undefined;

  const result = await deleteCategory(session.householdId, id, { onEntries, moveToCategoryId });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  if (result.status === "needs_decision") {
    return NextResponse.json(
      {
        needsDecision: true,
        entryCount: result.entryCount,
        message: `Essa categoria tem ${result.entryCount} lançamento(s). Escolha mover para outra categoria ou excluir junto.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}

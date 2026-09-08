import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createCategory, getCategoryTree } from "@/lib/categories/service";
import { resolveLedgerId } from "@/lib/ledgers/service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));

  const tree = await getCategoryTree(session.householdId, ledgerId);
  return NextResponse.json({ categories: tree });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ error: "Nome não pode ser vazio." }, { status: 400 });
  }

  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);
  const result = await createCategory(session.householdId, ledgerId, {
    name,
    parentId: typeof body?.parentId === "string" ? body.parentId : null,
    categoryType: body?.categoryType === "reserve" ? "reserve" : "normal",
    color: typeof body?.color === "string" ? body.color : null,
    icon: typeof body?.icon === "string" ? body.icon : null,
    confirmMerge: body?.confirmMerge === true,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  if (result.status === "collision") {
    return NextResponse.json(
      {
        collision: true,
        existing: result.existing,
        message: `Já existe uma categoria chamada "${result.existing.name}". Confirmar transforma ela em subcategoria aqui, mantendo os lançamentos que já tiver.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ category: result.category, merged: result.status === "merged" }, { status: 201 });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { splitEntry } from "@/lib/entries/service";
import type { SplitPart } from "@/lib/entries/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const rawParts = Array.isArray(body?.parts) ? body.parts : [];

  const parts: SplitPart[] = rawParts.map((p: unknown) => {
    const part = p as { categoryId?: unknown; amount?: unknown };
    return {
      categoryId: typeof part.categoryId === "string" && part.categoryId ? part.categoryId : null,
      amount: Number(part.amount),
    };
  });

  const result = await splitEntry(session.householdId, id, parts);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ entryIds: result.entryIds });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deleteMerchantRule, updateMerchantRule } from "@/lib/merchant-rules/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const input: { pattern?: string; categoryId?: string; isAmbiguous?: boolean } = {};
  if (typeof body?.pattern === "string") input.pattern = body.pattern;
  if (typeof body?.categoryId === "string") input.categoryId = body.categoryId;
  if (typeof body?.isAmbiguous === "boolean") input.isAmbiguous = body.isAmbiguous;

  const result = await updateMerchantRule(session.householdId, id, input);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ rule: result.rule });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  await deleteMerchantRule(session.householdId, id);
  return NextResponse.json({ ok: true });
}

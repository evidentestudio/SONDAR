import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createMerchantRule, listMerchantRules } from "@/lib/merchant-rules/service";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const rules = await listMerchantRules(session.householdId);
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const pattern = typeof body?.pattern === "string" ? body.pattern : "";
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  if (!pattern.trim() || !categoryId) {
    return NextResponse.json({ error: "Padrão e categoria são obrigatórios." }, { status: 400 });
  }

  const result = await createMerchantRule(session.householdId, {
    pattern,
    categoryId,
    isAmbiguous: body?.isAmbiguous === true,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ rule: result.rule }, { status: 201 });
}

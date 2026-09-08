import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { stopInstallmentPlan } from "@/lib/installment-plans/service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const result = await stopInstallmentPlan(session.householdId, id);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

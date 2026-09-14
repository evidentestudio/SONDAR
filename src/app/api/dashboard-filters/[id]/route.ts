import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { deleteDashboardFilter } from "@/lib/dashboard-filters/service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  await deleteDashboardFilter(session.householdId, id);
  return NextResponse.json({ ok: true });
}

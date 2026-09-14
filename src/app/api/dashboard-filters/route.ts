import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createDashboardFilter, listDashboardFilters } from "@/lib/dashboard-filters/service";
import { resolveLedgerId } from "@/lib/ledgers/service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));

  const filters = await listDashboardFilters(session.householdId, ledgerId);
  return NextResponse.json({ filters });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const categoryIds = Array.isArray(body?.categoryIds)
    ? body.categoryIds.filter((c: unknown): c is string => typeof c === "string")
    : [];

  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);
  const result = await createDashboardFilter(session.householdId, ledgerId, { name, categoryIds });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ filter: result.filter }, { status: 201 });
}

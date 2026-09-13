import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { listEntriesForReview } from "@/lib/entries/service";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const entries = await listEntriesForReview(session.householdId);
  return NextResponse.json({ entries });
}

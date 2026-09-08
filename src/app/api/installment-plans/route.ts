import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createInstallmentPlan, listInstallmentPlans } from "@/lib/installment-plans/service";
import { resolveLedgerId } from "@/lib/ledgers/service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ledgerId = await resolveLedgerId(session.householdId, searchParams.get("ledgerId"));
  const plans = await listInstallmentPlans(session.householdId, ledgerId);
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);

  const result = await createInstallmentPlan(session.householdId, {
    ledgerId,
    description: typeof body?.description === "string" ? body.description : "",
    categoryId: typeof body?.categoryId === "string" ? body.categoryId : null,
    paymentSourceId: typeof body?.paymentSourceId === "string" ? body.paymentSourceId : null,
    installmentAmount: Number(body?.installmentAmount),
    totalInstallments: Number(body?.totalInstallments),
    currentInstallmentNumber: Number(body?.currentInstallmentNumber ?? 1),
    currentInstallmentDate: typeof body?.currentInstallmentDate === "string" ? body.currentInstallmentDate : "",
    createdBy: session.userId,
    inputMethod: "manual",
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ plan: result.plan, entryId: result.entryId }, { status: 201 });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createEntry, checkPossibleDuplicate } from "@/lib/entries/service";
import type { InputMethod, AmountConfidence } from "@/lib/entries/service";
import { createInstallmentPlan } from "@/lib/installment-plans/service";
import { resolveLedgerId } from "@/lib/ledgers/service";

type BatchItem = {
  date: string;
  description: string;
  amount: number;
  categoryId: string | null;
  ledgerId?: string | null;
  paymentSourceId?: string | null;
  needsReview: boolean;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  approximate?: boolean;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceType: InputMethod =
    body?.sourceType === "image" ? "ai_image" : body?.sourceType === "audio" ? "ai_audio" : "ai_text";
  const items: BatchItem[] = Array.isArray(body?.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ error: "Nenhum lançamento para salvar." }, { status: 400 });
  }

  let created = 0;
  const errors: { index: number; message: string }[] = [];

  for (const [index, item] of items.entries()) {
    // Each row carries its own orçamento — defaults to "Principal", but the
    // review screen lets the user move any individual row before saving.
    const ledgerId = await resolveLedgerId(session.householdId, item.ledgerId);

    const reviewStatus = item.needsReview
      ? "needs_review"
      : item.categoryId && (await checkPossibleDuplicate(session.householdId, item.categoryId, item.amount, item.date))
        ? "possible_duplicate"
        : "confirmed";

    // Compras parceladas (identificadas pela IA, section 4 do prompt) viram
    // um installment_plans + a entrada da parcela atual, não um lançamento
    // solto — as parcelas seguintes são criadas pelo job mensal.
    const result =
      item.installmentTotal && item.installmentTotal > 1
        ? await createInstallmentPlan(session.householdId, {
            ledgerId,
            description: item.description,
            categoryId: item.categoryId,
            paymentSourceId: item.paymentSourceId ?? null,
            installmentAmount: item.amount,
            totalInstallments: item.installmentTotal,
            currentInstallmentNumber: item.installmentCurrent ?? 1,
            currentInstallmentDate: item.date,
            createdBy: session.userId,
            inputMethod: sourceType,
            reviewStatus,
          }).then((r) => (r.status === "created" ? { status: "created" as const, entry: { id: r.entryId } } : r))
        : await createEntry(session.householdId, {
            ledgerId,
            entryType: "expense",
            entryDate: item.date,
            description: item.description,
            amount: item.amount,
            categoryId: item.categoryId,
            paymentSourceId: item.paymentSourceId ?? null,
            createdBy: session.userId,
            inputMethod: sourceType,
            reviewStatus,
            amountConfidence: (item.approximate ? "approximate" : "exact") as AmountConfidence,
          });

    if (result.status === "error") {
      errors.push({ index, message: result.message });
    } else {
      created += 1;
    }
  }

  return NextResponse.json({ created, errors });
}

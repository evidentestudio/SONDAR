import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { createEntry, checkPossibleDuplicate, findReconciliationCandidate, reconcileEntry } from "@/lib/entries/service";
import type { InputMethod, AmountConfidence, ReviewStatus } from "@/lib/entries/service";
import { validateSplitGroupTotals } from "@/lib/entries/split-validation";
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
  /** true quando a pessoa optou explicitamente por manter os dois
   * lançamentos separados em vez de fundir com um rascunho de áudio
   * pendente (ver review-modal.tsx) — pula a conciliação pra esse item. */
  skipReconciliation?: boolean;
  /** Presente quando a pessoa dividiu esse item em N categorias na tela de
   * revisão, ANTES de salvar (Etapa 5) — uma chave de correlação do
   * cliente (não é o split_group_id real), igual em todas as partes da
   * mesma divisão. Todo item com essa chave vira uma linha própria, todas
   * recebendo o MESMO split_group_id real gerado aqui no servidor. */
  splitGroupKey?: string | null;
  /** Valor original travado no momento em que a divisão começou (o mesmo
   * em toda parte do grupo) — o que validateSplitGroupTotals confere
   * contra a soma real das partes antes de gravar qualquer coisa. */
  splitGroupTotal?: number | null;
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

  // Nunca grava nada de um lote com uma divisão que não fecha — tudo ou
  // nada, em vez de arriscar salvar algumas partes e não outras.
  const splitValidation = validateSplitGroupTotals(items);
  if (!splitValidation.ok) {
    return NextResponse.json({ error: splitValidation.message }, { status: 400 });
  }

  let created = 0;
  const errors: { index: number; message: string }[] = [];
  // Uma divisão em N categorias (Etapa 5) manda N itens com a mesma
  // splitGroupKey (uma chave qualquer do cliente) — todos precisam do MESMO
  // split_group_id real, gerado aqui na primeira vez que a chave aparece.
  const splitGroupIds = new Map<string, string>();

  for (const [index, item] of items.entries()) {
    // Each row carries its own orçamento — defaults to "Principal", but the
    // review screen lets the user move any individual row before saving.
    const ledgerId = await resolveLedgerId(session.householdId, item.ledgerId);

    let reviewStatus: ReviewStatus = item.needsReview
      ? "needs_review"
      : item.categoryId && (await checkPossibleDuplicate(session.householdId, item.categoryId, item.amount, item.date))
        ? "possible_duplicate"
        : "confirmed";

    let splitGroupId: string | null = null;
    if (item.splitGroupKey) {
      splitGroupId = splitGroupIds.get(item.splitGroupKey) ?? crypto.randomUUID();
      splitGroupIds.set(item.splitGroupKey, splitGroupId);
    }

    // Hierarquia de fontes (sondar-melhorias-multimodal.md seção 2.3): a
    // fatura/texto é a verdade, o áudio é estimativa. Refeita aqui contra o
    // estado real do banco no momento de salvar (o preview em pipeline.ts
    // não é vinculante) — parcelamento nunca concilia, a própria pessoa
    // pode ter pedido pra manter os dois lançamentos separados, e uma parte
    // de uma divisão nunca concilia sozinha (o valor já não é mais o total
    // original que um rascunho de áudio poderia reconhecer).
    const isInstallment = !!item.installmentTotal && item.installmentTotal > 1;
    if (sourceType !== "ai_audio" && !isInstallment && !item.skipReconciliation && !splitGroupId) {
      const reconciliation = await findReconciliationCandidate(session.householdId, ledgerId, {
        entryDate: item.date,
        amount: item.amount,
        paymentSourceId: item.paymentSourceId ?? null,
      });
      if (reconciliation.type === "matched") {
        const result = await reconcileEntry(session.householdId, reconciliation.entry.entryId, {
          amount: item.amount,
          entryDate: item.date,
          inputMethod: sourceType,
          reviewStatus,
        });
        if (result.status === "error") errors.push({ index, message: result.message });
        else created += 1;
        continue;
      }
      if (reconciliation.type === "ambiguous") {
        // Mais de um rascunho de áudio parecido — nunca decide sozinho:
        // entra como lançamento novo, mas sinalizado pra revisão manual.
        reviewStatus = "needs_review";
      }
    }

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
            splitGroupId,
          });

    if (result.status === "error") {
      errors.push({ index, message: result.message });
    } else {
      created += 1;
    }
  }

  return NextResponse.json({ created, errors });
}

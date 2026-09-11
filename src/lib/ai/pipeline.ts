import type { RawExtractedItem } from "./extract";
import { findCanonicalCategory, isLeafCategory } from "@/lib/categories/service";
import { findMatchingRule } from "@/lib/merchant-rules/service";
import type { MerchantRuleType } from "@/lib/merchant-rules/service";
import { checkPossibleDuplicate, findReconciliationCandidate } from "@/lib/entries/service";
import { resolvePaymentSourceHint } from "@/lib/payment-sources/service";

export type DraftEntry = {
  date: string;
  description: string;
  amount: number;
  categoryId: string | null;
  categoryName: string;
  needsReview: boolean;
  possibleDuplicate: boolean;
  categoryNotFound: boolean;
  /** Raw category string the AI returned, kept even when resolved/overridden
   * so the UI can show "IA sugeriu 'X', categoria não encontrada" verbatim. */
  aiCategoryGuess: string;
  matchedRuleId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  /** true = valor falado como estimativa (ver AmountConfidence em
   * entries/service.ts). Sempre false pra fatura (imagem/texto). */
  approximate: boolean;
  /** Resolvido a partir de payment_source_hint (só áudio) — null quando não
   * mencionado ou não reconhecido; a pessoa escolhe na revisão nesse caso. */
  paymentSourceId: string | null;
  paymentSourceName: string | null;
  /** Preview da conciliação (sondar-melhorias-multimodal.md seção 2.3) — só
   * calculado pra fatura/texto (nunca pra áudio, que é o lado "estimativa"
   * da hierarquia). Não vinculante: save-batch refaz essa busca contra o
   * estado real do banco no momento de salvar, então isso é só pra a tela
   * de revisão avisar a pessoa do que vai acontecer. */
  reconcileEntryId: string | null;
  reconcileEntryDate: string | null;
  reconcileEntryAmount: number | null;
  /** true quando mais de um rascunho de áudio pendente bate com esse
   * lançamento — ambíguo nunca funde sozinho, vai pra revisão. */
  reconciliationAmbiguous: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the AI's raw JSON into entries ready for the review screen. Never
 * trusts the AI's category string blindly (section 3.2/8 of
 * sondar-full-build-instructions.md: "confiar cegamente na categoria que a
 * IA devolve" is listed as a mistake already made once) — a merchant rule,
 * when it matches, always wins over whatever the AI guessed; otherwise the
 * category name is resolved against the target ledger's real categories via
 * the same normalization Postgres uses, never created fresh. Every item in
 * one extraction batch resolves against the same ledger (default
 * "Principal"); moving an individual row to a different ledger happens in
 * the review screen, which re-resolves that row's category itself.
 */
export async function processExtractedItems(
  householdId: string,
  ledgerId: string,
  rawItems: RawExtractedItem[],
  options?: {
    /** 'spoken_alias' pra lotes vindos de áudio, 'invoice_pattern' (default)
     * pra imagem/texto — nunca deixa uma fala casual como "mercado" casar
     * contra um padrão de fatura, nem o contrário. */
    ruleType?: MerchantRuleType;
  },
): Promise<DraftEntry[]> {
  const ruleType = options?.ruleType ?? "invoice_pattern";
  const results: DraftEntry[] = [];

  for (const raw of rawItems) {
    if (!DATE_RE.test(raw.date) || !raw.description?.trim() || !(raw.amount > 0)) {
      continue; // malformed item — skip rather than save garbage
    }

    let needsReview = raw.revisar === true;
    let categoryNotFound = false;
    let matchedRuleId: string | null = null;
    let categoryId: string | null = null;
    let categoryName = raw.category;

    const ruleMatch = await findMatchingRule(householdId, ledgerId, raw.description, ruleType);

    if (ruleMatch.type === "matched") {
      categoryId = ruleMatch.categoryId;
      categoryName = ruleMatch.categoryName;
      matchedRuleId = ruleMatch.ruleId;
    } else if (ruleMatch.type === "ambiguous") {
      needsReview = true;
      categoryName = "Aguardando Revisão";
    } else {
      const canonical = raw.category ? await findCanonicalCategory(householdId, ledgerId, raw.category) : null;
      if (canonical && (await isLeafCategory(householdId, ledgerId, canonical.id))) {
        categoryId = canonical.id;
        categoryName = canonical.name;
      } else {
        categoryNotFound = true;
        needsReview = true;
        categoryName = "Aguardando Revisão";
      }
    }

    const possibleDuplicate = categoryId
      ? await checkPossibleDuplicate(householdId, categoryId, raw.amount, raw.date)
      : false;

    const paymentSource = raw.payment_source_hint
      ? await resolvePaymentSourceHint(householdId, raw.payment_source_hint)
      : null;

    // Preview de conciliação (seção 2.3) — só faz sentido pro lado
    // "fatura/texto é a verdade" da hierarquia, nunca pro áudio, que é o
    // lado "estimativa" sendo procurado, não o buscador.
    let reconcileEntryId: string | null = null;
    let reconcileEntryDate: string | null = null;
    let reconcileEntryAmount: number | null = null;
    let reconciliationAmbiguous = false;
    if (ruleType !== "spoken_alias") {
      const reconciliation = await findReconciliationCandidate(householdId, ledgerId, {
        entryDate: raw.date,
        amount: raw.amount,
        paymentSourceId: paymentSource?.id ?? null,
      });
      if (reconciliation.type === "matched") {
        reconcileEntryId = reconciliation.entry.entryId;
        reconcileEntryDate = reconciliation.entry.entryDate;
        reconcileEntryAmount = reconciliation.entry.amount;
      } else if (reconciliation.type === "ambiguous") {
        reconciliationAmbiguous = true;
        needsReview = true;
      }
    }

    results.push({
      date: raw.date,
      description: raw.description.trim(),
      amount: raw.amount,
      categoryId,
      categoryName,
      needsReview,
      possibleDuplicate,
      categoryNotFound,
      aiCategoryGuess: raw.category ?? "",
      matchedRuleId,
      installmentCurrent: raw.installment_current ?? null,
      installmentTotal: raw.installment_total ?? null,
      approximate: raw.approximate === true,
      paymentSourceId: paymentSource?.id ?? null,
      paymentSourceName: paymentSource?.name ?? null,
      reconcileEntryId,
      reconcileEntryDate,
      reconcileEntryAmount,
      reconciliationAmbiguous,
    });
  }

  return results;
}

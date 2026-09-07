import type { RawExtractedItem } from "./extract";
import { findCanonicalCategory, isLeafCategory } from "@/lib/categories/service";
import { findMatchingRule } from "@/lib/merchant-rules/service";
import { checkPossibleDuplicate } from "@/lib/entries/service";

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
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the AI's raw JSON into entries ready for the review screen. Never
 * trusts the AI's category string blindly (section 3.2/8 of
 * sondar-full-build-instructions.md: "confiar cegamente na categoria que a
 * IA devolve" is listed as a mistake already made once) — a merchant rule,
 * when it matches, always wins over whatever the AI guessed; otherwise the
 * category name is resolved against the household's real categories via the
 * same normalization Postgres uses, never created fresh.
 */
export async function processExtractedItems(
  householdId: string,
  rawItems: RawExtractedItem[],
): Promise<DraftEntry[]> {
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

    const ruleMatch = await findMatchingRule(householdId, raw.description);

    if (ruleMatch.type === "matched") {
      categoryId = ruleMatch.categoryId;
      categoryName = ruleMatch.categoryName;
      matchedRuleId = ruleMatch.ruleId;
    } else if (ruleMatch.type === "ambiguous") {
      needsReview = true;
      categoryName = "Aguardando Revisão";
    } else {
      const canonical = raw.category ? await findCanonicalCategory(householdId, raw.category) : null;
      if (canonical && (await isLeafCategory(householdId, canonical.id))) {
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
    });
  }

  return results;
}

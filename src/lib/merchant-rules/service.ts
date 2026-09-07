import { db } from "@/lib/db";
import { normalizeStr, fuzzyMatch } from "@/lib/text/normalize";
import { isLeafCategory } from "@/lib/categories/service";

export type MerchantRuleRow = {
  id: string;
  household_id: string;
  pattern: string;
  pattern_normalized: string;
  category_id: string;
  category_name: string;
  is_ambiguous: boolean;
  created_at: string;
  deleted_at: string | null;
};

export async function listMerchantRules(householdId: string): Promise<MerchantRuleRow[]> {
  const { rows } = await db<MerchantRuleRow>(
    `SELECT mr.*, c.name AS category_name
     FROM merchant_rules mr
     JOIN categories c ON c.id = mr.category_id
     WHERE mr.household_id = $1 AND mr.deleted_at IS NULL
     ORDER BY lower(immutable_unaccent(mr.pattern)) ASC`,
    [householdId],
  );
  return rows;
}

async function findCanonicalRule(
  householdId: string,
  pattern: string,
): Promise<MerchantRuleRow | null> {
  const { rows } = await db<MerchantRuleRow>(
    `SELECT mr.*, c.name AS category_name
     FROM merchant_rules mr
     JOIN categories c ON c.id = mr.category_id
     WHERE mr.household_id = $1 AND mr.deleted_at IS NULL
       AND mr.pattern_normalized = lower(immutable_unaccent($2))`,
    [householdId, pattern],
  );
  return rows[0] ?? null;
}

export type CreateMerchantRuleResult =
  | { status: "created"; rule: MerchantRuleRow }
  | { status: "error"; message: string };

export async function createMerchantRule(
  householdId: string,
  input: { pattern: string; categoryId: string; isAmbiguous?: boolean },
): Promise<CreateMerchantRuleResult> {
  const pattern = input.pattern.trim();
  if (!pattern) return { status: "error", message: "Padrão não pode ser vazio." };

  if (!(await isLeafCategory(householdId, input.categoryId))) {
    return { status: "error", message: "Categoria inválida — escolha uma categoria-folha." };
  }

  const existing = await findCanonicalRule(householdId, pattern);
  if (existing) {
    return { status: "error", message: `Já existe uma regra para "${existing.pattern}".` };
  }

  const { rows } = await db<{ id: string }>(
    `INSERT INTO merchant_rules (household_id, pattern, category_id, is_ambiguous)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [householdId, pattern, input.categoryId, input.isAmbiguous ?? false],
  );

  const [rule] = await db<MerchantRuleRow>(
    `SELECT mr.*, c.name AS category_name FROM merchant_rules mr
     JOIN categories c ON c.id = mr.category_id WHERE mr.id = $1`,
    [rows[0].id],
  ).then((r) => r.rows);

  return { status: "created", rule };
}

export type UpdateMerchantRuleResult =
  | { status: "updated"; rule: MerchantRuleRow }
  | { status: "error"; message: string };

export async function updateMerchantRule(
  householdId: string,
  id: string,
  input: { pattern?: string; categoryId?: string; isAmbiguous?: boolean },
): Promise<UpdateMerchantRuleResult> {
  const { rows: existingRows } = await db<{ id: string }>(
    `SELECT id FROM merchant_rules WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  if (!existingRows[0]) return { status: "error", message: "Regra não encontrada." };

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.pattern !== undefined) {
    const trimmed = input.pattern.trim();
    if (!trimmed) return { status: "error", message: "Padrão não pode ser vazio." };
    const existing = await findCanonicalRule(householdId, trimmed);
    if (existing && existing.id !== id) {
      return { status: "error", message: `Já existe uma regra para "${existing.pattern}".` };
    }
    values.push(trimmed);
    sets.push(`pattern = $${values.length}`);
  }
  if (input.categoryId !== undefined) {
    if (!(await isLeafCategory(householdId, input.categoryId))) {
      return { status: "error", message: "Categoria inválida — escolha uma categoria-folha." };
    }
    values.push(input.categoryId);
    sets.push(`category_id = $${values.length}`);
  }
  if (input.isAmbiguous !== undefined) {
    values.push(input.isAmbiguous);
    sets.push(`is_ambiguous = $${values.length}`);
  }

  if (sets.length > 0) {
    values.push(id);
    await db(`UPDATE merchant_rules SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  }

  const { rows } = await db<MerchantRuleRow>(
    `SELECT mr.*, c.name AS category_name FROM merchant_rules mr
     JOIN categories c ON c.id = mr.category_id WHERE mr.id = $1`,
    [id],
  );
  return { status: "updated", rule: rows[0] };
}

export async function deleteMerchantRule(householdId: string, id: string): Promise<void> {
  await db(`UPDATE merchant_rules SET deleted_at = now() WHERE id = $1 AND household_id = $2`, [
    id,
    householdId,
  ]);
}

export type MerchantRuleMatch =
  | { type: "matched"; categoryId: string; categoryName: string; ruleId: string; pattern: string }
  | { type: "ambiguous"; ruleId: string; pattern: string }
  | { type: "none" };

/**
 * Rules are authoritative once matched — per sondar-full-build-instructions.md
 * section 4: "aplique sempre que o nome do estabelecimento corresponder,
 * mesmo que outra categoria pareça plausível". Ambiguous rules never
 * auto-apply a category; they force the item into review instead.
 */
export async function findMatchingRule(
  householdId: string,
  description: string,
): Promise<MerchantRuleMatch> {
  const rules = await listMerchantRules(householdId);
  const normDesc = normalizeStr(description);

  for (const rule of rules) {
    if (fuzzyMatch(normDesc, normalizeStr(rule.pattern))) {
      if (rule.is_ambiguous) {
        return { type: "ambiguous", ruleId: rule.id, pattern: rule.pattern };
      }
      return {
        type: "matched",
        categoryId: rule.category_id,
        categoryName: rule.category_name,
        ruleId: rule.id,
        pattern: rule.pattern,
      };
    }
  }
  return { type: "none" };
}

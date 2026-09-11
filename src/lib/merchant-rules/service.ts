import { dbForHousehold } from "@/lib/db";
import { normalizeStr, fuzzyMatch } from "@/lib/text/normalize";
import { isLeafCategory } from "@/lib/categories/service";

/** "invoice_pattern": casado por fuzzy match contra o texto de fatura (como
 * sempre funcionou). "spoken_alias": apelido dito em áudio (ex: "mercado") —
 * chave própria, nunca fuzzy-casada contra texto de fatura (colidiria com
 * nomes reais de estabelecimento). Ver sondar-melhorias-multimodal.md 1.4. */
export type MerchantRuleType = "invoice_pattern" | "spoken_alias";

export type MerchantRuleRow = {
  id: string;
  household_id: string;
  pattern: string;
  pattern_normalized: string;
  category_id: string;
  category_name: string;
  ledger_id: string;
  ledger_name: string;
  is_ambiguous: boolean;
  rule_type: MerchantRuleType;
  created_at: string;
  deleted_at: string | null;
};

const SELECT_RULE = `
  SELECT mr.*, c.name AS category_name, c.ledger_id, l.name AS ledger_name
  FROM merchant_rules mr
  JOIN categories c ON c.id = mr.category_id
  JOIN ledgers l ON l.id = c.ledger_id
`;

export async function listMerchantRules(householdId: string): Promise<MerchantRuleRow[]> {
  const { rows } = await dbForHousehold<MerchantRuleRow>(
    householdId,
    `${SELECT_RULE}
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
  const { rows } = await dbForHousehold<MerchantRuleRow>(
    householdId,
    `${SELECT_RULE}
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
  ledgerId: string,
  input: { pattern: string; categoryId: string; isAmbiguous?: boolean; ruleType?: MerchantRuleType },
): Promise<CreateMerchantRuleResult> {
  const pattern = input.pattern.trim();
  if (!pattern) return { status: "error", message: "Padrão não pode ser vazio." };

  if (!(await isLeafCategory(householdId, ledgerId, input.categoryId))) {
    return { status: "error", message: "Categoria inválida — escolha uma categoria-folha." };
  }

  const existing = await findCanonicalRule(householdId, pattern);
  if (existing) {
    return { status: "error", message: `Já existe uma regra para "${existing.pattern}".` };
  }

  const { rows } = await dbForHousehold<{ id: string }>(
    householdId,
    `INSERT INTO merchant_rules (household_id, pattern, category_id, is_ambiguous, rule_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [householdId, pattern, input.categoryId, input.isAmbiguous ?? false, input.ruleType ?? "invoice_pattern"],
  );

  const [rule] = await dbForHousehold<MerchantRuleRow>(
    householdId,
    `${SELECT_RULE} WHERE mr.id = $1`,
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
  input: { pattern?: string; categoryId?: string; ledgerId?: string; isAmbiguous?: boolean },
): Promise<UpdateMerchantRuleResult> {
  const { rows: existingRows } = await dbForHousehold<{ id: string }>(
    householdId,
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
    if (!input.ledgerId || !(await isLeafCategory(householdId, input.ledgerId, input.categoryId))) {
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
    await dbForHousehold(
      householdId,
      `UPDATE merchant_rules SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values,
    );
  }

  const { rows } = await dbForHousehold<MerchantRuleRow>(householdId, `${SELECT_RULE} WHERE mr.id = $1`, [
    id,
  ]);
  return { status: "updated", rule: rows[0] };
}

export async function deleteMerchantRule(householdId: string, id: string): Promise<void> {
  await dbForHousehold(
    householdId,
    `UPDATE merchant_rules SET deleted_at = now() WHERE id = $1 AND household_id = $2`,
    [id, householdId],
  );
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
 *
 * Scoped to one ledger: a rule whose category lives in a different ledger
 * doesn't apply here — ledgers don't influence each other, so a rule from
 * "Empresa" never silently categorizes something being processed into
 * "Principal".
 */
export async function findMatchingRule(
  householdId: string,
  ledgerId: string,
  description: string,
): Promise<MerchantRuleMatch> {
  const rules = (await listMerchantRules(householdId)).filter((r) => r.ledger_id === ledgerId);
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

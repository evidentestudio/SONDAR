import { db } from "@/lib/db";
import { monthToDbDate, previousMonthKey } from "@/lib/date";

export type BudgetRow = {
  id: string;
  household_id: string;
  category_id: string;
  month: string;
  amount: string;
  created_at: string;
  updated_at: string;
};

export type SetBudgetResult =
  | { status: "set"; budget: BudgetRow }
  | { status: "error"; message: string };

export async function setBudget(
  householdId: string,
  categoryId: string,
  monthKey: string,
  amount: number,
): Promise<SetBudgetResult> {
  if (!Number.isFinite(amount) || amount < 0) {
    return { status: "error", message: "Valor de orçamento inválido." };
  }

  const { rows: catRows } = await db(
    `SELECT id FROM categories WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [categoryId, householdId],
  );
  if (!catRows[0]) return { status: "error", message: "Categoria não encontrada." };

  const monthDate = monthToDbDate(monthKey);
  const { rows } = await db<BudgetRow>(
    `INSERT INTO budgets (household_id, category_id, month, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
     RETURNING *`,
    [householdId, categoryId, monthDate, amount],
  );
  return { status: "set", budget: rows[0] };
}

/** Upserts every budgeted category from the previous month into monthKey, scoped to one ledger. */
export async function copyBudgetsFromPreviousMonth(
  householdId: string,
  ledgerId: string,
  monthKey: string,
): Promise<{ copied: number }> {
  const prevDate = monthToDbDate(previousMonthKey(monthKey));
  const targetDate = monthToDbDate(monthKey);

  const { rows } = await db(
    `INSERT INTO budgets (household_id, category_id, month, amount)
     SELECT b.household_id, b.category_id, $3::date, b.amount
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     WHERE b.household_id = $1 AND c.ledger_id = $4 AND b.month = $2::date
       AND c.deleted_at IS NULL
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
     RETURNING id`,
    [householdId, prevDate, targetDate, ledgerId],
  );
  return { copied: rows.length };
}

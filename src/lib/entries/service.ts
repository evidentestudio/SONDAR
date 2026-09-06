import { db } from "@/lib/db";
import { monthToDbDate, nextMonthKey } from "@/lib/date";

export type EntryType = "expense" | "income";

export type EntryRow = {
  id: string;
  household_id: string;
  entry_type: EntryType;
  entry_date: string;
  description: string;
  amount: string;
  category_id: string | null;
  category_name: string | null;
  payment_source_id: string | null;
  payment_source_name: string | null;
  review_status: string;
  input_method: string;
  created_at: string;
};

export async function listEntries(
  householdId: string,
  monthKey: string,
  filters?: { paymentSourceId?: string },
): Promise<EntryRow[]> {
  const monthStart = monthToDbDate(monthKey);
  const monthEnd = monthToDbDate(nextMonthKey(monthKey));

  const values: unknown[] = [householdId, monthStart, monthEnd];
  let paymentSourceClause = "";
  if (filters?.paymentSourceId) {
    values.push(filters.paymentSourceId);
    paymentSourceClause = `AND e.payment_source_id = $${values.length}`;
  }

  const { rows } = await db<EntryRow>(
    `SELECT
       e.id, e.household_id, e.entry_type, e.entry_date, e.description, e.amount,
       e.category_id, c.name AS category_name,
       e.payment_source_id, ps.name AS payment_source_name,
       e.review_status, e.input_method, e.created_at
     FROM financial_entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN payment_sources ps ON ps.id = e.payment_source_id
     WHERE e.household_id = $1 AND e.deleted_at IS NULL
       AND e.entry_date >= $2::date AND e.entry_date < $3::date
       ${paymentSourceClause}
     ORDER BY e.entry_date DESC, e.created_at DESC`,
    values,
  );
  return rows;
}

export type CreateEntryInput = {
  entryType: EntryType;
  entryDate: string; // YYYY-MM-DD
  description: string;
  amount: number;
  categoryId?: string | null;
  paymentSourceId?: string | null;
  createdBy?: string | null;
};

export type CreateEntryResult =
  | { status: "created"; entry: { id: string } }
  | { status: "error"; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createEntry(
  householdId: string,
  input: CreateEntryInput,
): Promise<CreateEntryResult> {
  const description = input.description.trim();
  if (!description) return { status: "error", message: "Descrição não pode ser vazia." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: "error", message: "Valor precisa ser maior que zero." };
  }
  if (!DATE_RE.test(input.entryDate)) {
    return { status: "error", message: "Data inválida." };
  }

  let categoryId: string | null = input.categoryId ?? null;

  if (input.entryType === "expense") {
    if (!categoryId) return { status: "error", message: "Categoria é obrigatória para despesas." };

    const { rows: catRows } = await db<{ id: string }>(
      `SELECT c.id FROM categories c
       WHERE c.id = $1 AND c.household_id = $2 AND c.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.deleted_at IS NULL
         )`,
      [categoryId, householdId],
    );
    if (!catRows[0]) {
      return {
        status: "error",
        message: "Categoria inválida — escolha uma categoria-folha (sem subcategorias).",
      };
    }
  } else {
    categoryId = null;
  }

  let paymentSourceId: string | null = input.paymentSourceId ?? null;
  if (paymentSourceId) {
    const { rows } = await db<{ id: string }>(
      `SELECT id FROM payment_sources WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
      [paymentSourceId, householdId],
    );
    if (!rows[0]) paymentSourceId = null;
  }

  const { rows } = await db<{ id: string }>(
    `INSERT INTO financial_entries
       (household_id, entry_type, entry_date, description, amount, category_id, payment_source_id, input_method, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8)
     RETURNING id`,
    [
      householdId,
      input.entryType,
      input.entryDate,
      description,
      input.amount,
      categoryId,
      paymentSourceId,
      input.createdBy ?? null,
    ],
  );
  return { status: "created", entry: rows[0] };
}

export type UpdateEntryInput = {
  description?: string;
  amount?: number;
  entryDate?: string;
  categoryId?: string | null;
  paymentSourceId?: string | null;
};

export type UpdateEntryResult = { status: "updated" } | { status: "error"; message: string };

export async function updateEntry(
  householdId: string,
  id: string,
  input: UpdateEntryInput,
): Promise<UpdateEntryResult> {
  const { rows: existingRows } = await db<{ id: string; entry_type: EntryType }>(
    `SELECT id, entry_type FROM financial_entries WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  const existing = existingRows[0];
  if (!existing) return { status: "error", message: "Lançamento não encontrado." };

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    if (!trimmed) return { status: "error", message: "Descrição não pode ser vazia." };
    values.push(trimmed);
    sets.push(`description = $${values.length}`);
  }
  if (input.amount !== undefined) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { status: "error", message: "Valor precisa ser maior que zero." };
    }
    values.push(input.amount);
    sets.push(`amount = $${values.length}`);
  }
  if (input.entryDate !== undefined) {
    if (!DATE_RE.test(input.entryDate)) return { status: "error", message: "Data inválida." };
    values.push(input.entryDate);
    sets.push(`entry_date = $${values.length}`);
  }
  if (input.categoryId !== undefined) {
    if (existing.entry_type === "expense") {
      if (!input.categoryId) return { status: "error", message: "Categoria é obrigatória para despesas." };
      const { rows: catRows } = await db<{ id: string }>(
        `SELECT c.id FROM categories c
         WHERE c.id = $1 AND c.household_id = $2 AND c.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.deleted_at IS NULL
           )`,
        [input.categoryId, householdId],
      );
      if (!catRows[0]) {
        return { status: "error", message: "Categoria inválida — escolha uma categoria-folha." };
      }
    }
    values.push(input.categoryId);
    sets.push(`category_id = $${values.length}`);
  }
  if (input.paymentSourceId !== undefined) {
    values.push(input.paymentSourceId);
    sets.push(`payment_source_id = $${values.length}`);
  }

  if (sets.length === 0) return { status: "updated" };

  sets.push(`updated_at = now()`);
  values.push(id);
  await db(`UPDATE financial_entries SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  return { status: "updated" };
}

export async function deleteEntry(householdId: string, id: string): Promise<void> {
  await db(
    `UPDATE financial_entries SET deleted_at = now() WHERE id = $1 AND household_id = $2`,
    [id, householdId],
  );
}

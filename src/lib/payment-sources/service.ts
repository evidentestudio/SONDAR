import { db } from "@/lib/db";

export type PaymentSourceRow = {
  id: string;
  household_id: string;
  name: string;
  name_normalized: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
};

export async function listPaymentSources(householdId: string): Promise<PaymentSourceRow[]> {
  const { rows } = await db<PaymentSourceRow>(
    `SELECT * FROM payment_sources
     WHERE household_id = $1 AND deleted_at IS NULL
     ORDER BY lower(immutable_unaccent(name)) ASC`,
    [householdId],
  );
  return rows;
}

async function findCanonicalPaymentSource(
  householdId: string,
  name: string,
): Promise<PaymentSourceRow | null> {
  const { rows } = await db<PaymentSourceRow>(
    `SELECT * FROM payment_sources
     WHERE household_id = $1 AND deleted_at IS NULL
       AND name_normalized = lower(immutable_unaccent($2))`,
    [householdId, name],
  );
  return rows[0] ?? null;
}

export type CreatePaymentSourceResult =
  | { status: "created"; source: PaymentSourceRow }
  | { status: "error"; message: string };

export async function createPaymentSource(
  householdId: string,
  input: { name: string; color?: string | null },
): Promise<CreatePaymentSourceResult> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "Nome não pode ser vazio." };

  const existing = await findCanonicalPaymentSource(householdId, name);
  if (existing) {
    return { status: "error", message: `Já existe uma origem chamada "${existing.name}".` };
  }

  const { rows } = await db<PaymentSourceRow>(
    `INSERT INTO payment_sources (household_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
    [householdId, name, input.color ?? null],
  );
  return { status: "created", source: rows[0] };
}

export type UpdatePaymentSourceResult =
  | { status: "updated"; source: PaymentSourceRow }
  | { status: "error"; message: string };

export async function updatePaymentSource(
  householdId: string,
  id: string,
  input: { name?: string; color?: string | null },
): Promise<UpdatePaymentSourceResult> {
  const { rows: existingRows } = await db<PaymentSourceRow>(
    `SELECT * FROM payment_sources WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  const current = existingRows[0];
  if (!current) return { status: "error", message: "Origem não encontrada." };

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { status: "error", message: "Nome não pode ser vazio." };
    const existing = await findCanonicalPaymentSource(householdId, trimmed);
    if (existing && existing.id !== id) {
      return { status: "error", message: `Já existe uma origem chamada "${existing.name}".` };
    }
    values.push(trimmed);
    sets.push(`name = $${values.length}`);
  }
  if ("color" in input) {
    values.push(input.color);
    sets.push(`color = $${values.length}`);
  }

  if (sets.length === 0) return { status: "updated", source: current };

  values.push(id);
  const { rows } = await db<PaymentSourceRow>(
    `UPDATE payment_sources SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return { status: "updated", source: rows[0] };
}

export async function deletePaymentSource(householdId: string, id: string): Promise<void> {
  // Origin is a tag, not a required classification — detach rather than
  // block deletion or leave a dangling reference to a hidden row.
  await db(
    `UPDATE financial_entries SET payment_source_id = NULL, updated_at = now()
     WHERE payment_source_id = $1 AND household_id = $2`,
    [id, householdId],
  );
  await db(
    `UPDATE installment_plans SET payment_source_id = NULL
     WHERE payment_source_id = $1 AND household_id = $2`,
    [id, householdId],
  );
  await db(`UPDATE payment_sources SET deleted_at = now() WHERE id = $1 AND household_id = $2`, [
    id,
    householdId,
  ]);
}

import { db } from "@/lib/db";

export type LedgerRow = {
  id: string;
  household_id: string;
  name: string;
  name_normalized: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
};

/** Creates the household's "Principal" ledger, idempotently. */
export async function ensureDefaultLedger(householdId: string): Promise<string> {
  const { rows } = await db<{ id: string }>(
    `SELECT id FROM ledgers WHERE household_id = $1 AND is_default AND deleted_at IS NULL LIMIT 1`,
    [householdId],
  );
  if (rows[0]) return rows[0].id;

  const { rows: created } = await db<{ id: string }>(
    `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
    [householdId],
  );
  return created[0].id;
}

/**
 * Validates that a client-supplied ledgerId actually belongs to this
 * household (never trust it blindly — it would let one household read/write
 * into another's ledger otherwise), falling back to "Principal" when absent
 * or invalid. Used by every API route that accepts an optional ledgerId.
 */
export async function resolveLedgerId(householdId: string, requested?: string | null): Promise<string> {
  if (requested) {
    const ledger = await getLedgerById(householdId, requested);
    if (ledger) return ledger.id;
  }
  return ensureDefaultLedger(householdId);
}

export async function listLedgers(householdId: string): Promise<LedgerRow[]> {
  const { rows } = await db<LedgerRow>(
    `SELECT * FROM ledgers WHERE household_id = $1 AND deleted_at IS NULL
     ORDER BY is_default DESC, lower(immutable_unaccent(name)) ASC`,
    [householdId],
  );
  return rows;
}

export async function getLedgerById(householdId: string, id: string): Promise<LedgerRow | null> {
  const { rows } = await db<LedgerRow>(
    `SELECT * FROM ledgers WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  return rows[0] ?? null;
}

async function findCanonicalLedger(householdId: string, name: string): Promise<LedgerRow | null> {
  const { rows } = await db<LedgerRow>(
    `SELECT * FROM ledgers
     WHERE household_id = $1 AND deleted_at IS NULL
       AND name_normalized = lower(immutable_unaccent($2))`,
    [householdId, name],
  );
  return rows[0] ?? null;
}

export type CreateLedgerResult =
  | { status: "created"; ledger: LedgerRow }
  | { status: "error"; message: string };

/** Free-form — the user creates as many of these as they want, named however they want. */
export async function createLedger(
  householdId: string,
  input: { name: string },
): Promise<CreateLedgerResult> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "Nome não pode ser vazio." };

  const existing = await findCanonicalLedger(householdId, name);
  if (existing) {
    return { status: "error", message: `Já existe um orçamento chamado "${existing.name}".` };
  }

  const { rows } = await db<LedgerRow>(
    `INSERT INTO ledgers (household_id, name) VALUES ($1, $2) RETURNING *`,
    [householdId, name],
  );
  return { status: "created", ledger: rows[0] };
}

export type UpdateLedgerResult =
  | { status: "updated"; ledger: LedgerRow }
  | { status: "error"; message: string };

export async function updateLedger(
  householdId: string,
  id: string,
  input: { name: string },
): Promise<UpdateLedgerResult> {
  const current = await getLedgerById(householdId, id);
  if (!current) return { status: "error", message: "Orçamento não encontrado." };

  const name = input.name.trim();
  if (!name) return { status: "error", message: "Nome não pode ser vazio." };

  const existing = await findCanonicalLedger(householdId, name);
  if (existing && existing.id !== id) {
    return { status: "error", message: `Já existe um orçamento chamado "${existing.name}".` };
  }

  const { rows } = await db<LedgerRow>(
    `UPDATE ledgers SET name = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [name, id],
  );
  return { status: "updated", ledger: rows[0] };
}

export type DeleteLedgerResult =
  | { status: "deleted" }
  | { status: "error"; message: string };

/**
 * The "Principal" ledger always exists and can't be excluded. A ledger that
 * still has categories or entries is left alone too — the user needs to
 * clear it out first, same guardrail as deleting a category with entries.
 */
export async function deleteLedger(householdId: string, id: string): Promise<DeleteLedgerResult> {
  const ledger = await getLedgerById(householdId, id);
  if (!ledger) return { status: "error", message: "Orçamento não encontrado." };
  if (ledger.is_default) {
    return { status: "error", message: "O orçamento Principal não pode ser excluído." };
  }

  const { rows } = await db<{ count: string }>(
    `SELECT count(*)::text AS count FROM categories WHERE ledger_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (Number(rows[0].count) > 0) {
    return {
      status: "error",
      message: "Exclua as categorias desse orçamento antes de excluí-lo.",
    };
  }

  await db(`UPDATE ledgers SET deleted_at = now() WHERE id = $1`, [id]);
  return { status: "deleted" };
}

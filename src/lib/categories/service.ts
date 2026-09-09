import { db } from "@/lib/db";

export type CategoryType = "normal" | "reserve" | "awaiting_review";

export type CategoryRow = {
  id: string;
  household_id: string;
  ledger_id: string;
  parent_id: string | null;
  name: string;
  name_normalized: string;
  category_type: CategoryType;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
};

export type CategoryNode = CategoryRow & { children: CategoryNode[] };

/**
 * Only leaf categories may receive an entry/rule directly — never a group.
 * Also confirms the category belongs to the given ledger, since a category
 * id alone no longer implies a single unambiguous scope (each ledger has
 * its own independent category tree).
 */
export async function isLeafCategory(
  householdId: string,
  ledgerId: string,
  categoryId: string,
): Promise<boolean> {
  const { rows } = await db<{ id: string }>(
    `SELECT c.id FROM categories c
     WHERE c.id = $1 AND c.household_id = $2 AND c.ledger_id = $3 AND c.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM categories child WHERE child.parent_id = c.id AND child.deleted_at IS NULL
       )`,
    [categoryId, householdId, ledgerId],
  );
  return rows.length > 0;
}

export async function getCategoryById(householdId: string, id: string): Promise<CategoryRow | null> {
  const { rows } = await db<CategoryRow>(
    `SELECT * FROM categories WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  return rows[0] ?? null;
}

/**
 * Matches the exact normalization Postgres uses for categories.name_normalized
 * (lower(immutable_unaccent(name))) by asking Postgres itself, rather than
 * reimplementing accent-stripping in JS — one source of truth, no drift.
 * Scoped per ledger — the same name can exist in two different ledgers
 * (independent category trees), so household alone is no longer enough.
 */
export async function findCanonicalCategory(
  ledgerId: string,
  name: string,
): Promise<CategoryRow | null> {
  const { rows } = await db<CategoryRow>(
    `SELECT * FROM categories
     WHERE ledger_id = $1 AND deleted_at IS NULL
       AND name_normalized = lower(immutable_unaccent($2))`,
    [ledgerId, name],
  );
  return rows[0] ?? null;
}

/** Creates the single system category every ledger needs, idempotently. */
export async function ensureAwaitingReviewCategory(householdId: string, ledgerId: string): Promise<string> {
  const { rows } = await db<{ id: string }>(
    `SELECT id FROM categories
     WHERE ledger_id = $1 AND category_type = 'awaiting_review' AND deleted_at IS NULL
     LIMIT 1`,
    [ledgerId],
  );
  if (rows[0]) return rows[0].id;

  const { rows: created } = await db<{ id: string }>(
    `INSERT INTO categories (household_id, ledger_id, name, category_type)
     VALUES ($1, $2, 'Aguardando Revisão', 'awaiting_review')
     RETURNING id`,
    [householdId, ledgerId],
  );
  return created[0].id;
}

export async function getCategoryTree(householdId: string, ledgerId: string): Promise<CategoryNode[]> {
  const { rows } = await db<CategoryRow>(
    `SELECT * FROM categories
     WHERE household_id = $1 AND ledger_id = $2 AND deleted_at IS NULL
     ORDER BY lower(immutable_unaccent(name)) ASC`,
    [householdId, ledgerId],
  );

  const byId = new Map<string, CategoryNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node);
    } else if (!row.parent_id) {
      roots.push(node);
    }
  }

  const rank = (t: CategoryType) => (t === "normal" ? 0 : t === "reserve" ? 1 : 2);
  roots.sort((a, b) => rank(a.category_type) - rank(b.category_type));

  return roots;
}

/** Leaf categories only — the only ones allowed to receive entries directly. */
export async function listLeafCategories(householdId: string, ledgerId: string): Promise<CategoryRow[]> {
  const { rows } = await db<CategoryRow>(
    `SELECT c.* FROM categories c
     WHERE c.household_id = $1 AND c.ledger_id = $2 AND c.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM categories child
         WHERE child.parent_id = c.id AND child.deleted_at IS NULL
       )
     ORDER BY lower(immutable_unaccent(c.name)) ASC`,
    [householdId, ledgerId],
  );
  return rows;
}

export type CreateCategoryInput = {
  name: string;
  parentId?: string | null;
  color?: string | null;
  icon?: string | null;
  confirmMerge?: boolean;
};

export type CreateCategoryResult =
  | { status: "created"; category: CategoryRow }
  | { status: "merged"; category: CategoryRow }
  | { status: "collision"; existing: { id: string; name: string } }
  | { status: "error"; message: string };

export async function createCategory(
  householdId: string,
  ledgerId: string,
  input: CreateCategoryInput,
): Promise<CreateCategoryResult> {
  const trimmed = input.name.trim();
  if (!trimmed) return { status: "error", message: "Nome não pode ser vazio." };

  const parentId = input.parentId ?? null;
  // Categorias-mãe (topo da hierarquia) sempre em caixa alta; subcategorias
  // ficam como o usuário digitou.
  const name = parentId === null ? trimmed.toUpperCase() : trimmed;

  if (parentId) {
    const parent = await getCategoryById(householdId, parentId);
    if (!parent || parent.ledger_id !== ledgerId) {
      return { status: "error", message: "Categoria-mãe não encontrada." };
    }
    if (parent.parent_id) {
      return {
        status: "error",
        message: "Subcategoria de subcategoria não é permitida (hierarquia de 2 níveis).",
      };
    }
  }

  const existing = await findCanonicalCategory(ledgerId, name);

  if (existing) {
    const existingIsTopLevel = existing.parent_id === null;
    const creatingAsSubcategory = parentId !== null;

    if (existingIsTopLevel && creatingAsSubcategory && existing.id !== parentId) {
      if (!input.confirmMerge) {
        return { status: "collision", existing: { id: existing.id, name: existing.name } };
      }
      // Fusion: reparent the existing row in place. Same id, so every
      // financial_entries.category_id pointing at it stays valid — nothing
      // to move, nothing duplicated.
      const { rows } = await db<CategoryRow>(
        `UPDATE categories SET parent_id = $1, color = COALESCE($2, color) WHERE id = $3 RETURNING *`,
        [parentId, input.color ?? null, existing.id],
      );
      return { status: "merged", category: rows[0] };
    }

    return { status: "error", message: `Já existe uma categoria chamada "${existing.name}".` };
  }

  const { rows } = await db<CategoryRow>(
    `INSERT INTO categories (household_id, ledger_id, parent_id, name, category_type, color, icon)
     VALUES ($1, $2, $3, $4, 'normal', $5, $6)
     RETURNING *`,
    [householdId, ledgerId, parentId, name, input.color ?? null, input.icon ?? null],
  );
  return { status: "created", category: rows[0] };
}

export type UpdateCategoryInput = {
  name?: string;
  color?: string | null;
  icon?: string | null;
};

export type UpdateCategoryResult =
  | { status: "updated"; category: CategoryRow }
  | { status: "error"; message: string };

export async function updateCategory(
  householdId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  const category = await getCategoryById(householdId, id);
  if (!category) return { status: "error", message: "Categoria não encontrada." };

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { status: "error", message: "Nome não pode ser vazio." };
    // Mesma regra da criação: categoria-mãe em caixa alta, subcategoria livre.
    const name = category.parent_id === null ? trimmed.toUpperCase() : trimmed;
    const existing = await findCanonicalCategory(category.ledger_id, name);
    if (existing && existing.id !== id) {
      return { status: "error", message: `Já existe uma categoria chamada "${existing.name}".` };
    }
    values.push(name);
    sets.push(`name = $${values.length}`);
  }
  if ("color" in input) {
    values.push(input.color);
    sets.push(`color = $${values.length}`);
  }
  if ("icon" in input) {
    values.push(input.icon);
    sets.push(`icon = $${values.length}`);
  }

  if (sets.length === 0) return { status: "updated", category };

  values.push(id);
  const { rows } = await db<CategoryRow>(
    `UPDATE categories SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return { status: "updated", category: rows[0] };
}

export type DeleteDecision = {
  onEntries?: "move" | "delete";
  moveToCategoryId?: string;
};

export type DeleteCategoryResult =
  | { status: "deleted" }
  | { status: "needs_decision"; entryCount: number }
  | { status: "error"; message: string };

export async function deleteCategory(
  householdId: string,
  categoryId: string,
  decision?: DeleteDecision,
): Promise<DeleteCategoryResult> {
  const category = await getCategoryById(householdId, categoryId);
  if (!category) return { status: "error", message: "Categoria não encontrada." };

  const { rows: childRows } = await db<{ count: string }>(
    `SELECT count(*)::text AS count FROM categories WHERE parent_id = $1 AND deleted_at IS NULL`,
    [categoryId],
  );
  if (Number(childRows[0].count) > 0) {
    return {
      status: "error",
      message: "Exclua ou mova as subcategorias antes de excluir esta categoria.",
    };
  }

  const { rows: entryRows } = await db<{ count: string }>(
    `SELECT count(*)::text AS count FROM financial_entries WHERE category_id = $1 AND deleted_at IS NULL`,
    [categoryId],
  );
  const entryCount = Number(entryRows[0].count);

  if (entryCount > 0 && !decision?.onEntries) {
    return { status: "needs_decision", entryCount };
  }

  if (entryCount > 0 && decision?.onEntries === "move") {
    if (!decision.moveToCategoryId) {
      return { status: "error", message: "Selecione a categoria de destino." };
    }
    const target = await getCategoryById(householdId, decision.moveToCategoryId);
    if (!target) return { status: "error", message: "Categoria de destino não encontrada." };
    await db(
      `UPDATE financial_entries SET category_id = $1, updated_at = now()
       WHERE category_id = $2 AND deleted_at IS NULL`,
      [decision.moveToCategoryId, categoryId],
    );
  } else if (entryCount > 0 && decision?.onEntries === "delete") {
    await db(
      `UPDATE financial_entries SET deleted_at = now() WHERE category_id = $1 AND deleted_at IS NULL`,
      [categoryId],
    );
  }

  await db(`UPDATE categories SET deleted_at = now() WHERE id = $1`, [categoryId]);
  return { status: "deleted" };
}

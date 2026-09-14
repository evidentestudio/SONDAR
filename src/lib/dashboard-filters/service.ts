import { dbForHousehold } from "@/lib/db";
import { isLeafCategory } from "@/lib/categories/service";

export type DashboardFilterRow = {
  id: string;
  household_id: string;
  ledger_id: string;
  name: string;
  category_ids: string[];
  created_at: string;
};

export async function listDashboardFilters(
  householdId: string,
  ledgerId: string,
): Promise<DashboardFilterRow[]> {
  const { rows } = await dbForHousehold<DashboardFilterRow>(
    householdId,
    `SELECT * FROM dashboard_filters
     WHERE household_id = $1 AND ledger_id = $2
     ORDER BY lower(immutable_unaccent(name)) ASC`,
    [householdId, ledgerId],
  );
  return rows;
}

export type CreateDashboardFilterResult =
  | { status: "created"; filter: DashboardFilterRow }
  | { status: "error"; message: string };

/**
 * "Painel economizável" (Etapa 6) não é uma tela separada — é este mesmo
 * painel com um filtro salvo de quais categorias entram. Guarda a lista
 * explícita de categorias-folha escolhidas pela própria pessoa (só ela sabe
 * quais categorias não têm margem pra economizar), nunca uma regra
 * adivinhada pelo sistema.
 */
export async function createDashboardFilter(
  householdId: string,
  ledgerId: string,
  input: { name: string; categoryIds: string[] },
): Promise<CreateDashboardFilterResult> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "Nome não pode ser vazio." };
  if (input.categoryIds.length === 0) {
    return { status: "error", message: "Selecione ao menos uma categoria." };
  }
  for (const categoryId of input.categoryIds) {
    if (!(await isLeafCategory(householdId, ledgerId, categoryId))) {
      return { status: "error", message: "Categoria inválida — escolha categorias-folha deste orçamento." };
    }
  }

  const { rows: existing } = await dbForHousehold<{ id: string }>(
    householdId,
    `SELECT id FROM dashboard_filters
     WHERE ledger_id = $1 AND lower(immutable_unaccent(name)) = lower(immutable_unaccent($2))`,
    [ledgerId, name],
  );
  if (existing[0]) {
    return { status: "error", message: `Já existe um filtro salvo chamado "${name}".` };
  }

  const { rows } = await dbForHousehold<DashboardFilterRow>(
    householdId,
    `INSERT INTO dashboard_filters (household_id, ledger_id, name, category_ids)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [householdId, ledgerId, name, input.categoryIds],
  );
  return { status: "created", filter: rows[0] };
}

export async function deleteDashboardFilter(householdId: string, id: string): Promise<void> {
  await dbForHousehold(
    householdId,
    `DELETE FROM dashboard_filters WHERE id = $1 AND household_id = $2`,
    [id, householdId],
  );
}

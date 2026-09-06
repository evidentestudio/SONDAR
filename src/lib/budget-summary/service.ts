import { db } from "@/lib/db";
import { monthToDbDate, nextMonthKey } from "@/lib/date";
import type { CategoryType } from "@/lib/categories/service";

type SummaryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  category_type: CategoryType;
  gasto: string | null;
  orcado: string | null;
};

export type CategorySummaryNode = {
  id: string;
  name: string;
  color: string | null;
  categoryType: CategoryType;
  gasto: number;
  orcado: number;
  /** Only set for a group (has children): entries/budget logged directly on
   * the parent, e.g. left over from before it had subcategories. Shown as
   * the "↳ Sem subcategoria" row, and only when non-zero. */
  direct: { gasto: number; orcado: number } | null;
  children: CategorySummaryNode[];
};

/**
 * Categoria x gasto for a month, following services/budgetSummary.ts from
 * sondar-full-build-instructions.md section 3.4: a group's total is the sum
 * of its children PLUS any entries/budget still sitting directly on the
 * parent (orphaned when a category gains subcategories after already having
 * entries) — never just the children, or that amount silently disappears.
 */
export async function getCategoryMonthSummary(
  householdId: string,
  monthKey: string,
): Promise<CategorySummaryNode[]> {
  const monthStart = monthToDbDate(monthKey);
  const monthEnd = monthToDbDate(nextMonthKey(monthKey));

  const { rows } = await db<SummaryRow>(
    `SELECT
       c.id, c.parent_id, c.name, c.color, c.category_type,
       e.gasto, b.amount AS orcado
     FROM categories c
     LEFT JOIN (
       SELECT category_id, SUM(amount) AS gasto
       FROM financial_entries
       WHERE household_id = $1 AND entry_type = 'expense' AND deleted_at IS NULL
         AND entry_date >= $2::date AND entry_date < $3::date
       GROUP BY category_id
     ) e ON e.category_id = c.id
     LEFT JOIN budgets b ON b.category_id = c.id AND b.month = $2::date
     WHERE c.household_id = $1 AND c.deleted_at IS NULL
     ORDER BY lower(immutable_unaccent(c.name)) ASC`,
    [householdId, monthStart, monthEnd],
  );

  type WorkingNode = Omit<CategorySummaryNode, "children"> & {
    parentId: string | null;
    ownGasto: number;
    ownOrcado: number;
    children: WorkingNode[];
  };
  const byId = new Map<string, WorkingNode>();

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      color: row.color,
      categoryType: row.category_type,
      parentId: row.parent_id,
      ownGasto: Number(row.gasto ?? 0),
      ownOrcado: Number(row.orcado ?? 0),
      gasto: 0,
      orcado: 0,
      direct: null,
      children: [],
    });
  }

  const roots: WorkingNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const root of roots) {
    if (root.children.length > 0) {
      const childGasto = root.children.reduce((s, c) => s + c.ownGasto, 0);
      const childOrcado = root.children.reduce((s, c) => s + c.ownOrcado, 0);
      root.gasto = childGasto + root.ownGasto;
      root.orcado = childOrcado + root.ownOrcado;
      if (root.ownGasto > 0 || root.ownOrcado > 0) {
        root.direct = { gasto: root.ownGasto, orcado: root.ownOrcado };
      }
      for (const child of root.children) {
        child.gasto = child.ownGasto;
        child.orcado = child.ownOrcado;
      }
    } else {
      root.gasto = root.ownGasto;
      root.orcado = root.ownOrcado;
    }
  }

  const rank = (t: CategoryType) => (t === "normal" ? 0 : t === "reserve" ? 1 : 2);
  roots.sort((a, b) => rank(a.categoryType) - rank(b.categoryType));

  return roots;
}

export async function getMonthTotals(
  householdId: string,
  monthKey: string,
): Promise<{ gastoTotal: number; creditosTotal: number }> {
  const monthDate = monthToDbDate(monthKey);
  const { rows } = await db<{ gasto_total: string | null; creditos_total: string | null }>(
    `SELECT gasto_total, creditos_total FROM month_totals WHERE household_id = $1 AND month = $2::date`,
    [householdId, monthDate],
  );
  return {
    gastoTotal: Number(rows[0]?.gasto_total ?? 0),
    creditosTotal: Number(rows[0]?.creditos_total ?? 0),
  };
}

export type PaymentSourceTotal = {
  paymentSourceId: string;
  paymentSourceName: string;
  total: number;
};

export async function getPaymentSourceTotals(
  householdId: string,
  monthKey: string,
): Promise<PaymentSourceTotal[]> {
  const monthDate = monthToDbDate(monthKey);
  const { rows } = await db<{ payment_source_id: string; payment_source_name: string; total: string }>(
    `SELECT payment_source_id, payment_source_name, total
     FROM payment_source_month_summary
     WHERE household_id = $1 AND month = $2::date
     ORDER BY payment_source_name ASC`,
    [householdId, monthDate],
  );
  return rows.map((r) => ({
    paymentSourceId: r.payment_source_id,
    paymentSourceName: r.payment_source_name,
    total: Number(r.total),
  }));
}

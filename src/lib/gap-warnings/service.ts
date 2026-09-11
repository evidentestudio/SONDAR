import { dbForHousehold } from "@/lib/db";
import { addMonthsToKey, isValidMonthKey, monthToDbDate, nextMonthKey } from "@/lib/date";

export type GapWarning = {
  categoryId: string;
  categoryName: string;
  kind: "missing" | "drop";
  message: string;
};

/**
 * "Lacunas de registro (dinheiro e Pix)" — sondar-melhorias-multimodal.md
 * seção 3. Gasto de cartão tem rede de segurança (a fatura pega depois);
 * dinheiro e Pix não têm, então uma categoria paga assim pode simplesmente
 * parar de ser lançada sem ninguém notar. Exige 3 meses seguidos de
 * atividade antes do mês avaliado (seção 3.3 — "um mês não basta"), então
 * nunca dispara sobre um padrão recém-criado. Cobre as duas redações da
 * seção 3 com uma única detecção: "missing" (3.2, sumiu de vez) quando o
 * mês avaliado não tem nenhum lançamento na categoria; "drop" (3.1, caiu
 * bastante) quando tem, mas bem menos que a média dos 3 meses anteriores.
 * Nunca sugere valor (princípio do documento) — só aponta a lacuna.
 */
export async function findGapWarnings(
  householdId: string,
  ledgerId: string,
  monthKey: string,
): Promise<GapWarning[]> {
  if (!isValidMonthKey(monthKey)) return [];

  const priorMonthKeys = [1, 2, 3].map((n) => addMonthsToKey(monthKey, -n));
  const rangeStart = monthToDbDate(priorMonthKeys[2]);
  const rangeEnd = monthToDbDate(nextMonthKey(monthKey));

  const { rows } = await dbForHousehold<{
    category_id: string;
    category_name: string;
    month_start: string;
    entry_count: number;
    entry_total: string;
  }>(
    householdId,
    `SELECT c.id AS category_id, c.name AS category_name,
            date_trunc('month', e.entry_date::timestamp)::date AS month_start,
            COUNT(*)::int AS entry_count, SUM(e.amount) AS entry_total
     FROM financial_entries e
     JOIN categories c ON c.id = e.category_id
     JOIN payment_sources ps ON ps.id = e.payment_source_id
     WHERE e.household_id = $1 AND e.ledger_id = $2 AND e.deleted_at IS NULL
       AND ps.leaves_no_paper_trail = true
       AND c.gap_alerts_silenced_at IS NULL
       AND e.entry_date >= $3::date AND e.entry_date < $4::date
     GROUP BY c.id, c.name, date_trunc('month', e.entry_date::timestamp)`,
    [householdId, ledgerId, rangeStart, rangeEnd],
  );

  const byCategory = new Map<
    string,
    { categoryName: string; byMonth: Map<string, { count: number; total: number }> }
  >();
  for (const row of rows) {
    const monthStart = row.month_start.slice(0, 10);
    let entry = byCategory.get(row.category_id);
    if (!entry) {
      entry = { categoryName: row.category_name, byMonth: new Map() };
      byCategory.set(row.category_id, entry);
    }
    entry.byMonth.set(monthStart, { count: row.entry_count, total: Number(row.entry_total) });
  }

  const priorMonthStarts = priorMonthKeys.map(monthToDbDate);
  const currentMonthStart = monthToDbDate(monthKey);

  const warnings: GapWarning[] = [];
  for (const [categoryId, { categoryName, byMonth }] of byCategory) {
    const hasFullHistory = priorMonthStarts.every((m) => (byMonth.get(m)?.count ?? 0) > 0);
    if (!hasFullHistory) continue;

    const current = byMonth.get(currentMonthStart);
    if (!current || current.count === 0) {
      warnings.push({
        categoryId,
        categoryName,
        kind: "missing",
        message: `Você costuma lançar gastos em dinheiro ou Pix em "${categoryName}" todo mês. Este mês não tem nenhum lançamento assim. Faltou algum?`,
      });
      continue;
    }

    const priorTotals = priorMonthStarts.map((m) => byMonth.get(m)!.total);
    const priorAverage = priorTotals.reduce((s, v) => s + v, 0) / priorTotals.length;
    if (current.total < priorAverage * 0.5) {
      warnings.push({
        categoryId,
        categoryName,
        kind: "drop",
        message: `Seus lançamentos de gastos em dinheiro ou Pix em "${categoryName}" reduziram bastante neste mês. Verifique se foi intencional ou esquecimento de algum valor pago em dinheiro ou Pix.`,
      });
    }
  }

  return warnings;
}

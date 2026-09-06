-- ============================================================================
-- Bug fix — NOT a structural change, just a corrected view definition.
-- ============================================================================
-- month_totals (in sondar_schema.sql) does:
--   FROM financial_entries e JOIN categories c ON c.id = e.category_id
-- Income entries have category_id = NULL by design (the schema's own
-- chk_expense_has_category CHECK only requires a category for expenses), so
-- an INNER JOIN silently drops every credit from this view — creditos_total
-- always came back empty. That breaks "Créditos do mês comparados com
-- orçado, alerta se menor" from the checklist, which reads directly from
-- this view.
--
-- Fix: LEFT JOIN so income rows survive, and group by e.household_id instead
-- of c.household_id (the categories row doesn't exist for those rows either).
-- gasto_total's own FILTER already requires entry_type = 'expense', so
-- letting income rows' NULL category_type through changes nothing there.
-- ============================================================================

CREATE OR REPLACE VIEW month_totals AS
SELECT
  e.household_id,
  date_trunc('month', e.entry_date::timestamp)::DATE AS month,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'expense' AND c.category_type = 'normal') AS gasto_total,
  SUM(e.amount) FILTER (WHERE e.entry_type = 'income') AS creditos_total
FROM financial_entries e
LEFT JOIN categories c ON c.id = e.category_id
WHERE e.deleted_at IS NULL
GROUP BY e.household_id, date_trunc('month', e.entry_date::timestamp);

import { db } from "@/lib/db";
import { addMonthsToKey, currentMonthKey, dbDateToMonthKey, monthToDbDate } from "@/lib/date";
import { ensureAwaitingReviewCategory, isLeafCategory } from "@/lib/categories/service";
import { createEntry } from "@/lib/entries/service";
import type { InputMethod, ReviewStatus } from "@/lib/entries/service";

export type InstallmentPlanRow = {
  id: string;
  household_id: string;
  ledger_id: string;
  description: string;
  category_id: string;
  category_name: string;
  payment_source_id: string | null;
  installment_amount: string;
  total_installments: number;
  anchor_month: string;
  created_at: string;
  deleted_at: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Strips a trailing "(N/M)" parcel indicator so it's never appended twice —
// the description stored on the plan is always the clean merchant name, and
// every entry (the first one and every auto-generated one) gets the
// indicator appended fresh from installment_number/total_installments.
const INSTALLMENT_SUFFIX_RE = /\s*\(\d+\/\d+\)\s*$/;

function stripInstallmentSuffix(description: string): string {
  return description.replace(INSTALLMENT_SUFFIX_RE, "").trim();
}

function withInstallmentSuffix(description: string, number: number, total: number): string {
  return `${description} (${number}/${total})`;
}

export type CreateInstallmentPlanInput = {
  ledgerId: string;
  description: string;
  categoryId?: string | null;
  paymentSourceId?: string | null;
  installmentAmount: number;
  totalInstallments: number;
  /** Which installment the invoice/entry being saved right now represents. */
  currentInstallmentNumber: number;
  currentInstallmentDate: string; // YYYY-MM-DD
  createdBy?: string | null;
  inputMethod?: InputMethod;
  reviewStatus?: ReviewStatus;
};

export type CreateInstallmentPlanResult =
  | { status: "created"; plan: InstallmentPlanRow; entryId: string }
  | { status: "error"; message: string };

/**
 * Per sondar_schema.sql's own design note: parcelamentos get their own table
 * (installment_plans), and only the CURRENT installment's entry is created
 * here — future months are not front-loaded. "Avanço automático de parcela"
 * is a monthly job (advanceInstallmentsForMonth below), not eager creation,
 * so the month view never shows 11 months of purchases that haven't
 * happened yet.
 */
export async function createInstallmentPlan(
  householdId: string,
  input: CreateInstallmentPlanInput,
): Promise<CreateInstallmentPlanResult> {
  const description = stripInstallmentSuffix(input.description.trim());
  if (!description) return { status: "error", message: "Descrição não pode ser vazia." };
  if (!Number.isFinite(input.installmentAmount) || input.installmentAmount <= 0) {
    return { status: "error", message: "Valor da parcela precisa ser maior que zero." };
  }
  if (!Number.isInteger(input.totalInstallments) || input.totalInstallments <= 1) {
    return { status: "error", message: "Total de parcelas precisa ser maior que 1." };
  }
  if (
    !Number.isInteger(input.currentInstallmentNumber) ||
    input.currentInstallmentNumber < 1 ||
    input.currentInstallmentNumber > input.totalInstallments
  ) {
    return { status: "error", message: "Número da parcela atual é inválido." };
  }
  if (!DATE_RE.test(input.currentInstallmentDate)) {
    return { status: "error", message: "Data inválida." };
  }

  let categoryId = input.categoryId ?? null;
  if (!categoryId) categoryId = await ensureAwaitingReviewCategory(householdId, input.ledgerId);
  if (!(await isLeafCategory(householdId, input.ledgerId, categoryId))) {
    return {
      status: "error",
      message: "Categoria inválida — escolha uma categoria-folha (sem subcategorias) deste orçamento.",
    };
  }

  const anchorMonthKey = addMonthsToKey(
    dbDateToMonthKey(input.currentInstallmentDate),
    -(input.currentInstallmentNumber - 1),
  );

  const { rows } = await db<InstallmentPlanRow>(
    `INSERT INTO installment_plans
       (household_id, ledger_id, description, category_id, payment_source_id, installment_amount, total_installments, anchor_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      householdId,
      input.ledgerId,
      description,
      categoryId,
      input.paymentSourceId ?? null,
      input.installmentAmount,
      input.totalInstallments,
      monthToDbDate(anchorMonthKey),
    ],
  );
  const plan = rows[0];

  const entryResult = await createEntry(householdId, {
    ledgerId: input.ledgerId,
    entryType: "expense",
    entryDate: input.currentInstallmentDate,
    description: withInstallmentSuffix(description, input.currentInstallmentNumber, input.totalInstallments),
    amount: input.installmentAmount,
    categoryId,
    paymentSourceId: input.paymentSourceId ?? null,
    createdBy: input.createdBy ?? null,
    inputMethod: input.inputMethod ?? "manual",
    reviewStatus: input.reviewStatus ?? "confirmed",
    installmentPlanId: plan.id,
    installmentNumber: input.currentInstallmentNumber,
  });
  if (entryResult.status === "error") {
    // The plan without any entry is useless — roll it back rather than
    // leaving an orphaned installment_plans row behind.
    await db(`DELETE FROM installment_plans WHERE id = $1`, [plan.id]);
    return { status: "error", message: entryResult.message };
  }

  return { status: "created", plan, entryId: entryResult.entry.id };
}

export async function listInstallmentPlans(
  householdId: string,
  ledgerId: string,
): Promise<InstallmentPlanRow[]> {
  const { rows } = await db<InstallmentPlanRow>(
    `SELECT p.*, c.name AS category_name
     FROM installment_plans p
     JOIN categories c ON c.id = p.category_id
     WHERE p.household_id = $1 AND p.ledger_id = $2 AND p.deleted_at IS NULL
     ORDER BY p.anchor_month DESC, lower(immutable_unaccent(p.description)) ASC`,
    [householdId, ledgerId],
  );
  return rows;
}

export type ForecastCell = {
  month: string; // YYYY-MM
  installmentNumber: number;
  amount: number;
  /** true = já é um lançamento real (criado manualmente ou pelo avanço
   * automático); false = ainda não aconteceu, valor é o previsto do plano. */
  isReal: boolean;
};

export type ForecastPlanRow = {
  planId: string;
  description: string;
  categoryName: string;
  paymentSourceId: string | null;
  paymentSourceName: string | null;
  totalInstallments: number;
  cells: ForecastCell[];
};

export type ForecastGrid = {
  months: string[]; // ordenados, do mês inicial em diante
  plans: ForecastPlanRow[];
  totalsByMonth: Record<string, number>;
};

/**
 * Grade "mês x parcelamento" do mês informado (por padrão, hoje) em diante —
 * tudo num lugar só, sem precisar visitar Lançamentos: meses que já viraram
 * lançamento real (manual ou pelo avanço automático) aparecem marcados como
 * tal, e os que ainda não aconteceram aparecem como previsão, calculada na
 * hora a partir de installment_plans sem gravar nada. Planos já totalmente
 * concluídos antes do mês inicial não aparecem.
 */
export async function getInstallmentForecastGrid(
  householdId: string,
  ledgerId: string,
  options?: { paymentSourceId?: string; fromMonth?: string },
): Promise<ForecastGrid> {
  const fromMonth = options?.fromMonth ?? currentMonthKey();

  const values: unknown[] = [householdId, ledgerId];
  let paymentSourceClause = "";
  if (options?.paymentSourceId) {
    values.push(options.paymentSourceId);
    paymentSourceClause = `AND p.payment_source_id = $${values.length}`;
  }

  const { rows: plans } = await db<InstallmentPlanRow & { payment_source_name: string | null }>(
    `SELECT p.*, c.name AS category_name, ps.name AS payment_source_name
     FROM installment_plans p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN payment_sources ps ON ps.id = p.payment_source_id
     WHERE p.household_id = $1 AND p.ledger_id = $2 AND p.deleted_at IS NULL
       ${paymentSourceClause}`,
    values,
  );
  if (plans.length === 0) return { months: [], plans: [], totalsByMonth: {} };

  const { rows: realRows } = await db<{ installment_plan_id: string; month: string; amount: string }>(
    `SELECT installment_plan_id, to_char(entry_date, 'YYYY-MM') AS month, amount
     FROM financial_entries
     WHERE installment_plan_id = ANY($1::uuid[]) AND deleted_at IS NULL
       AND entry_date >= $2::date`,
    [plans.map((p) => p.id), monthToDbDate(fromMonth)],
  );
  const realAmountByPlanMonth = new Map(
    realRows.map((r) => [`${r.installment_plan_id}:${r.month}`, Number(r.amount)]),
  );

  const planRows: ForecastPlanRow[] = [];
  const monthSet = new Set<string>();

  for (const plan of plans) {
    const anchorMonthKey = dbDateToMonthKey(plan.anchor_month);
    const cells: ForecastCell[] = [];

    for (let n = 1; n <= plan.total_installments; n++) {
      const monthKey = addMonthsToKey(anchorMonthKey, n - 1);
      if (monthKey < fromMonth) continue;
      const real = realAmountByPlanMonth.get(`${plan.id}:${monthKey}`);
      cells.push({
        month: monthKey,
        installmentNumber: n,
        isReal: real !== undefined,
        amount: real ?? Number(plan.installment_amount),
      });
      monthSet.add(monthKey);
    }

    if (cells.length === 0) continue; // plano já concluído antes do mês inicial
    planRows.push({
      planId: plan.id,
      description: plan.description,
      categoryName: plan.category_name,
      paymentSourceId: plan.payment_source_id,
      paymentSourceName: plan.payment_source_name,
      totalInstallments: plan.total_installments,
      cells,
    });
  }

  const months = Array.from(monthSet).sort();
  const totalsByMonth: Record<string, number> = {};
  for (const month of months) totalsByMonth[month] = 0;
  for (const row of planRows) {
    for (const cell of row.cells) totalsByMonth[cell.month] += cell.amount;
  }

  planRows.sort((a, b) => a.description.localeCompare(b.description));

  return { months, plans: planRows, totalsByMonth };
}

export type StopInstallmentPlanResult = { status: "stopped" } | { status: "error"; message: string };

/**
 * Soft-deletes the plan so advanceInstallmentsForMonth stops generating new
 * entries for it — entries already created (past installments) are left
 * exactly as they are, since that money was already spent.
 */
export async function stopInstallmentPlan(
  householdId: string,
  id: string,
): Promise<StopInstallmentPlanResult> {
  const { rows } = await db<{ id: string }>(
    `SELECT id FROM installment_plans WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
  if (!rows[0]) return { status: "error", message: "Parcelamento não encontrado." };

  await db(`UPDATE installment_plans SET deleted_at = now() WHERE id = $1`, [id]);
  return { status: "stopped" };
}

type DuePlanRow = {
  id: string;
  household_id: string;
  ledger_id: string;
  description: string;
  category_id: string;
  payment_source_id: string | null;
  installment_amount: string;
  total_installments: number;
  installment_number: number;
};

/**
 * The monthly job: for every plan whose current installment (per
 * installment_number_for_month, defined in sondar_schema.sql) still falls
 * within [1, total_installments] and doesn't already have an entry for this
 * month, create one. Safe to re-run for the same month — the NOT EXISTS
 * guard makes it idempotent, which matters because a serverless cron can
 * retry or double-fire.
 */
export async function advanceInstallmentsForMonth(monthKey: string = currentMonthKey()): Promise<{
  created: number;
}> {
  const monthDate = monthToDbDate(monthKey);

  const { rows: due } = await db<DuePlanRow>(
    `SELECT
       p.id, p.household_id, p.ledger_id, p.description, p.category_id, p.payment_source_id,
       p.installment_amount, p.total_installments,
       installment_number_for_month(p.anchor_month, $1::date) AS installment_number
     FROM installment_plans p
     WHERE p.deleted_at IS NULL
       AND installment_number_for_month(p.anchor_month, $1::date) BETWEEN 1 AND p.total_installments
       AND NOT EXISTS (
         SELECT 1 FROM financial_entries e
         WHERE e.installment_plan_id = p.id
           AND date_trunc('month', e.entry_date::timestamp) = date_trunc('month', $1::date)
           AND e.deleted_at IS NULL
       )`,
    [monthDate],
  );

  let created = 0;
  for (const plan of due) {
    // The category chosen when the plan was created might have gained
    // subcategories (no longer a leaf) or been deleted since — fall back to
    // "Aguardando Revisão" rather than silently violating the leaf-only rule
    // or crashing the whole job over one plan.
    let categoryId = plan.category_id;
    if (!(await isLeafCategory(plan.household_id, plan.ledger_id, categoryId))) {
      categoryId = await ensureAwaitingReviewCategory(plan.household_id, plan.ledger_id);
    }

    const result = await createEntry(plan.household_id, {
      ledgerId: plan.ledger_id,
      entryType: "expense",
      entryDate: monthDate,
      description: withInstallmentSuffix(plan.description, plan.installment_number, plan.total_installments),
      amount: Number(plan.installment_amount),
      categoryId,
      paymentSourceId: plan.payment_source_id,
      inputMethod: "manual",
      reviewStatus: "confirmed",
      installmentPlanId: plan.id,
      installmentNumber: plan.installment_number,
    });
    if (result.status === "created") created += 1;
  }

  return { created };
}

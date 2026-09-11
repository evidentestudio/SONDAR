import { dbForHousehold } from "@/lib/db";
import { monthToDbDate, nextMonthKey } from "@/lib/date";
import { ensureAwaitingReviewCategory, isLeafCategory } from "@/lib/categories/service";
import { getLedgerById } from "@/lib/ledgers/service";

export type EntryType = "expense" | "income";

export type EntryRow = {
  id: string;
  household_id: string;
  ledger_id: string;
  entry_type: EntryType;
  entry_date: string;
  description: string;
  amount: string;
  category_id: string | null;
  category_name: string | null;
  category_type: string | null;
  payment_source_id: string | null;
  payment_source_name: string | null;
  review_status: string;
  input_method: string;
  amount_confidence: AmountConfidence;
  created_at: string;
  installment_plan_id: string | null;
  installment_number: number | null;
  total_installments: number | null;
  /** Preenchido só quando esse lançamento foi um rascunho de áudio fundido
   * com uma fatura/texto pela hierarquia de fontes (reconcileEntry, seção
   * 2.3) — null caso contrário. Ver db/009_audio_confirmation.sql. */
  audio_confirmed_at: string | null;
};

export async function listEntries(
  householdId: string,
  ledgerId: string,
  monthKey: string,
  filters?: { paymentSourceId?: string },
): Promise<EntryRow[]> {
  const monthStart = monthToDbDate(monthKey);
  const monthEnd = monthToDbDate(nextMonthKey(monthKey));

  const values: unknown[] = [householdId, ledgerId, monthStart, monthEnd];
  let paymentSourceClause = "";
  if (filters?.paymentSourceId) {
    values.push(filters.paymentSourceId);
    paymentSourceClause = `AND e.payment_source_id = $${values.length}`;
  }

  const { rows } = await dbForHousehold<EntryRow>(
    householdId,
    `SELECT
       e.id, e.household_id, e.ledger_id, e.entry_type, e.entry_date, e.description, e.amount,
       e.category_id, c.name AS category_name, c.category_type AS category_type,
       e.payment_source_id, ps.name AS payment_source_name,
       e.review_status, e.input_method, e.amount_confidence, e.created_at,
       e.installment_plan_id, e.installment_number, ip.total_installments,
       e.audio_confirmed_at
     FROM financial_entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN payment_sources ps ON ps.id = e.payment_source_id
     LEFT JOIN installment_plans ip ON ip.id = e.installment_plan_id
     WHERE e.household_id = $1 AND e.ledger_id = $2 AND e.deleted_at IS NULL
       AND e.entry_date >= $3::date AND e.entry_date < $4::date
       ${paymentSourceClause}
     ORDER BY e.entry_date DESC, e.created_at DESC`,
    values,
  );
  return rows;
}

export type InputMethod = "manual" | "ai_image" | "ai_text" | "ai_audio";
export type ReviewStatus = "confirmed" | "needs_review" | "possible_duplicate";
/** "exact": valor exato (fatura, print, digitado). "approximate": arredondado
 * pela própria pessoa ao falar (ex: "uns quarenta") — ver
 * sondar-melhorias-multimodal.md seção 1.2. Usado pela sub-etapa de áudio. */
export type AmountConfidence = "exact" | "approximate";

export type CreateEntryInput = {
  ledgerId: string;
  entryType: EntryType;
  entryDate: string; // YYYY-MM-DD
  description: string;
  amount: number;
  categoryId?: string | null;
  paymentSourceId?: string | null;
  createdBy?: string | null;
  inputMethod?: InputMethod;
  reviewStatus?: ReviewStatus;
  amountConfidence?: AmountConfidence;
  /** Set only by lib/installment-plans/service.ts — links this entry to its
   * parcela plan. Never set directly from a route: createInstallmentPlan is
   * the only caller that should ever pass these. */
  installmentPlanId?: string | null;
  installmentNumber?: number | null;
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
    // Manual entry without a chosen category falls back to "Aguardando
    // Revisão" instead of blocking the save — same category the AI pipeline
    // (Etapa 3) uses when it can't classify something confidently.
    if (!categoryId) categoryId = await ensureAwaitingReviewCategory(householdId, input.ledgerId);

    if (!(await isLeafCategory(householdId, input.ledgerId, categoryId))) {
      return {
        status: "error",
        message: "Categoria inválida — escolha uma categoria-folha (sem subcategorias) deste orçamento.",
      };
    }
  } else {
    categoryId = null;
  }

  let paymentSourceId: string | null = input.paymentSourceId ?? null;
  if (paymentSourceId) {
    const { rows } = await dbForHousehold<{ id: string }>(
      householdId,
      `SELECT id FROM payment_sources WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
      [paymentSourceId, householdId],
    );
    if (!rows[0]) paymentSourceId = null;
  }

  const { rows } = await dbForHousehold<{ id: string }>(
    householdId,
    `INSERT INTO financial_entries
       (household_id, ledger_id, entry_type, entry_date, description, amount, category_id, payment_source_id, input_method, review_status, amount_confidence, created_by, installment_plan_id, installment_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      householdId,
      input.ledgerId,
      input.entryType,
      input.entryDate,
      description,
      input.amount,
      categoryId,
      paymentSourceId,
      input.inputMethod ?? "manual",
      input.reviewStatus ?? "confirmed",
      input.amountConfidence ?? "exact",
      input.createdBy ?? null,
      input.installmentPlanId ?? null,
      input.installmentNumber ?? null,
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
  ledgerId?: string;
};

export type UpdateEntryResult = { status: "updated" } | { status: "error"; message: string };

export async function updateEntry(
  householdId: string,
  id: string,
  input: UpdateEntryInput,
): Promise<UpdateEntryResult> {
  const { rows: existingRows } = await dbForHousehold<{ id: string; entry_type: EntryType; ledger_id: string }>(
    householdId,
    `SELECT id, entry_type, ledger_id FROM financial_entries WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
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
  const ledgerChanging = input.ledgerId !== undefined && input.ledgerId !== existing.ledger_id;
  const targetLedgerId = ledgerChanging ? input.ledgerId! : existing.ledger_id;

  if (ledgerChanging && !(await getLedgerById(householdId, targetLedgerId))) {
    return { status: "error", message: "Orçamento inválido." };
  }

  if (input.categoryId !== undefined || (ledgerChanging && existing.entry_type === "expense")) {
    let categoryId = input.categoryId !== undefined ? input.categoryId : null;
    if (existing.entry_type === "expense") {
      // Trocar de orçamento invalida a categoria antiga — ela pertence à
      // árvore do orçamento anterior. Sem categoria explícita nesta mesma
      // chamada, cai na "Aguardando Revisão" do orçamento de destino.
      if (!categoryId) categoryId = await ensureAwaitingReviewCategory(householdId, targetLedgerId);
      if (!(await isLeafCategory(householdId, targetLedgerId, categoryId))) {
        return {
          status: "error",
          message: "Categoria inválida — escolha uma categoria-folha deste orçamento.",
        };
      }
    }
    values.push(categoryId);
    sets.push(`category_id = $${values.length}`);
  }
  if (input.paymentSourceId !== undefined) {
    values.push(input.paymentSourceId);
    sets.push(`payment_source_id = $${values.length}`);
  }
  if (ledgerChanging) {
    values.push(targetLedgerId);
    sets.push(`ledger_id = $${values.length}`);
  }

  if (sets.length === 0) return { status: "updated" };

  sets.push(`updated_at = now()`);
  values.push(id);
  await dbForHousehold(
    householdId,
    `UPDATE financial_entries SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values,
  );
  return { status: "updated" };
}

export async function deleteEntry(householdId: string, id: string): Promise<void> {
  await dbForHousehold(
    householdId,
    `UPDATE financial_entries SET deleted_at = now() WHERE id = $1 AND household_id = $2`,
    [id, householdId],
  );
}

export type ReconciliationCandidate = {
  entryId: string;
  categoryId: string | null;
  paymentSourceId: string | null;
  entryDate: string;
  amount: number;
};

export type ReconciliationResult =
  | { type: "matched"; entry: ReconciliationCandidate }
  | { type: "ambiguous" }
  | { type: "none" };

/**
 * Hierarquia de fontes (sondar-melhorias-multimodal.md seção 2.3): a
 * fatura/extrato é sempre a verdade, o áudio é sempre estimativa. Quando
 * chega um lançamento de fatura/texto, procura um rascunho de áudio
 * pendente (amount_confidence = 'approximate') com janela de ±3 dias, valor
 * dentro de ±20% e mesma forma de pagamento — candidato a fundir em vez de
 * virar um lançamento novo e duplicado. Mais de um candidato é ambíguo
 * (nunca decide sozinho): vai para revisão, nenhum dos dois é tocado aqui.
 */
export async function findReconciliationCandidate(
  householdId: string,
  ledgerId: string,
  params: { entryDate: string; amount: number; paymentSourceId: string | null },
): Promise<ReconciliationResult> {
  const { rows } = await dbForHousehold<{
    id: string;
    category_id: string | null;
    payment_source_id: string | null;
    entry_date: string;
    amount: string;
  }>(
    householdId,
    `SELECT id, category_id, payment_source_id, entry_date, amount FROM financial_entries
     WHERE household_id = $1 AND ledger_id = $2 AND deleted_at IS NULL
       AND amount_confidence = 'approximate'
       AND entry_date BETWEEN $3::date - INTERVAL '3 days' AND $3::date + INTERVAL '3 days'
       AND amount BETWEEN $4 * 0.8 AND $4 * 1.2
       AND payment_source_id IS NOT DISTINCT FROM $5`,
    [householdId, ledgerId, params.entryDate, params.amount, params.paymentSourceId],
  );
  if (rows.length === 0) return { type: "none" };
  if (rows.length > 1) return { type: "ambiguous" };
  return {
    type: "matched",
    entry: {
      entryId: rows[0].id,
      categoryId: rows[0].category_id,
      paymentSourceId: rows[0].payment_source_id,
      entryDate: rows[0].entry_date,
      amount: Number(rows[0].amount),
    },
  };
}

/**
 * Executa a fusão decidida por findReconciliationCandidate: substitui valor
 * e data pelos da fatura/texto (a verdade) e marca como conciliado
 * (amount_confidence volta a 'exact') — mantém a categoria e a forma de
 * pagamento já atribuídas ao rascunho de áudio, que a pessoa já confirmou.
 */
export async function reconcileEntry(
  householdId: string,
  entryId: string,
  input: { amount: number; entryDate: string; inputMethod: InputMethod; reviewStatus: ReviewStatus },
): Promise<CreateEntryResult> {
  const { rows } = await dbForHousehold<{ id: string }>(
    householdId,
    `UPDATE financial_entries
       SET amount = $1, entry_date = $2, amount_confidence = 'exact',
           input_method = $3, review_status = $4, audio_confirmed_at = now(),
           updated_at = now()
     WHERE id = $5 AND household_id = $6 AND deleted_at IS NULL
     RETURNING id`,
    [input.amount, input.entryDate, input.inputMethod, input.reviewStatus, entryId, householdId],
  );
  if (!rows[0]) return { status: "error", message: "Lançamento a conciliar não foi encontrado." };
  return { status: "created", entry: { id: rows[0].id } };
}

/**
 * Per sondar-full-build-instructions.md section 3.6 — same category + amount
 * (within a cent) in the same month. Never blocks saving, only flags for the
 * "possível duplicidade" badge; the user decides. Scoped by category, which
 * already pins it to one ledger.
 */
export async function checkPossibleDuplicate(
  householdId: string,
  categoryId: string,
  amount: number,
  entryDate: string,
  excludeEntryId?: string,
): Promise<boolean> {
  const { rows } = await dbForHousehold(
    householdId,
    `SELECT 1 FROM financial_entries
     WHERE household_id = $1 AND category_id = $2
       AND ABS(amount - $3) < 0.005
       AND date_trunc('month', entry_date) = date_trunc('month', $4::date)
       AND deleted_at IS NULL
       AND ($5::uuid IS NULL OR id != $5)
     LIMIT 1`,
    [householdId, categoryId, amount, entryDate, excludeEntryId ?? null],
  );
  return rows.length > 0;
}

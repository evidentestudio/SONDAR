import { dbForHousehold } from "@/lib/db";
import { monthToDbDate, nextMonthKey } from "@/lib/date";
import { ensureAwaitingReviewCategory, isLeafCategory } from "@/lib/categories/service";
import { getLedgerById } from "@/lib/ledgers/service";
import { normalizeStr, fuzzyMatch } from "@/lib/text/normalize";

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
  /** Lançamentos com o mesmo split_group_id são as N partes de uma única
   * compra dividida em categorias diferentes (Etapa 5) — null quando o
   * lançamento não foi dividido. Ver db/011_entry_splits.sql. */
  split_group_id: string | null;
};

/** Aceita um ou vários ledgerIds — permite combinar lançamentos de vários
 * orçamentos numa lista só (cada linha já carrega seu próprio ledger_id). */
export async function listEntries(
  householdId: string,
  ledgerId: string | string[],
  monthKey: string,
  filters?: { paymentSourceId?: string },
): Promise<EntryRow[]> {
  const ledgerIds = Array.isArray(ledgerId) ? ledgerId : [ledgerId];
  const monthStart = monthToDbDate(monthKey);
  const monthEnd = monthToDbDate(nextMonthKey(monthKey));

  const values: unknown[] = [householdId, ledgerIds, monthStart, monthEnd];
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
       e.audio_confirmed_at, e.split_group_id
     FROM financial_entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN payment_sources ps ON ps.id = e.payment_source_id
     LEFT JOIN installment_plans ip ON ip.id = e.installment_plan_id
     WHERE e.household_id = $1 AND e.ledger_id = ANY($2::uuid[]) AND e.deleted_at IS NULL
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
  /** Set only by save-batch quando a pessoa dividiu um item em N categorias
   * ANTES de salvar, na tela de revisão (Etapa 5) — todas as partes de uma
   * mesma divisão compartilham o mesmo split_group_id. */
  splitGroupId?: string | null;
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
       (household_id, ledger_id, entry_type, entry_date, description, amount, category_id, payment_source_id, input_method, review_status, amount_confidence, created_by, installment_plan_id, installment_number, split_group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
      input.splitGroupId ?? null,
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

  // Editar um lançamento É a revisão (seção 5 do documento de melhorias
  // multimodais: "revisão em lote" precisa de um jeito de tirar um
  // lançamento da fila depois de corrigi-lo) — sem isso, review_status
  // nunca mudava depois da criação e a fila só crescia pra sempre. Já
  // 'confirmed' é um no-op inofensivo.
  sets.push(`review_status = 'confirmed'`);
  sets.push(`updated_at = now()`);
  values.push(id);
  await dbForHousehold(
    householdId,
    `UPDATE financial_entries SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values,
  );
  return { status: "updated" };
}

/**
 * "Confirmar sem alterar" — pra quando o lançamento sinalizado já está
 * correto do jeito que está (ex: possível duplicidade que na verdade eram
 * duas compras legítimas no mesmo dia). Separado de updateEntry porque não
 * muda nenhum outro campo.
 */
export async function markEntryReviewed(householdId: string, id: string): Promise<void> {
  await dbForHousehold(
    householdId,
    `UPDATE financial_entries SET review_status = 'confirmed', updated_at = now()
     WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId],
  );
}

/**
 * Lista TODOS os lançamentos sinalizados (needs_review/possible_duplicate)
 * do household, de qualquer mês e qualquer orçamento — "revisão em lote"
 * (sondar-melhorias-multimodal.md seção 5) precisa juntar tudo que ficou
 * pendente num só lugar, porque revisar item a item espalhado pelos meses
 * é exatamente o hábito que essa tela existe pra evitar.
 */
export async function listEntriesForReview(householdId: string): Promise<EntryRow[]> {
  const { rows } = await dbForHousehold<EntryRow>(
    householdId,
    `SELECT
       e.id, e.household_id, e.ledger_id, e.entry_type, e.entry_date, e.description, e.amount,
       e.category_id, c.name AS category_name, c.category_type AS category_type,
       e.payment_source_id, ps.name AS payment_source_name,
       e.review_status, e.input_method, e.amount_confidence, e.created_at,
       e.installment_plan_id, e.installment_number, ip.total_installments,
       e.audio_confirmed_at, e.split_group_id
     FROM financial_entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN payment_sources ps ON ps.id = e.payment_source_id
     LEFT JOIN installment_plans ip ON ip.id = e.installment_plan_id
     WHERE e.household_id = $1 AND e.deleted_at IS NULL
       AND e.review_status IN ('needs_review', 'possible_duplicate')
     ORDER BY e.entry_date DESC, e.created_at DESC`,
    [householdId],
  );
  return rows;
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

export type DuplicateReason = "mesma_categoria_valor_identico" | "descricao_parecida";

export type DuplicateCandidate = {
  entryA: EntryRow;
  entryB: EntryRow;
  reasons: DuplicateReason[];
};

/** Mesma janela/tolerância já usada por findReconciliationCandidate — reaproveita
 * o mesmo critério de "parecido o bastante" em vez de inventar um novo. */
const SIMILAR_DATE_WINDOW_DAYS = 3;
const SIMILAR_AMOUNT_TOLERANCE = 0.2;

function sameInstallmentOrSplit(a: EntryRow, b: EntryRow): boolean {
  if (a.installment_plan_id && a.installment_plan_id === b.installment_plan_id) return true;
  if (a.split_group_id && a.split_group_id === b.split_group_id) return true;
  return false;
}

/**
 * Buscador de lançamentos duplicados (pedido fora do roteiro sequenciado,
 * 2026-10-19) — varre TODOS os meses de um orçamento (não só o mês aberto na
 * tela) atrás de pares suspeitos, por dois critérios independentes (um par
 * pode bater nos dois):
 *
 * (a) "mesma_categoria_valor_identico": mesma categoria + mesmo tipo + valor
 *     idêntico (até o centavo) + mesmo mês — mesmo critério de
 *     checkPossibleDuplicate, mas achando TODOS os pares existentes em vez
 *     de só checar um lançamento novo contra os demais.
 * (b) "descricao_parecida": descrição parecida (normalizeStr/fuzzyMatch, já
 *     usado pra regras de estabelecimento) + valor dentro de ±20% + data
 *     dentro de 3 dias — mesma tolerância de findReconciliationCandidate.
 *
 * Nunca junta parcelas diferentes da mesma compra (mesmo installment_plan_id)
 * nem partes da mesma divisão (mesmo split_group_id) — essas são sempre
 * lançamentos distintos por natureza, não duplicidade.
 *
 * Puramente sob demanda (botão), nunca automático — mesma filosofia do Radar
 * Financeiro, pra não gerar custo/ruído toda vez que a tela carrega. Pares já
 * marcados como "Ignorar" (duplicate_dismissals) nunca reaparecem.
 */
export async function findDuplicateCandidates(
  householdId: string,
  ledgerId: string,
): Promise<DuplicateCandidate[]> {
  const { rows } = await dbForHousehold<EntryRow>(
    householdId,
    `SELECT
       e.id, e.household_id, e.ledger_id, e.entry_type, e.entry_date, e.description, e.amount,
       e.category_id, c.name AS category_name, c.category_type AS category_type,
       e.payment_source_id, ps.name AS payment_source_name,
       e.review_status, e.input_method, e.amount_confidence, e.created_at,
       e.installment_plan_id, e.installment_number, ip.total_installments,
       e.audio_confirmed_at, e.split_group_id
     FROM financial_entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN payment_sources ps ON ps.id = e.payment_source_id
     LEFT JOIN installment_plans ip ON ip.id = e.installment_plan_id
     WHERE e.household_id = $1 AND e.ledger_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.entry_date DESC, e.created_at DESC`,
    [householdId, ledgerId],
  );
  if (rows.length < 2) return [];

  const { rows: dismissedRows } = await dbForHousehold<{ entry_id_a: string; entry_id_b: string }>(
    householdId,
    `SELECT entry_id_a, entry_id_b FROM duplicate_dismissals WHERE household_id = $1`,
    [householdId],
  );
  const dismissed = new Set(dismissedRows.map((d) => `${d.entry_id_a}:${d.entry_id_b}`));
  function isDismissed(a: EntryRow, b: EntryRow): boolean {
    const [idA, idB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    return dismissed.has(`${idA}:${idB}`);
  }

  const pairs = new Map<string, DuplicateCandidate>();
  function addReason(a: EntryRow, b: EntryRow, reason: DuplicateReason) {
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    const key = `${first.id}:${second.id}`;
    const existing = pairs.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    } else {
      pairs.set(key, { entryA: first, entryB: second, reasons: [reason] });
    }
  }

  // Critério (a) — agrupado por bucket (tipo+categoria+mês+centavos) em vez
  // de comparar todo mundo com todo mundo, já que households com muitos
  // lançamentos acumulados ao longo dos anos não devem virar O(n²) de verdade.
  const exactBuckets = new Map<string, EntryRow[]>();
  for (const e of rows) {
    const monthKey = e.entry_date.slice(0, 7);
    const cents = Math.round(Number(e.amount) * 100);
    const key = `${e.entry_type}|${e.category_id ?? "none"}|${monthKey}|${cents}`;
    const bucket = exactBuckets.get(key);
    if (bucket) bucket.push(e);
    else exactBuckets.set(key, [e]);
  }
  for (const bucket of exactBuckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (sameInstallmentOrSplit(a, b) || isDismissed(a, b)) continue;
        addReason(a, b, "mesma_categoria_valor_identico");
      }
    }
  }

  // Critério (b) — rows já vem ordenado por entry_date DESC; a janela de
  // dias permite parar o loop interno assim que a distância de datas passa
  // do limite, em vez de comparar com o resto da lista inteira.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const dayDiff = Math.abs(
        (new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()) / 86_400_000,
      );
      if (dayDiff > SIMILAR_DATE_WINDOW_DAYS) break;
      if (a.entry_type !== b.entry_type) continue;
      if (sameInstallmentOrSplit(a, b) || isDismissed(a, b)) continue;
      const amtA = Number(a.amount);
      const amtB = Number(b.amount);
      const maxAmt = Math.max(amtA, amtB);
      if (maxAmt === 0 || Math.abs(amtA - amtB) / maxAmt > SIMILAR_AMOUNT_TOLERANCE) continue;
      const normA = normalizeStr(a.description);
      const normB = normalizeStr(b.description);
      if (normA && normB && (normA === normB || fuzzyMatch(normA, normB) || fuzzyMatch(normB, normA))) {
        addReason(a, b, "descricao_parecida");
      }
    }
  }

  return Array.from(pairs.values()).sort((x, y) => {
    const dx = Math.max(
      new Date(x.entryA.entry_date).getTime(),
      new Date(x.entryB.entry_date).getTime(),
    );
    const dy = Math.max(
      new Date(y.entryA.entry_date).getTime(),
      new Date(y.entryB.entry_date).getTime(),
    );
    return dy - dx;
  });
}

/** Marca um par como "não é duplicado" — nunca mais reaparece em
 * findDuplicateCandidates. Ordem canônica (menor id primeiro) garante que o
 * mesmo par nunca gera duas linhas diferentes. */
export async function dismissDuplicatePair(
  householdId: string,
  entryIdA: string,
  entryIdB: string,
): Promise<void> {
  const [idA, idB] = entryIdA < entryIdB ? [entryIdA, entryIdB] : [entryIdB, entryIdA];
  await dbForHousehold(
    householdId,
    `INSERT INTO duplicate_dismissals (household_id, entry_id_a, entry_id_b)
     VALUES ($1, $2, $3)
     ON CONFLICT (entry_id_a, entry_id_b) DO NOTHING`,
    [householdId, idA, idB],
  );
}

export type SplitPart = { categoryId: string | null; amount: number };

export type SplitEntryResult =
  | { status: "split"; entryIds: string[] }
  | { status: "error"; message: string };

/**
 * Etapa 5 (sondar-etapas-implementacao.md): divide um lançamento em N
 * categorias. Cada parte vira sua própria linha em financial_entries,
 * marcadas com o mesmo split_group_id — reaproveita o resto do sistema
 * (relatórios, orçamento por categoria) sem precisar entender o conceito
 * de "grupo", cada parte já soma certo sozinha.
 *
 * O "total a preservar" nunca é o valor de uma única linha: se o
 * lançamento já fazia parte de um grupo (edição de uma divisão existente —
 * "+ mais uma parte"/"remover parte"), é a soma de TODAS as partes atuais
 * do grupo. Isso é o que garante que editar uma divisão não perde o valor
 * das outras partes. As linhas antigas (1 ou N) são substituídas por N
 * novas linhas numa única instrução (delete + insert via CTE), então nunca
 * existe um estado intermediário sem o dinheiro contabilizado em algum
 * lugar.
 */
export async function splitEntry(
  householdId: string,
  entryId: string,
  parts: SplitPart[],
): Promise<SplitEntryResult> {
  if (parts.length === 0) return { status: "error", message: "Informe ao menos uma parte." };
  for (const part of parts) {
    if (!Number.isFinite(part.amount) || part.amount <= 0) {
      return { status: "error", message: "Cada parte precisa de um valor maior que zero." };
    }
  }

  const { rows: existingRows } = await dbForHousehold<{
    id: string;
    ledger_id: string;
    entry_type: EntryType;
    entry_date: string;
    description: string;
    payment_source_id: string | null;
    input_method: InputMethod;
    review_status: ReviewStatus;
    amount_confidence: AmountConfidence;
    created_by: string | null;
    installment_plan_id: string | null;
    split_group_id: string | null;
    amount: string;
  }>(
    householdId,
    `SELECT id, ledger_id, entry_type, entry_date, description, payment_source_id, input_method,
            review_status, amount_confidence, created_by, installment_plan_id, split_group_id, amount
     FROM financial_entries WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [entryId, householdId],
  );
  const existing = existingRows[0];
  if (!existing) return { status: "error", message: "Lançamento não encontrado." };
  if (existing.entry_type !== "expense") {
    return { status: "error", message: "Só é possível dividir uma despesa, não uma receita." };
  }
  if (existing.installment_plan_id) {
    return { status: "error", message: "Não é possível dividir uma parcela de parcelamento." };
  }

  let siblingIds = [existing.id];
  let total = Number(existing.amount);
  if (existing.split_group_id) {
    const { rows: siblings } = await dbForHousehold<{ id: string; amount: string }>(
      householdId,
      `SELECT id, amount FROM financial_entries
       WHERE household_id = $1 AND split_group_id = $2 AND deleted_at IS NULL`,
      [householdId, existing.split_group_id],
    );
    siblingIds = siblings.map((s) => s.id);
    total = siblings.reduce((sum, s) => sum + Number(s.amount), 0);
  }

  const partsSum = parts.reduce((sum, p) => sum + p.amount, 0);
  if (Math.abs(partsSum - total) > 0.005) {
    return {
      status: "error",
      message: `A soma das partes (${partsSum.toFixed(2)}) precisa ser igual ao valor original (${total.toFixed(2)}).`,
    };
  }

  const awaitingReviewId = await ensureAwaitingReviewCategory(householdId, existing.ledger_id);
  const categoryIds: string[] = [];
  for (const part of parts) {
    const categoryId = part.categoryId ?? awaitingReviewId;
    if (!(await isLeafCategory(householdId, existing.ledger_id, categoryId))) {
      return { status: "error", message: "Categoria inválida — escolha uma categoria-folha deste orçamento." };
    }
    categoryIds.push(categoryId);
  }

  // Grupo de 1 não é mais uma divisão — volta a ser um lançamento normal.
  const newSplitGroupId = parts.length > 1 ? crypto.randomUUID() : null;
  const amounts = parts.map((p) => p.amount);

  const { rows } = await dbForHousehold<{ id: string }>(
    householdId,
    `WITH deleted AS (
       UPDATE financial_entries SET deleted_at = now(), updated_at = now()
       WHERE household_id = $1 AND id = ANY($2::uuid[])
       RETURNING id
     )
     INSERT INTO financial_entries
       (household_id, ledger_id, entry_type, entry_date, description, amount, category_id,
        payment_source_id, input_method, review_status, amount_confidence, created_by, split_group_id)
     SELECT $1, $3, $4, $5, $6, x.amount, x.category_id,
            $7, $8, $9, $10, $11, $12
     FROM unnest($13::numeric[], $14::uuid[]) AS x(amount, category_id)
     RETURNING id`,
    [
      householdId,
      siblingIds,
      existing.ledger_id,
      existing.entry_type,
      existing.entry_date,
      existing.description,
      existing.payment_source_id,
      existing.input_method,
      // Dividir É revisar — a pessoa está ativamente decidindo a categoria
      // de cada parte, então cada parte já sai confirmada.
      "confirmed",
      existing.amount_confidence,
      existing.created_by,
      newSplitGroupId,
      amounts,
      categoryIds,
    ],
  );
  return { status: "split", entryIds: rows.map((r) => r.id) };
}

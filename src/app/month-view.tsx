"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { EntryRow, EntryType } from "@/lib/entries/service";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import { formatMonthLabel, nextMonthKey, previousMonthKey } from "@/lib/date";
import { formatBRL, parseBRLAmount, toAmountInputValue } from "@/lib/format";
import { fetchLedgerLeaves } from "@/lib/client/ledger-categories";
import { ReviewModal } from "./review-modal";

type PaymentSourceTotal = { paymentSourceId: string; paymentSourceName: string; total: number };
type MonthTotals = { gastoTotal: number; creditosTotal: number };
type LeafOption = { id: string; name: string };

type LedgerData = {
  categories: CategorySummaryNode[];
  totals: MonthTotals;
  paymentSourceTotals: PaymentSourceTotal[];
  entries: EntryRow[];
};

function flattenLeafCategories(nodes: CategorySummaryNode[]): CategorySummaryNode[] {
  const out: CategorySummaryNode[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) out.push(node);
    else out.push(...node.children);
  }
  return out;
}

function statusColor(gasto: number, orcado: number): string {
  if (orcado <= 0) return "var(--muted)";
  const pct = gasto / orcado;
  if (pct >= 1) return "var(--status-red)";
  if (pct >= 0.7) return "var(--status-yellow)";
  return "var(--status-green)";
}

type Props = {
  initialMonth: string;
  ledgers: LedgerRow[];
  defaultLedgerId: string;
  initialData: LedgerData;
  paymentSources: PaymentSourceRow[];
};

/**
 * Etapa 3.5 — cada household tem um orçamento "Principal" (sempre expandido,
 * único lugar com lançamento manual/processamento de fatura) e quantos
 * suborçamentos paralelos o usuário quiser criar em /ledgers, cada um com
 * sua própria árvore de categorias e totais, sem influenciar os demais.
 * Suborçamentos vêm recolhidos por padrão — só carregam dados quando
 * expandidos pela primeira vez, pra não pesar o carregamento inicial.
 */
export function MonthView({ initialMonth, ledgers, defaultLedgerId, initialData, paymentSources }: Props) {
  const [month, setMonth] = useState(initialMonth);
  const defaultLedger = ledgers.find((l) => l.id === defaultLedgerId) ?? ledgers[0];
  const otherLedgers = ledgers.filter((l) => l.id !== defaultLedgerId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMonth(previousMonthKey(month))}
            className="min-h-11 min-w-11 rounded-lg border border-border-strong px-3"
          >
            ←
          </button>
          <h2 className="min-w-48 text-center font-serif text-lg text-ink">
            {formatMonthLabel(month)}
          </h2>
          <button
            type="button"
            onClick={() => setMonth(nextMonthKey(month))}
            className="min-h-11 min-w-11 rounded-lg border border-border-strong px-3"
          >
            →
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMonth(nextMonthKey(month))}
          className="min-h-11 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
        >
          Planejar próximo mês →
        </button>
      </div>

      <LedgerPanel
        ledgerId={defaultLedgerId}
        ledgerName={defaultLedger?.name ?? "Principal"}
        month={month}
        ledgers={ledgers}
        paymentSources={paymentSources}
        initialData={initialData}
        showEntryControls
      />

      {otherLedgers.map((ledger) => (
        <CollapsibleLedgerPanel
          key={ledger.id}
          ledger={ledger}
          month={month}
          ledgers={ledgers}
          paymentSources={paymentSources}
        />
      ))}
    </div>
  );
}

function CollapsibleLedgerPanel({
  ledger,
  month,
  ledgers,
  paymentSources,
}: {
  ledger: LedgerRow;
  month: string;
  ledgers: LedgerRow[];
  paymentSources: PaymentSourceRow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-serif text-lg text-ink">{ledger.name}</span>
        <span className="text-sm text-muted">{open ? "▲ recolher" : "▼ expandir"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-6 border-t border-border p-4">
          <LedgerPanel
            ledgerId={ledger.id}
            ledgerName={ledger.name}
            month={month}
            ledgers={ledgers}
            paymentSources={paymentSources}
            showEntryControls={false}
          />
        </div>
      )}
    </div>
  );
}

function LedgerPanel({
  ledgerId,
  month,
  ledgers,
  paymentSources,
  initialData,
  showEntryControls,
}: {
  ledgerId: string;
  ledgerName: string;
  month: string;
  ledgers: LedgerRow[];
  paymentSources: PaymentSourceRow[];
  initialData?: LedgerData;
  showEntryControls: boolean;
}) {
  const [categories, setCategories] = useState<CategorySummaryNode[]>(initialData?.categories ?? []);
  const [totals, setTotals] = useState<MonthTotals>(initialData?.totals ?? { gastoTotal: 0, creditosTotal: 0 });
  const [paymentSourceTotals, setPaymentSourceTotals] = useState<PaymentSourceTotal[]>(
    initialData?.paymentSourceTotals ?? [],
  );
  const [entries, setEntries] = useState<EntryRow[]>(initialData?.entries ?? []);
  const [filterSource, setFilterSource] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [editingBudget, setEditingBudget] = useState<{
    key: string;
    categoryId: string;
    value: string;
  } | null>(null);
  const [editingEntry, setEditingEntry] = useState<{
    id: string;
    entryType: EntryType;
    entryDate: string;
    description: string;
    amount: string;
    categoryId: string;
    paymentSourceId: string;
  } | null>(null);
  const skipNextLoad = useRef(!!initialData);

  const leaves = flattenLeafCategories(categories);
  const orcadoTotal = categories
    .filter((c) => c.categoryType === "normal")
    .reduce((s, c) => s + c.orcado, 0);

  const loadSummary = useCallback(
    async (m: string) => {
      const res = await fetch(`/api/month-summary?month=${m}&ledgerId=${ledgerId}`);
      const data = await res.json();
      setCategories(data.categories ?? []);
      setTotals(data.totals ?? { gastoTotal: 0, creditosTotal: 0 });
      setPaymentSourceTotals(data.paymentSourceTotals ?? []);
    },
    [ledgerId],
  );

  const loadEntries = useCallback(
    async (m: string, sourceId: string) => {
      const qs = new URLSearchParams({ month: m, ledgerId });
      if (sourceId) qs.set("paymentSourceId", sourceId);
      const res = await fetch(`/api/entries?${qs.toString()}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    },
    [ledgerId],
  );

  useEffect(() => {
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      return;
    }
    Promise.all([loadSummary(month), loadEntries(month, filterSource)]);
    // filterSource intentionally excluded — changing it has its own handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerId, month, loadSummary, loadEntries]);

  async function changeFilterSource(sourceId: string) {
    setFilterSource(sourceId);
    await loadEntries(month, sourceId);
  }

  async function copyPreviousBudget() {
    setError(null);
    await fetch("/api/budgets/copy-previous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, ledgerId }),
    });
    await loadSummary(month);
  }

  async function submitBudget(categoryId: string, value: string) {
    const amount = parseBRLAmount(value);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Valor de orçamento inválido.");
      return;
    }
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, month, amount }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar o orçamento.");
      return;
    }
    setEditingBudget(null);
    await loadSummary(month);
  }

  async function submitEntry(input: {
    entryType: EntryType;
    entryDate: string;
    description: string;
    amount: string;
    categoryId: string;
    paymentSourceId: string;
    ledgerId: string;
    installment: { totalInstallments: number; currentInstallmentNumber: number } | null;
  }) {
    setError(null);
    const amount = parseBRLAmount(input.amount);
    const res = input.installment
      ? await fetch("/api/installment-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ledgerId: input.ledgerId,
            description: input.description,
            categoryId: input.categoryId || null,
            paymentSourceId: input.paymentSourceId || null,
            installmentAmount: amount,
            totalInstallments: input.installment.totalInstallments,
            currentInstallmentNumber: input.installment.currentInstallmentNumber,
            currentInstallmentDate: input.entryDate,
          }),
        })
      : await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryType: input.entryType,
            entryDate: input.entryDate,
            description: input.description,
            amount,
            categoryId: input.entryType === "expense" ? input.categoryId : null,
            paymentSourceId: input.paymentSourceId || null,
            ledgerId: input.ledgerId,
          }),
        });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível lançar.");
      return;
    }
    setShowAddEntry(false);
    if (input.ledgerId === ledgerId) {
      await Promise.all([loadSummary(month), loadEntries(month, filterSource)]);
    }
  }

  async function removeEntry(id: string) {
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    await Promise.all([loadSummary(month), loadEntries(month, filterSource)]);
  }

  function startEditEntry(entry: EntryRow) {
    setEditingEntry({
      id: entry.id,
      entryType: entry.entry_type,
      entryDate: entry.entry_date.slice(0, 10),
      description: entry.description,
      amount: toAmountInputValue(Number(entry.amount)),
      categoryId: entry.category_id ?? "",
      paymentSourceId: entry.payment_source_id ?? "",
    });
  }

  async function submitEditEntry() {
    if (!editingEntry) return;
    setError(null);
    const amount = parseBRLAmount(editingEntry.amount);
    const res = await fetch(`/api/entries/${editingEntry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryDate: editingEntry.entryDate,
        description: editingEntry.description,
        amount,
        categoryId: editingEntry.entryType === "expense" ? editingEntry.categoryId || null : null,
        paymentSourceId: editingEntry.paymentSourceId || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar o lançamento.");
      return;
    }
    setEditingEntry(null);
    await Promise.all([loadSummary(month), loadEntries(month, filterSource)]);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
          {error}
        </div>
      )}

      {showEntryControls && (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={copyPreviousBudget}
            className="min-h-11 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
          >
            Copiar orçamento do mês anterior
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Gasto do mês" value={totals.gastoTotal} />
        <MetricCard label="Orçado do mês" value={orcadoTotal} />
        <MetricCard
          label="Créditos do mês"
          value={totals.creditosTotal}
          over={totals.creditosTotal < orcadoTotal}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-lg text-ink">Lançamentos</h3>
          <div className="flex items-center gap-2">
            <select
              value={filterSource}
              onChange={(e) => changeFilterSource(e.target.value)}
              className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
            >
              <option value="">Todas as formas</option>
              {paymentSources.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name}
                </option>
              ))}
            </select>
            {showEntryControls && (
              <>
                <button
                  type="button"
                  onClick={() => setShowReview(true)}
                  className="min-h-11 rounded-lg border border-border-strong px-4 text-sm text-accent-dark"
                >
                  Processar fatura
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddEntry((v) => !v)}
                  className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white"
                >
                  + Novo lançamento
                </button>
              </>
            )}
          </div>
        </div>

        {showAddEntry && (
          <EntryForm
            month={month}
            initialLeaves={leaves}
            ledgers={ledgers}
            defaultLedgerId={ledgerId}
            paymentSources={paymentSources}
            onCancel={() => setShowAddEntry(false)}
            onSubmit={submitEntry}
          />
        )}

        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">Nenhum lançamento neste mês ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Data</th>
                  <th className="py-2">Descrição</th>
                  <th className="py-2">Categoria</th>
                  <th className="py-2">Forma</th>
                  <th className="py-2 text-right">Valor</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) =>
                  editingEntry?.id === entry.id ? (
                    <tr key={entry.id} className="border-t border-border bg-[#FBFAF6]">
                      <td className="py-2 pr-2">
                        <input
                          type="date"
                          value={editingEntry.entryDate}
                          onChange={(e) => setEditingEntry({ ...editingEntry, entryDate: e.target.value })}
                          className="min-h-9 w-full rounded border border-border-strong px-1 text-sm"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          value={editingEntry.description}
                          onChange={(e) => setEditingEntry({ ...editingEntry, description: e.target.value })}
                          className="min-h-9 w-full min-w-32 rounded border border-border-strong px-1 text-sm"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        {editingEntry.entryType === "expense" ? (
                          <select
                            value={editingEntry.categoryId}
                            onChange={(e) =>
                              setEditingEntry({ ...editingEntry, categoryId: e.target.value })
                            }
                            className="min-h-9 w-full rounded border border-border-strong px-1 text-sm"
                          >
                            <option value="">Aguardando Revisão</option>
                            {leaves.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={editingEntry.paymentSourceId}
                          onChange={(e) =>
                            setEditingEntry({ ...editingEntry, paymentSourceId: e.target.value })
                          }
                          className="min-h-9 w-full rounded border border-border-strong px-1 text-sm"
                        >
                          <option value="">Forma de pagamento (opcional)</option>
                          {paymentSources.map((ps) => (
                            <option key={ps.id} value={ps.id}>
                              {ps.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editingEntry.amount}
                          onChange={(e) => setEditingEntry({ ...editingEntry, amount: e.target.value })}
                          className="money min-h-9 w-24 rounded border border-border-strong px-1 text-right text-sm"
                        />
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={submitEditEntry}
                          className="min-h-8 rounded px-2 text-sm text-accent-dark"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEntry(null)}
                          className="min-h-8 rounded px-2 text-sm text-muted"
                        >
                          Cancelar
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={entry.id} className="group border-t border-border">
                      <td className="py-2">{entry.entry_date.slice(0, 10).split("-").reverse().join("/")}</td>
                      <td className="py-2">
                        {entry.description}
                        {entry.installment_plan_id && (
                          <span
                            className="ml-1 text-xs text-muted"
                            title={`Parcela ${entry.installment_number}/${entry.total_installments}`}
                          >
                            🔁
                          </span>
                        )}
                      </td>
                      <td className="py-2">{entry.category_name ?? "—"}</td>
                      <td className="py-2">{entry.payment_source_name ?? "—"}</td>
                      <td
                        className="money py-2 text-right"
                        style={{ color: entry.entry_type === "income" ? "var(--status-green)" : undefined }}
                      >
                        {entry.entry_type === "income" ? "+" : "-"}
                        {formatBRL(Number(entry.amount))}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => startEditEntry(entry)}
                          title="Editar"
                          className="min-h-8 min-w-8 rounded px-2 text-ink-soft opacity-0 group-hover:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.id)}
                          title="Excluir"
                          className="min-h-8 min-w-8 rounded px-2 text-rust"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {categories.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Nenhuma categoria ainda. Crie em &ldquo;Categorias&rdquo;.
          </p>
        )}
        {categories.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-muted">
            <span>Categoria</span>
            <div className="flex items-center gap-4">
              <span className="w-24 text-right">Orçado</span>
              <span className="w-24 text-right">Gasto</span>
              <span className="w-16" aria-hidden />
              <span className="w-2" aria-hidden />
            </div>
          </div>
        )}
        {categories.map((cat) => (
          <CategorySummaryRow
            key={cat.id}
            node={cat}
            depth={0}
            isExpanded={expanded.has(cat.id)}
            onToggleExpand={() => toggleExpanded(cat.id)}
            editingBudget={editingBudget}
            onStartEditBudget={(key, categoryId, current) =>
              setEditingBudget({ key, categoryId, value: current > 0 ? String(current) : "" })
            }
            onChangeEditBudget={(value) => setEditingBudget((e) => (e ? { ...e, value } : e))}
            onCancelEditBudget={() => setEditingBudget(null)}
            onSubmitEditBudget={() =>
              editingBudget && submitBudget(editingBudget.categoryId, editingBudget.value)
            }
          />
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-serif text-lg text-ink">Total por forma de pagamento</h3>
        {paymentSourceTotals.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lançamento com forma de pagamento definida neste mês.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {paymentSourceTotals.map((p) => (
              <li key={p.paymentSourceId} className="flex items-center justify-between text-sm">
                <span className="text-ink-soft">{p.paymentSourceName}</span>
                <span className="money text-ink">{formatBRL(p.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showReview && (
        <ReviewModal
          ledgers={ledgers}
          defaultLedgerId={ledgerId}
          initialLeaves={leaves}
          paymentSources={paymentSources}
          onClose={() => setShowReview(false)}
          onSaved={() => {
            loadSummary(month);
            loadEntries(month, filterSource);
          }}
        />
      )}
    </>
  );
}

function MetricCard({ label, value, over }: { label: string; value: number; over?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`money text-xl ${over ? "text-rust" : "text-ink"}`}>{formatBRL(value)}</p>
    </div>
  );
}

function CategorySummaryRow({
  node,
  depth,
  isExpanded,
  onToggleExpand,
  editingBudget,
  onStartEditBudget,
  onChangeEditBudget,
  onCancelEditBudget,
  onSubmitEditBudget,
}: {
  node: CategorySummaryNode;
  depth: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  editingBudget: { key: string; categoryId: string; value: string } | null;
  onStartEditBudget: (key: string, categoryId: string, current: number) => void;
  onChangeEditBudget: (value: string) => void;
  onCancelEditBudget: () => void;
  onSubmitEditBudget: () => void;
}) {
  const isGroup = node.children.length > 0;
  const pct = node.orcado > 0 ? Math.min(100, Math.round((node.gasto / node.orcado) * 100)) : 0;
  const rowBg =
    node.categoryType === "awaiting_review"
      ? { background: "var(--row-awaiting-bg)" }
      : node.categoryType === "reserve" && node.color
        ? { background: `color-mix(in srgb, ${node.color} 16%, white)` }
        : {};

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
        style={{ paddingLeft: 16 + depth * 24, ...rowBg }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {depth > 0 && <span className="text-muted">↳</span>}
          {node.color && (
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: node.color }} aria-hidden />
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className="truncate border-b border-dotted border-muted text-left text-sm text-ink"
          >
            {node.name}
          </button>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="w-24 text-right">
            {editingBudget?.key === node.id ? (
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={editingBudget.value}
                onChange={(e) => onChangeEditBudget(e.target.value)}
                onBlur={onSubmitEditBudget}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmitEditBudget();
                  if (e.key === "Escape") onCancelEditBudget();
                }}
                className="money w-24 rounded border border-border-strong px-1 text-right"
              />
            ) : isGroup ? (
              <span
                className="money text-muted"
                title="Soma das subcategorias — edite cada subcategoria, ou o “Sem subcategoria” abaixo, para alterar este valor"
              >
                {formatBRL(node.orcado)}
                <sup className="ml-0.5 text-[9px] text-muted" aria-hidden>
                  Σ
                </sup>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onStartEditBudget(node.id, node.id, node.orcado)}
                className="money text-ink-soft underline decoration-dotted"
              >
                {formatBRL(node.orcado)}
              </button>
            )}
          </div>
          {isGroup ? (
            <span
              className="money w-24 text-right text-ink"
              title="Soma das subcategorias — edite ou exclua os lançamentos em “Lançamentos” abaixo para alterar este valor"
            >
              {formatBRL(node.gasto)}
              <sup className="ml-0.5 text-[9px] text-muted" aria-hidden>
                Σ
              </sup>
            </span>
          ) : (
            <span className="money w-24 text-right text-ink">{formatBRL(node.gasto)}</span>
          )}
          <div className="h-2 w-16 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: statusColor(node.gasto, node.orcado) }}
            />
          </div>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: statusColor(node.gasto, node.orcado) }}
            aria-hidden
          />
        </div>
      </div>

      {isExpanded &&
        node.children.map((child) => (
          <CategorySummaryRow
            key={child.id}
            node={child}
            depth={depth + 1}
            isExpanded={false}
            onToggleExpand={() => {}}
            editingBudget={editingBudget}
            onStartEditBudget={onStartEditBudget}
            onChangeEditBudget={onChangeEditBudget}
            onCancelEditBudget={onCancelEditBudget}
            onSubmitEditBudget={onSubmitEditBudget}
          />
        ))}

      {isExpanded && node.direct && (node.direct.gasto > 0 || node.direct.orcado > 0) && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
          style={{ paddingLeft: 16 + (depth + 1) * 24, background: "var(--row-blue-bg)" }}
        >
          <span style={{ color: "var(--row-blue-text)" }}>↳ Sem subcategoria</span>
          <div className="flex items-center gap-4">
            <div className="w-24 text-right">
              {editingBudget?.key === `${node.id}:direct` ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  value={editingBudget.value}
                  onChange={(e) => onChangeEditBudget(e.target.value)}
                  onBlur={onSubmitEditBudget}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSubmitEditBudget();
                    if (e.key === "Escape") onCancelEditBudget();
                  }}
                  className="money w-24 rounded border border-border-strong px-1 text-right"
                />
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onStartEditBudget(`${node.id}:direct`, node.id, node.direct!.orcado)
                  }
                  className="money underline decoration-dotted"
                  style={{ color: "var(--row-blue-text)" }}
                >
                  {formatBRL(node.direct.orcado)}
                </button>
              )}
            </div>
            <span
              className="money w-24 text-right"
              title="Soma dos lançamentos diretos nesta categoria — edite ou exclua em “Lançamentos” abaixo"
            >
              {formatBRL(node.direct.gasto)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryForm({
  month,
  initialLeaves,
  ledgers,
  defaultLedgerId,
  paymentSources,
  onSubmit,
  onCancel,
}: {
  month: string;
  initialLeaves: LeafOption[];
  ledgers: LedgerRow[];
  defaultLedgerId: string;
  paymentSources: PaymentSourceRow[];
  onSubmit: (input: {
    entryType: EntryType;
    entryDate: string;
    description: string;
    amount: string;
    categoryId: string;
    paymentSourceId: string;
    ledgerId: string;
    installment: { totalInstallments: number; currentInstallmentNumber: number } | null;
  }) => void;
  onCancel: () => void;
}) {
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [isInstallment, setIsInstallment] = useState(false);
  const [totalInstallments, setTotalInstallments] = useState("2");
  const [currentInstallmentNumber, setCurrentInstallmentNumber] = useState("1");
  // Default to today only when today actually falls in the month being
  // viewed — otherwise default to day 1 of that month. Always defaulting to
  // "today" silently misfiled entries into the wrong month when adding one
  // while browsing a different month than the current one.
  const [entryDate, setEntryDate] = useState(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return todayIso.slice(0, 7) === month ? todayIso : `${month}-01`;
  });
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [ledgerId, setLedgerId] = useState(defaultLedgerId);
  const [leaves, setLeaves] = useState<LeafOption[]>(initialLeaves);
  const [categoryId, setCategoryId] = useState("");
  const [paymentSourceId, setPaymentSourceId] = useState("");

  async function changeLedger(id: string) {
    setLedgerId(id);
    setCategoryId("");
    setLeaves(id === defaultLedgerId ? initialLeaves : await fetchLedgerLeaves(id));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          entryType,
          entryDate,
          description,
          amount,
          categoryId,
          paymentSourceId,
          ledgerId,
          installment:
            entryType === "expense" && isInstallment
              ? {
                  totalInstallments: Number(totalInstallments),
                  currentInstallmentNumber: Number(currentInstallmentNumber),
                }
              : null,
        });
      }}
      className="mb-4 flex flex-col gap-2 rounded-lg border border-border-strong bg-card p-3"
    >
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="radio"
            checked={entryType === "expense"}
            onChange={() => setEntryType("expense")}
          />
          Despesa
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="radio"
            checked={entryType === "income"}
            onChange={() => setEntryType("income")}
          />
          Crédito
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          required
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
        />
        <input
          type="text"
          required
          placeholder="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-11 min-w-40 flex-1 rounded-lg border border-border-strong px-2 text-sm"
        />
        <input
          type="text"
          inputMode="decimal"
          required
          placeholder={isInstallment ? "Valor da parcela" : "Valor"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="money min-h-11 w-28 rounded-lg border border-border-strong px-2 text-sm"
        />
      </div>

      {entryType === "expense" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={isInstallment}
              onChange={(e) => setIsInstallment(e.target.checked)}
            />
            Compra parcelada
          </label>
          {isInstallment && (
            <>
              <label className="flex items-center gap-1 text-xs text-muted">
                parcela
                <input
                  type="number"
                  min={1}
                  required
                  value={currentInstallmentNumber}
                  onChange={(e) => setCurrentInstallmentNumber(e.target.value)}
                  className="min-h-9 w-14 rounded border border-border-strong px-1 text-center text-sm"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                de
                <input
                  type="number"
                  min={2}
                  required
                  value={totalInstallments}
                  onChange={(e) => setTotalInstallments(e.target.value)}
                  className="min-h-9 w-14 rounded border border-border-strong px-1 text-center text-sm"
                />
              </label>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ledgers.length > 1 && (
          <select
            value={ledgerId}
            onChange={(e) => changeLedger(e.target.value)}
            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
          >
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {entryType === "expense" && (
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="min-h-11 flex-1 rounded-lg border border-border-strong px-2 text-sm"
          >
            <option value="">Categoria... (em branco vai pra Aguardando Revisão)</option>
            {leaves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={paymentSourceId}
          onChange={(e) => setPaymentSourceId(e.target.value)}
          className="min-h-11 flex-1 rounded-lg border border-border-strong px-2 text-sm"
        >
          <option value="">Forma de pagamento (opcional)</option>
          {paymentSources.map((ps) => (
            <option key={ps.id} value={ps.id}>
              {ps.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-sm text-white">
          Lançar
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-4 text-sm text-muted">
          Cancelar
        </button>
      </div>
    </form>
  );
}

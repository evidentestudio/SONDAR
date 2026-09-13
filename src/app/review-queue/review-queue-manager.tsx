"use client";

import { useEffect, useState } from "react";
import type { EntryRow, EntryType } from "@/lib/entries/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import type { CategoryNode } from "@/lib/categories/service";
import { formatBRL, parseBRLAmount, toAmountInputValue } from "@/lib/format";
import { fetchLedgerLeaves } from "@/lib/client/ledger-categories";

type ReviewRow = {
  id: string;
  entryType: EntryType;
  entryDate: string;
  description: string;
  amount: string;
  ledgerId: string;
  categoryId: string;
  paymentSourceId: string;
  reviewStatus: string;
  inputMethod: string;
  savingRule: boolean;
  ruleSavedForCategoryId: string | null;
};

function suggestPattern(description: string): string {
  const tokens = description.split(/[\s*]+/).filter((t) => t.length >= 3);
  return tokens[0] ?? description;
}

function toReviewRow(e: EntryRow): ReviewRow {
  return {
    id: e.id,
    entryType: e.entry_type,
    entryDate: e.entry_date.slice(0, 10),
    description: e.description,
    amount: toAmountInputValue(Number(e.amount)),
    ledgerId: e.ledger_id,
    categoryId: e.category_id ?? "",
    paymentSourceId: e.payment_source_id ?? "",
    reviewStatus: e.review_status,
    inputMethod: e.input_method,
    savingRule: false,
    ruleSavedForCategoryId: null,
  };
}

export function ReviewQueueManager({
  initialEntries,
  ledgers,
  paymentSources,
}: {
  initialEntries: EntryRow[];
  ledgers: LedgerRow[];
  paymentSources: PaymentSourceRow[];
}) {
  const [rows, setRows] = useState<ReviewRow[]>(initialEntries.map(toReviewRow));
  const [treeCache, setTreeCache] = useState<Record<string, CategoryNode[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ledgerIds = Array.from(new Set(initialEntries.map((e) => e.ledger_id)));
    Promise.all(ledgerIds.map((id) => fetchLedgerLeaves(id).then((leaves) => [id, leaves] as const))).then(
      (pairs) => {
        setTreeCache(Object.fromEntries(pairs));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function saveRow(row: ReviewRow) {
    setError(null);
    const amount = parseBRLAmount(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Valor inválido.");
      return;
    }
    const res = await fetch(`/api/entries/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: row.description,
        amount,
        entryDate: row.entryDate,
        categoryId: row.entryType === "expense" ? row.categoryId || null : null,
        paymentSourceId: row.entryType === "expense" ? row.paymentSourceId || null : null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar.");
      return;
    }
    removeRow(row.id);
  }

  async function confirmRow(id: string) {
    setError(null);
    await fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmReview: true }),
    });
    removeRow(id);
  }

  async function deleteRow(id: string) {
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    removeRow(id);
  }

  async function saveRule(row: ReviewRow) {
    if (!row.categoryId) return;
    updateRow(row.id, { savingRule: true });
    const res = await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: suggestPattern(row.description),
        ledgerId: row.ledgerId,
        categoryId: row.categoryId,
        ruleType: row.inputMethod === "ai_audio" ? "spoken_alias" : "invoice_pattern",
      }),
    });
    updateRow(row.id, {
      savingRule: false,
      ruleSavedForCategoryId: res.ok ? row.categoryId : null,
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted">
        Nenhum lançamento pendente de revisão. 🎉
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">{error}</div>
      )}
      {rows.map((row) => {
        const leaves = treeCache[row.ledgerId] ?? [];
        const ledgerName = ledgers.find((l) => l.id === row.ledgerId)?.name ?? "";
        const ruleUpToDate = row.ruleSavedForCategoryId !== null && row.ruleSavedForCategoryId === row.categoryId;
        return (
          <div key={row.id} className="rounded-lg border border-border-strong p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {row.reviewStatus === "possible_duplicate" ? (
                <span
                  className="rounded-full px-3 py-1 text-xs"
                  style={{ background: "var(--row-awaiting-bg)", color: "var(--row-awaiting-text)" }}
                >
                  Possível duplicidade
                </span>
              ) : (
                <span className="rounded-full bg-accent-light px-3 py-1 text-xs text-accent-dark">
                  Revisar categoria
                </span>
              )}
              <span className="text-xs text-muted">{ledgerName}</span>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                Data
                <input
                  type="date"
                  value={row.entryDate}
                  onChange={(e) => updateRow(row.id, { entryDate: e.target.value })}
                  className="min-h-9 rounded border border-border-strong px-1 text-sm"
                />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-xs text-muted">
                Descrição
                <input
                  type="text"
                  value={row.description}
                  onChange={(e) => updateRow(row.id, { description: e.target.value })}
                  className="min-h-9 rounded border border-border-strong px-2 text-sm"
                />
              </label>
              {row.entryType === "expense" && (
                <label className="flex min-w-40 flex-col gap-0.5 text-xs text-muted">
                  Categoria
                  <select
                    value={row.categoryId}
                    onChange={(e) => updateRow(row.id, { categoryId: e.target.value })}
                    className="min-h-9 rounded border border-border-strong px-1 text-sm"
                  >
                    <option value="">Aguardando Revisão</option>
                    {leaves.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {row.entryType === "expense" && (
                <label className="flex min-w-36 flex-col gap-0.5 text-xs text-muted">
                  Forma
                  <select
                    value={row.paymentSourceId}
                    onChange={(e) => updateRow(row.id, { paymentSourceId: e.target.value })}
                    className="min-h-9 rounded border border-border-strong px-1 text-sm"
                  >
                    <option value="">Forma de pagamento (opcional)</option>
                    {paymentSources.map((ps) => (
                      <option key={ps.id} value={ps.id}>
                        {ps.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                Valor
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                  className="money min-h-9 w-24 rounded border border-border-strong px-1 text-right text-sm"
                />
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveRow(row)}
                className="min-h-9 rounded-lg bg-accent px-3 text-sm font-medium text-white"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => confirmRow(row.id)}
                className="min-h-9 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
              >
                Confirmar sem alterar
              </button>
              {row.entryType === "expense" && (
                <button
                  type="button"
                  disabled={!row.categoryId || row.savingRule || ruleUpToDate}
                  onClick={() => saveRule(row)}
                  className="min-h-9 rounded-lg border border-border-strong px-3 text-sm text-accent-dark disabled:opacity-50"
                >
                  {ruleUpToDate ? "Regra salva ✓" : row.savingRule ? "Salvando..." : "Salvar regra"}
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteRow(row.id)}
                className="min-h-9 rounded-lg px-3 text-sm text-rust"
              >
                Excluir
              </button>
              <span className="money ml-auto text-sm text-ink-soft">{formatBRL(parseBRLAmount(row.amount))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

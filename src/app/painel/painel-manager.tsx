"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { EntryRow } from "@/lib/entries/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import type { DashboardFilterRow } from "@/lib/dashboard-filters/service";
import { formatMonthLabel, nextMonthKey, previousMonthKey } from "@/lib/date";
import { formatBRL } from "@/lib/format";

type LeafRow = {
  key: string;
  categoryId: string;
  label: string;
  color: string | null;
  gasto: number;
  orcado: number;
};

function flattenPanelRows(nodes: CategorySummaryNode[]): LeafRow[] {
  const rows: LeafRow[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      rows.push({ key: node.id, categoryId: node.id, label: node.name, color: node.color, gasto: node.gasto, orcado: node.orcado });
      continue;
    }
    for (const child of node.children) {
      rows.push({
        key: child.id,
        categoryId: child.id,
        label: `${node.name} — ${child.name}`,
        color: child.color ?? node.color,
        gasto: child.gasto,
        orcado: child.orcado,
      });
    }
    // Lançamentos/orçamento deixados direto na categoria-mãe de antes dela
    // ganhar subcategorias — nunca somem do painel, viram sua própria linha.
    if (node.direct) {
      rows.push({
        key: `${node.id}-direct`,
        categoryId: node.id,
        label: `${node.name} — sem subcategoria`,
        color: node.color,
        gasto: node.direct.gasto,
        orcado: node.direct.orcado,
      });
    }
  }
  return rows;
}

function statusColor(gasto: number, orcado: number): string {
  if (orcado <= 0) return "var(--muted)";
  const pct = gasto / orcado;
  if (pct >= 1) return "var(--status-red)";
  if (pct >= 0.7) return "var(--status-yellow)";
  return "var(--status-green)";
}

export function PainelManager({
  initialMonth,
  ledgers,
  defaultLedgerId,
  initialCategories,
  initialEntries,
  initialFilters,
}: {
  initialMonth: string;
  ledgers: LedgerRow[];
  defaultLedgerId: string;
  initialCategories: CategorySummaryNode[];
  initialEntries: EntryRow[];
  initialFilters: DashboardFilterRow[];
}) {
  const [month, setMonth] = useState(initialMonth);
  const [ledgerId, setLedgerId] = useState(defaultLedgerId);
  const [categories, setCategories] = useState(initialCategories);
  const [entries, setEntries] = useState(initialEntries);
  const [filters, setFilters] = useState(initialFilters);
  const [error, setError] = useState<string | null>(null);
  const skipNextLoad = useRef(true);

  const [showFilterEditor, setShowFilterEditor] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "custom">("all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [newFilterName, setNewFilterName] = useState("");
  const [savingFilter, setSavingFilter] = useState(false);

  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const rows = flattenPanelRows(categories);
  const visibleRows = filterMode === "all" ? rows : rows.filter((r) => selectedCategoryIds.has(r.categoryId));

  const loadSummary = useCallback(
    async (m: string, l: string) => {
      const res = await fetch(`/api/month-summary?month=${m}&ledgerId=${l}`);
      const data = await res.json();
      setCategories(data.categories ?? []);
    },
    [],
  );

  const loadEntries = useCallback(async (m: string, l: string) => {
    const res = await fetch(`/api/entries?${new URLSearchParams({ month: m, ledgerId: l })}`);
    const data = await res.json();
    setEntries(data.entries ?? []);
  }, []);

  const loadFilters = useCallback(async (l: string) => {
    const res = await fetch(`/api/dashboard-filters?ledgerId=${l}`);
    const data = await res.json();
    setFilters(data.filters ?? []);
  }, []);

  useEffect(() => {
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      return;
    }
    setFilterMode("all");
    setActiveFilterId(null);
    setExpandedCategoryId(null);
    Promise.all([loadSummary(month, ledgerId), loadEntries(month, ledgerId), loadFilters(ledgerId)]);
  }, [month, ledgerId, loadSummary, loadEntries, loadFilters]);

  function applyFilter(filter: DashboardFilterRow) {
    setFilterMode("custom");
    setActiveFilterId(filter.id);
    setSelectedCategoryIds(new Set(filter.category_ids));
    setShowFilterEditor(true);
  }

  function showAllCategories() {
    setFilterMode("all");
    setActiveFilterId(null);
  }

  function startCustomizing() {
    setShowFilterEditor(true);
    if (filterMode === "all") {
      setFilterMode("custom");
      setActiveFilterId(null);
      setSelectedCategoryIds(new Set(rows.map((r) => r.categoryId)));
    }
  }

  function toggleCategory(categoryId: string) {
    setActiveFilterId(null);
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  async function saveCurrentFilter() {
    const name = newFilterName.trim();
    if (!name) return;
    setSavingFilter(true);
    setError(null);
    const res = await fetch("/api/dashboard-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerId, name, categoryIds: Array.from(selectedCategoryIds) }),
    });
    const data = await res.json();
    setSavingFilter(false);
    if (!res.ok) {
      setError(data.error ?? "Não foi possível salvar o filtro.");
      return;
    }
    setNewFilterName("");
    setActiveFilterId(data.filter.id);
    await loadFilters(ledgerId);
  }

  async function removeFilter(id: string) {
    await fetch(`/api/dashboard-filters/${id}`, { method: "DELETE" });
    if (activeFilterId === id) showAllCategories();
    await loadFilters(ledgerId);
  }

  async function downloadAsImage() {
    if (!panelRef.current) return;
    setDownloading(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(panelRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `sondar-painel-${month}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setError("Não foi possível gerar a imagem.");
    } finally {
      setDownloading(false);
    }
  }

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
          <h2 className="min-w-48 text-center font-serif text-lg text-ink">{formatMonthLabel(month)}</h2>
          <button
            type="button"
            onClick={() => setMonth(nextMonthKey(month))}
            className="min-h-11 min-w-11 rounded-lg border border-border-strong px-3"
          >
            →
          </button>
        </div>
        {ledgers.length > 1 && (
          <select
            value={ledgerId}
            onChange={(e) => setLedgerId(e.target.value)}
            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
          >
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={showAllCategories}
          className={`min-h-9 rounded-full px-3 text-sm ${
            filterMode === "all" ? "bg-accent text-white" : "border border-border-strong text-accent-dark"
          }`}
        >
          Todas as categorias
        </button>
        {filters.map((f) => (
          <span
            key={f.id}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm ${
              activeFilterId === f.id ? "bg-accent text-white" : "border border-border-strong text-accent-dark"
            }`}
          >
            <button type="button" onClick={() => applyFilter(f)} className="min-h-7">
              {f.name}
            </button>
            <button
              type="button"
              onClick={() => removeFilter(f.id)}
              title="Excluir filtro"
              className={activeFilterId === f.id ? "text-white" : "text-rust"}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={startCustomizing}
          className="min-h-9 rounded-full border border-border-strong px-3 text-sm text-accent-dark"
        >
          {showFilterEditor ? "▲ Personalizar filtro" : "▼ Personalizar filtro"}
        </button>
        <button
          type="button"
          onClick={downloadAsImage}
          disabled={downloading}
          className="ml-auto min-h-9 rounded-lg border border-border-strong px-3 text-sm text-accent-dark disabled:opacity-50"
        >
          {downloading ? "Gerando..." : "⬇ Baixar como imagem"}
        </button>
      </div>

      {showFilterEditor && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Categorias incluídas no painel
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {rows.map((r) => (
              <label
                key={r.key}
                className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-xs text-ink-soft"
              >
                <input
                  type="checkbox"
                  checked={filterMode === "all" || selectedCategoryIds.has(r.categoryId)}
                  onChange={() => toggleCategory(r.categoryId)}
                />
                {r.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              placeholder='Nome do filtro (ex: "Economizável")'
              className="min-h-9 flex-1 rounded-lg border border-border-strong px-2 text-sm"
            />
            <button
              type="button"
              disabled={savingFilter || filterMode !== "custom" || !newFilterName.trim()}
              onClick={saveCurrentFilter}
              className="min-h-9 rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
            >
              {savingFilter ? "Salvando..." : "Salvar filtro"}
            </button>
          </div>
        </div>
      )}

      <div ref={panelRef} className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-serif text-lg text-ink">Resumo de {formatMonthLabel(month)}</h3>
        {visibleRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nenhuma categoria neste filtro.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleRows.map((row) => {
              const restante = row.orcado - row.gasto;
              const pct = row.orcado > 0 ? Math.min((row.gasto / row.orcado) * 100, 100) : row.gasto > 0 ? 100 : 0;
              const color = statusColor(row.gasto, row.orcado);
              const categoryEntries = entries.filter((e) => e.category_id === row.categoryId);
              return (
                <div key={row.key} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-2 text-ink">
                      {row.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} aria-hidden />}
                      {row.label}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-muted">Orçado: {formatBRL(row.orcado)}</span>
                      <button
                        type="button"
                        onClick={() => setExpandedCategoryId((prev) => (prev === row.categoryId ? null : row.categoryId))}
                        className="money underline decoration-dotted"
                        style={{ color }}
                      >
                        Gasto: {formatBRL(row.gasto)}
                      </button>
                      <span className={restante < 0 ? "money text-rust" : "money text-ink-soft"}>
                        Restante: {formatBRL(restante)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>

                  {expandedCategoryId === row.categoryId && (
                    <div className="mt-2 rounded-lg bg-paper p-2">
                      {categoryEntries.length === 0 ? (
                        <p className="py-2 text-center text-xs text-muted">Nenhum lançamento nesta categoria.</p>
                      ) : (
                        <table className="w-full text-left text-xs">
                          <tbody>
                            {categoryEntries.map((e) => (
                              <tr key={e.id} className="border-t border-border">
                                <td className="py-1 pr-2 text-muted">
                                  {e.entry_date.slice(0, 10).split("-").reverse().join("/")}
                                </td>
                                <td className="py-1 pr-2 text-ink">{e.description}</td>
                                <td className="py-1 pr-2 text-muted">{e.payment_source_name ?? "—"}</td>
                                <td className="money py-1 text-right text-ink">{formatBRL(Number(e.amount))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

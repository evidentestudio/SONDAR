"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { EntryRow } from "@/lib/entries/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import type { DashboardFilterRow } from "@/lib/dashboard-filters/service";
import { formatMonthLabel, nextMonthKey, previousMonthKey } from "@/lib/date";
import { formatBRL } from "@/lib/format";
import { normalizeStr } from "@/lib/text/normalize";

type LeafRow = {
  key: string;
  categoryId: string;
  label: string;
  color: string | null;
  icon: string | null;
  gasto: number;
  orcado: number;
};

// Ícone por palavra-chave no nome — categorias não têm um seletor de ícone
// na UI ainda (o campo existe no banco, mas fica null na prática), então
// isso é só um fallback visual pra não deixar todo círculo igual; usa o
// ícone de verdade da categoria (c.icon) quando ele existir.
const ICON_KEYWORDS: [string, string][] = [
  ["mercado", "🛒"],
  ["rancho", "🛒"],
  ["supermercado", "🛒"],
  ["feira", "🛒"],
  ["acougue", "🛒"],
  ["combustivel", "⛽"],
  ["gasolina", "⛽"],
  ["estacionamento", "🅿️"],
  ["comer fora", "🍴"],
  ["restaurante", "🍴"],
  ["lazer", "🎭"],
  ["assinatura", "💳"],
  ["saude", "❤️"],
  ["farmacia", "❤️"],
  ["transporte", "🚌"],
  ["uber", "🚌"],
  ["negocio", "💼"],
  ["empreendimento", "💼"],
  ["carro", "🚗"],
  ["agua", "💧"],
  ["casa", "🏠"],
  ["educacao", "📚"],
  ["escola", "📚"],
  ["revisao", "🔎"],
];

function fallbackIcon(label: string): string {
  const norm = normalizeStr(label);
  for (const [keyword, icon] of ICON_KEYWORDS) {
    if (norm.includes(keyword)) return icon;
  }
  return "📁";
}

function flattenPanelRows(nodes: CategorySummaryNode[]): LeafRow[] {
  const rows: LeafRow[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      rows.push({
        key: node.id,
        categoryId: node.id,
        label: node.name,
        color: node.color,
        icon: node.icon,
        gasto: node.gasto,
        orcado: node.orcado,
      });
      continue;
    }
    for (const child of node.children) {
      rows.push({
        key: child.id,
        categoryId: child.id,
        label: `${node.name} — ${child.name}`,
        color: child.color ?? node.color,
        icon: child.icon ?? node.icon,
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
        icon: node.icon,
        gasto: node.direct.gasto,
        orcado: node.direct.orcado,
      });
    }
  }
  return rows;
}

/** Sem orçado, qualquer gasto já é "estourado" — nunca fica cinza só porque
 * ninguém orçou aquela categoria ainda. */
function progressPct(gasto: number, orcado: number): number {
  if (orcado <= 0) return gasto > 0 ? 100 : 0;
  return Math.min((gasto / orcado) * 100, 100);
}

function statusColor(gasto: number, orcado: number): string {
  if (orcado <= 0) return gasto > 0 ? "var(--status-red)" : "var(--muted)";
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2">Categoria</th>
                  <th className="pb-2 text-right">Orçado</th>
                  <th className="pb-2 text-right">Gasto</th>
                  <th className="pb-2 text-right">Restante</th>
                  <th className="pb-2 pl-4">Progresso</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const restante = row.orcado - row.gasto;
                  const pct = progressPct(row.gasto, row.orcado);
                  const color = statusColor(row.gasto, row.orcado);
                  const restanteNegative = restante < 0;
                  const categoryEntries = entries.filter((e) => e.category_id === row.categoryId);
                  const isExpanded = expandedCategoryId === row.categoryId;
                  return (
                    <Fragment key={row.key}>
                      <tr className="border-t border-border">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
                              style={{ background: row.color ?? "var(--muted)" }}
                              aria-hidden
                            >
                              {row.icon ?? fallbackIcon(row.label)}
                            </span>
                            <span className="text-ink">{row.label}</span>
                          </div>
                        </td>
                        <td className="money py-2 text-right text-ink-soft">{formatBRL(row.orcado)}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setExpandedCategoryId((prev) => (prev === row.categoryId ? null : row.categoryId))}
                            className="money underline decoration-dotted"
                            style={{ color: row.gasto === 0 ? undefined : color }}
                          >
                            {formatBRL(row.gasto)}
                          </button>
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className="money inline-block rounded-full px-2 py-0.5 text-xs"
                            style={
                              restanteNegative
                                ? { background: "var(--row-awaiting-bg)", color: "var(--row-awaiting-text)" }
                                : { background: "var(--row-blue-bg)", color: "var(--row-blue-text)" }
                            }
                          >
                            {formatBRL(restante)}
                          </span>
                        </td>
                        <td className="py-2 pl-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-paper">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                            </div>
                            <span className="w-10 shrink-0 text-right text-xs text-muted">{Math.round(pct)}%</span>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="bg-paper px-2 py-2">
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
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

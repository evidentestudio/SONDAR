"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { EntryRow } from "@/lib/entries/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import type { DashboardFilterRow } from "@/lib/dashboard-filters/service";
import { formatMonthLabel, nextMonthKey, previousMonthKey } from "@/lib/date";
import { formatBRL, parseBRLAmount } from "@/lib/format";
import type { RedistributionObjective, RedistributionPlan } from "@/lib/radar/redistribution";

type RadarDiagnosisResult = { diagnosis: string; tips: string[]; patterns: string[] };

type PanelRow = {
  key: string;
  /** Categoria-folha de verdade pra linhas normais; para uma linha-mãe é o
   * id da própria categoria-mãe (nunca aparece num filtro salvo — só
   * categorias-folha são filtráveis, ver isLeafCategory no service). */
  categoryId: string;
  label: string;
  color: string | null;
  icon: string | null;
  gasto: number;
  orcado: number;
  isParent: boolean;
  /** false pra linha-mãe e pro "sem subcategoria" (não são categoria-folha,
   * nunca entram na lista de checkboxes do filtro nem num filtro salvo). */
  filterable: boolean;
  children: PanelRow[];
};

function buildPanelRows(nodes: CategorySummaryNode[]): PanelRow[] {
  return nodes.map((node): PanelRow => {
    if (node.children.length === 0) {
      return {
        key: node.id,
        categoryId: node.id,
        label: node.name,
        color: node.color,
        icon: node.icon,
        gasto: node.gasto,
        orcado: node.orcado,
        isParent: false,
        filterable: true,
        children: [],
      };
    }
    const children: PanelRow[] = node.children.map((child) => ({
      key: child.id,
      categoryId: child.id,
      label: child.name,
      color: child.color ?? node.color,
      icon: child.icon ?? node.icon,
      gasto: child.gasto,
      orcado: child.orcado,
      isParent: false,
      filterable: true,
      children: [],
    }));
    // Lançamentos/orçamento deixados direto na categoria-mãe de antes dela
    // ganhar subcategorias — nunca somem do painel, viram sua própria linha
    // ao expandir; não é uma categoria-folha, então nunca é filtrável.
    if (node.direct) {
      children.push({
        key: `${node.id}-direct`,
        categoryId: node.id,
        label: "Sem subcategoria",
        color: node.color,
        icon: node.icon,
        gasto: node.direct.gasto,
        orcado: node.direct.orcado,
        isParent: false,
        filterable: false,
        children: [],
      });
    }
    return {
      key: node.id,
      categoryId: node.id,
      label: node.name,
      color: node.color,
      icon: node.icon,
      gasto: node.gasto,
      orcado: node.orcado,
      isParent: true,
      filterable: false,
      children,
    };
  });
}

/** Lista achatada só das categorias-folha (as únicas filtráveis de verdade)
 * — usada pelos checkboxes do editor de filtro. */
function collectFilterableRows(topRows: PanelRow[]): { key: string; categoryId: string; label: string }[] {
  const out: { key: string; categoryId: string; label: string }[] = [];
  for (const row of topRows) {
    if (!row.isParent) {
      out.push({ key: row.key, categoryId: row.categoryId, label: row.label });
      continue;
    }
    for (const child of row.children) {
      if (!child.filterable) continue;
      out.push({ key: child.key, categoryId: child.categoryId, label: `${row.label} — ${child.label}` });
    }
  }
  return out;
}

function isChildVisible(child: PanelRow, filterMode: "all" | "custom", selected: Set<string>): boolean {
  if (!child.filterable) return true;
  return filterMode === "all" || selected.has(child.categoryId);
}

type DisplayRow = { row: PanelRow; gasto: number; orcado: number; visibleChildren: PanelRow[] };

/**
 * Painel mostra só categorias-mãe por padrão — os valores agregados
 * respeitam o filtro ativo (uma categoria-filha excluída pelo filtro
 * "Economizável" não pode continuar somada no total da mãe, senão o
 * filtro não estaria excluindo nada de verdade).
 */
function computeDisplayRows(
  topRows: PanelRow[],
  filterMode: "all" | "custom",
  selected: Set<string>,
): DisplayRow[] {
  const result: DisplayRow[] = [];
  for (const row of topRows) {
    if (!row.isParent) {
      if (filterMode === "all" || selected.has(row.categoryId)) {
        result.push({ row, gasto: row.gasto, orcado: row.orcado, visibleChildren: [] });
      }
      continue;
    }
    const visibleChildren = row.children.filter((c) => isChildVisible(c, filterMode, selected));
    if (visibleChildren.length === 0) continue;
    result.push({
      row,
      gasto: visibleChildren.reduce((s, c) => s + c.gasto, 0),
      orcado: visibleChildren.reduce((s, c) => s + c.orcado, 0),
      visibleChildren,
    });
  }
  return result;
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
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [radarResult, setRadarResult] = useState<RadarDiagnosisResult | null>(null);

  const [showRedistribute, setShowRedistribute] = useState(false);
  const [redistObjective, setRedistObjective] = useState<RedistributionObjective>("nao_estourar");
  const [redistTargetAmount, setRedistTargetAmount] = useState("");
  const [redistSelected, setRedistSelected] = useState<Set<string>>(new Set());
  const [redistPlan, setRedistPlan] = useState<RedistributionPlan | null>(null);
  const [redistLoading, setRedistLoading] = useState(false);
  const [redistApplying, setRedistApplying] = useState(false);

  const topRows = buildPanelRows(categories);
  const filterableRows = collectFilterableRows(topRows);
  const displayRows = computeDisplayRows(topRows, filterMode, selectedCategoryIds);

  function toggleParent(categoryId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

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
    setExpandedParents(new Set());
    setRadarResult(null);
    setRadarError(null);
    setShowRedistribute(false);
    setRedistSelected(new Set());
    setRedistPlan(null);
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
      setSelectedCategoryIds(new Set(filterableRows.map((r) => r.categoryId)));
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

  /** Sempre sob pedido — nunca chamado automaticamente ao abrir o Painel,
   * decisão explícita do usuário pra manter o custo de IA sob controle. */
  async function generateRadarDiagnosis() {
    setRadarLoading(true);
    setRadarError(null);
    const res = await fetch("/api/radar/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerId, month }),
    });
    const data = await res.json();
    setRadarLoading(false);
    if (!res.ok) {
      setRadarError(data.error ?? "Não foi possível gerar o diagnóstico.");
      return;
    }
    setRadarResult(data);
  }

  function toggleRedistCategory(categoryId: string) {
    setRedistSelected((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
    setRedistPlan(null);
  }

  async function calculateRedistribution() {
    setRedistLoading(true);
    setError(null);
    const targetAmount = redistObjective === "economizar" ? parseBRLAmount(redistTargetAmount) : null;
    const res = await fetch("/api/radar/redistribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledgerId,
        month,
        objective: redistObjective,
        targetAmount,
        categoryIds: Array.from(redistSelected),
        apply: false,
      }),
    });
    const data = await res.json();
    setRedistLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Não foi possível calcular a redistribuição.");
      return;
    }
    setRedistPlan(data.plan);
  }

  async function applyRedistribution() {
    if (!redistPlan || redistPlan.status !== "ok") return;
    setRedistApplying(true);
    const targetAmount = redistObjective === "economizar" ? parseBRLAmount(redistTargetAmount) : null;
    const res = await fetch("/api/radar/redistribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledgerId,
        month,
        objective: redistObjective,
        targetAmount,
        categoryIds: Array.from(redistSelected),
        apply: true,
      }),
    });
    const data = await res.json();
    setRedistApplying(false);
    if (!res.ok) {
      setError(data.error ?? "Não foi possível aplicar a redistribuição.");
      return;
    }
    setRedistPlan(null);
    setShowRedistribute(false);
    setRedistSelected(new Set());
    await loadSummary(month, ledgerId);
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
            {filterableRows.map((r) => (
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
        {displayRows.length === 0 ? (
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
                {displayRows.map(({ row, gasto, orcado, visibleChildren }) => {
                  const isParentExpanded = expandedParents.has(row.categoryId);
                  const isLeafExpanded = !row.isParent && expandedCategoryId === row.categoryId;
                  const leafEntries = row.isParent ? [] : entries.filter((e) => e.category_id === row.categoryId);
                  return (
                    <Fragment key={row.key}>
                      <tr className="border-t border-border">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2">
                            {row.isParent && (
                              <button
                                type="button"
                                onClick={() => toggleParent(row.categoryId)}
                                title={isParentExpanded ? "Recolher subcategorias" : "Ver subcategorias"}
                                className="min-h-6 min-w-6 text-muted"
                              >
                                {isParentExpanded ? "▾" : "▸"}
                              </button>
                            )}
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
                              style={{ background: row.color ?? "var(--muted)" }}
                              aria-hidden
                            >
                              {row.icon}
                            </span>
                            <span className="text-ink">{row.label}</span>
                          </div>
                        </td>
                        <PanelStatCells
                          gasto={gasto}
                          orcado={orcado}
                          gastoClickable={!row.isParent}
                          onGastoClick={() =>
                            setExpandedCategoryId((prev) => (prev === row.categoryId ? null : row.categoryId))
                          }
                        />
                      </tr>
                      {isLeafExpanded && (
                        <tr>
                          <td colSpan={5} className="bg-paper px-2 py-2">
                            <EntriesList entries={leafEntries} />
                          </td>
                        </tr>
                      )}
                      {row.isParent &&
                        isParentExpanded &&
                        visibleChildren.map((child) => {
                          const childExpanded = expandedCategoryId === child.categoryId;
                          const childEntries = entries.filter((e) => e.category_id === child.categoryId);
                          return (
                            <Fragment key={child.key}>
                              <tr className="border-t border-border">
                                <td className="py-2 pr-2 pl-9">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
                                      style={{ background: child.color ?? "var(--muted)" }}
                                      aria-hidden
                                    >
                                      {child.icon}
                                    </span>
                                    <span className="text-ink-soft">{child.label}</span>
                                  </div>
                                </td>
                                <PanelStatCells
                                  gasto={child.gasto}
                                  orcado={child.orcado}
                                  gastoClickable
                                  onGastoClick={() =>
                                    setExpandedCategoryId((prev) => (prev === child.categoryId ? null : child.categoryId))
                                  }
                                />
                              </tr>
                              {childExpanded && (
                                <tr>
                                  <td colSpan={5} className="bg-paper px-2 py-2 pl-9">
                                    <EntriesList entries={childEntries} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-lg text-ink">🔎 Radar Financeiro</h3>
          <button
            type="button"
            onClick={generateRadarDiagnosis}
            disabled={radarLoading}
            className="min-h-9 rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
          >
            {radarLoading ? "Gerando..." : radarResult ? "Atualizar diagnóstico" : "Gerar diagnóstico"}
          </button>
        </div>
        {radarError && (
          <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">{radarError}</div>
        )}
        {!radarResult && !radarLoading && !radarError && (
          <p className="text-sm text-muted">
            Clique em &ldquo;Gerar diagnóstico&rdquo; pra ver como está a saúde do orçamento deste mês, dicas de
            reorganização e padrões de consumo identificados no histórico.
          </p>
        )}
        {radarResult && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-ink-soft">{radarResult.diagnosis}</p>
            {radarResult.tips.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Dicas</p>
                <ul className="list-disc pl-5 text-ink-soft">
                  {radarResult.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
            {radarResult.patterns.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Padrões identificados</p>
                <ul className="list-disc pl-5 text-ink-soft">
                  {radarResult.patterns.map((pattern, i) => (
                    <li key={i}>{pattern}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-lg text-ink">Redistribuir orçados</h3>
          <button
            type="button"
            onClick={() => setShowRedistribute((v) => !v)}
            className="min-h-9 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
          >
            {showRedistribute ? "▲ Fechar" : "▼ Redistribuir"}
          </button>
        </div>
        {showRedistribute && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="radio"
                  checked={redistObjective === "nao_estourar"}
                  onChange={() => {
                    setRedistObjective("nao_estourar");
                    setRedistPlan(null);
                  }}
                />
                Não estourar a meta
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="radio"
                  checked={redistObjective === "economizar"}
                  onChange={() => {
                    setRedistObjective("economizar");
                    setRedistPlan(null);
                  }}
                />
                Economizar
                <input
                  type="text"
                  value={redistTargetAmount}
                  onChange={(e) => {
                    setRedistTargetAmount(e.target.value);
                    setRedistPlan(null);
                  }}
                  onFocus={() => setRedistObjective("economizar")}
                  placeholder="R$ 0,00"
                  className="min-h-9 w-28 rounded-lg border border-border-strong px-2 text-sm"
                />
              </label>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Categorias que podem ser ajustadas
              </p>
              <div className="flex flex-wrap gap-2">
                {filterableRows.map((r) => (
                  <label
                    key={r.key}
                    className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-xs text-ink-soft"
                  >
                    <input
                      type="checkbox"
                      checked={redistSelected.has(r.categoryId)}
                      onChange={() => toggleRedistCategory(r.categoryId)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={calculateRedistribution}
              disabled={
                redistLoading ||
                redistSelected.size === 0 ||
                (redistObjective === "economizar" && !redistTargetAmount.trim())
              }
              className="min-h-9 self-start rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
            >
              {redistLoading ? "Calculando..." : "Calcular redistribuição"}
            </button>

            {redistPlan?.status === "infeasible" && (
              <div className="rounded-lg border border-rust bg-rust-light px-3 py-2 text-sm text-rust">
                {redistPlan.message}
              </div>
            )}

            {redistPlan?.status === "ok" && (
              <div className="flex flex-col gap-2">
                {redistPlan.items.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nenhuma categoria selecionada está estourada — nada pra redistribuir.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[420px] text-left text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-muted">
                            <th className="pb-1">Categoria</th>
                            <th className="pb-1 text-right">Orçado atual</th>
                            <th className="pb-1 text-right">Novo orçado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {redistPlan.items.map((item) => (
                            <tr key={item.categoryId} className="border-t border-border">
                              <td className="py-1 text-ink-soft">{item.label}</td>
                              <td className="money py-1 text-right text-ink-soft">{formatBRL(item.oldOrcado)}</td>
                              <td className="money py-1 text-right text-ink">{formatBRL(item.newOrcado)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={applyRedistribution}
                      disabled={redistApplying}
                      className="min-h-9 self-start rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
                    >
                      {redistApplying ? "Aplicando..." : "Aplicar redistribuição"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelStatCells({
  gasto,
  orcado,
  gastoClickable,
  onGastoClick,
}: {
  gasto: number;
  orcado: number;
  gastoClickable: boolean;
  onGastoClick: () => void;
}) {
  const restante = orcado - gasto;
  const pct = progressPct(gasto, orcado);
  const color = statusColor(gasto, orcado);
  const restanteNegative = restante < 0;
  return (
    <>
      <td className="money py-2 text-right text-ink-soft">{formatBRL(orcado)}</td>
      <td className="py-2 text-right">
        {gastoClickable ? (
          <button
            type="button"
            onClick={onGastoClick}
            className="money underline decoration-dotted"
            style={{ color: gasto === 0 ? undefined : color }}
          >
            {formatBRL(gasto)}
          </button>
        ) : (
          <span className="money" style={{ color: gasto === 0 ? undefined : color }}>
            {formatBRL(gasto)}
          </span>
        )}
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
    </>
  );
}

function EntriesList({ entries }: { entries: EntryRow[] }) {
  if (entries.length === 0) {
    return <p className="py-2 text-center text-xs text-muted">Nenhum lançamento nesta categoria.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-t border-border">
            <td className="py-1 pr-2 text-muted">{e.entry_date.slice(0, 10).split("-").reverse().join("/")}</td>
            <td className="py-1 pr-2 text-ink">{e.description}</td>
            <td className="py-1 pr-2 text-muted">{e.payment_source_name ?? "—"}</td>
            <td className="money py-1 text-right text-ink">{formatBRL(Number(e.amount))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

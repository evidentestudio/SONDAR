"use client";

import { useState } from "react";
import type { MerchantRuleRow } from "@/lib/merchant-rules/service";
import type { CategoryRow } from "@/lib/categories/service";

export function MerchantRuleManager({
  initialRules,
  leaves,
}: {
  initialRules: MerchantRuleRow[];
  leaves: CategoryRow[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState(leaves[0]?.id ?? "");
  const [isAmbiguous, setIsAmbiguous] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    pattern: string;
    categoryId: string;
    isAmbiguous: boolean;
  } | null>(null);

  async function refetch() {
    const res = await fetch("/api/merchant-rules");
    const data = await res.json();
    setRules(data.rules ?? []);
  }

  async function submitCreate() {
    setError(null);
    const res = await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern, categoryId, isAmbiguous }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar.");
      return;
    }
    setPattern("");
    setIsAmbiguous(false);
    setAdding(false);
    await refetch();
  }

  async function submitEdit() {
    if (!editing) return;
    setError(null);
    const res = await fetch(`/api/merchant-rules/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: editing.pattern,
        categoryId: editing.categoryId,
        isAmbiguous: editing.isAmbiguous,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar.");
      return;
    }
    setEditing(null);
    await refetch();
  }

  async function remove(id: string) {
    await fetch(`/api/merchant-rules/${id}`, { method: "DELETE" });
    await refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdding((v) => !v)}
        className="min-h-11 w-fit rounded-lg bg-accent px-4 text-sm font-medium text-white"
      >
        + Nova regra
      </button>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-card p-3"
        >
          <input
            type="text"
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Padrão (ex: ifood)"
            className="min-h-11 min-w-40 flex-1 rounded-lg border border-border-strong px-3 text-sm outline-none focus:border-accent"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
          >
            {leaves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={isAmbiguous}
              onChange={(e) => setIsAmbiguous(e.target.checked)}
            />
            sempre ambíguo
          </label>
          <button type="submit" className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white">
            Adicionar
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="min-h-11 rounded-lg px-3 text-sm text-muted"
          >
            Cancelar
          </button>
        </form>
      )}

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {rules.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma regra ainda.</p>
        )}
        {rules.map((rule) =>
          editing?.id === rule.id ? (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 last:border-b-0"
            >
              <input
                type="text"
                autoFocus
                value={editing.pattern}
                onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                className="min-h-11 min-w-40 flex-1 rounded-lg border border-border-strong px-3 text-sm"
              />
              <select
                value={editing.categoryId}
                onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
                className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
              >
                {leaves.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={editing.isAmbiguous}
                  onChange={(e) => setEditing({ ...editing, isAmbiguous: e.target.checked })}
                />
                sempre ambíguo
              </label>
              <button
                type="button"
                onClick={submitEdit}
                className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-11 rounded-lg px-3 text-sm text-muted"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div
              key={rule.id}
              className="group flex items-center justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0 hover:bg-[#FBFAF6]"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{rule.pattern}</span>
                <span className="text-muted">→</span>
                <span className="text-ink-soft">{rule.category_name}</span>
                {rule.is_ambiguous && (
                  <span className="rounded-full bg-rust-light px-2 py-0.5 text-xs text-rust">
                    sempre ambíguo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: rule.id,
                      pattern: rule.pattern,
                      categoryId: rule.category_id,
                      isAmbiguous: rule.is_ambiguous,
                    })
                  }
                  className="min-h-8 min-w-8 rounded px-2 text-ink-soft"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => remove(rule.id)}
                  className="min-h-8 min-w-8 rounded px-2 text-rust"
                >
                  ×
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

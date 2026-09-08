"use client";

import { useState } from "react";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";

export function PaymentSourceManager({ initialSources }: { initialSources: PaymentSourceRow[] }) {
  const [sources, setSources] = useState(initialSources);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2F6F5E");
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

  async function refetch() {
    const res = await fetch("/api/payment-sources");
    const data = await res.json();
    setSources(data.sources ?? []);
  }

  async function submitCreate() {
    setError(null);
    const res = await fetch("/api/payment-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar.");
      return;
    }
    setName("");
    setAdding(false);
    await refetch();
  }

  async function submitEdit() {
    if (!editing) return;
    setError(null);
    const res = await fetch(`/api/payment-sources/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, color: editing.color }),
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
    await fetch(`/api/payment-sources/${id}`, { method: "DELETE" });
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
        + Nova forma de pagamento
      </button>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
          className="flex items-center gap-2 rounded-lg border border-border-strong bg-card p-2"
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-9 shrink-0 cursor-pointer rounded"
          />
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da forma de pagamento"
            className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm outline-none focus:border-accent"
          />
          <button type="submit" className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white">
            Adicionar
          </button>
          <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-lg px-3 text-sm text-muted">
            Cancelar
          </button>
        </form>
      )}

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {sources.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma forma de pagamento ainda.</p>
        )}
        {sources.map((s) =>
          editing?.id === s.id ? (
            <div key={s.id} className="flex items-center gap-2 border-b border-border px-4 py-2 last:border-b-0">
              <input
                type="color"
                value={editing.color}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded"
              />
              <input
                type="text"
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm"
              />
              <button type="button" onClick={submitEdit} className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white">
                Salvar
              </button>
              <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-lg px-3 text-sm text-muted">
                Cancelar
              </button>
            </div>
          ) : (
            <div
              key={s.id}
              className="group flex items-center justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0 hover:bg-[#FBFAF6]"
            >
              <div className="flex items-center gap-2">
                {s.color && <span className="h-3 w-3 rounded-full" style={{ background: s.color }} aria-hidden />}
                <span className="text-sm text-ink">{s.name}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditing({ id: s.id, name: s.name, color: s.color ?? "#2F6F5E" })}
                  className="min-h-8 min-w-8 rounded px-2 text-ink-soft"
                >
                  ✎
                </button>
                <button type="button" onClick={() => remove(s.id)} className="min-h-8 min-w-8 rounded px-2 text-rust">
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

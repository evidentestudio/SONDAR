"use client";

import { useState } from "react";
import type { LedgerRow } from "@/lib/ledgers/service";

export function LedgerManager({ initialLedgers }: { initialLedgers: LedgerRow[] }) {
  const [ledgers, setLedgers] = useState(initialLedgers);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function refetch() {
    const res = await fetch("/api/ledgers");
    const data = await res.json();
    setLedgers(data.ledgers ?? []);
  }

  async function submitCreate() {
    setError(null);
    const res = await fetch("/api/ledgers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
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
    const res = await fetch(`/api/ledgers/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name }),
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
    setError(null);
    const res = await fetch(`/api/ledgers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível excluir.");
      return;
    }
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
        + Novo orçamento
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
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do orçamento (ex: Reserva de Emergência)"
            className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm outline-none focus:border-accent"
          />
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
        {ledgers.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">Nenhum orçamento ainda.</p>
        )}
        {ledgers.map((l) =>
          editing?.id === l.id ? (
            <div key={l.id} className="flex items-center gap-2 border-b border-border px-4 py-2 last:border-b-0">
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
              key={l.id}
              className="group flex items-center justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0 hover:bg-[#FBFAF6]"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink">{l.name}</span>
                {l.is_default && (
                  <span className="rounded-full bg-accent-light px-2 py-0.5 text-xs text-accent-dark">
                    principal
                  </span>
                )}
              </div>
              {!l.is_default && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditing({ id: l.id, name: l.name })}
                    className="min-h-8 min-w-8 rounded px-2 text-ink-soft"
                  >
                    ✎
                  </button>
                  <button type="button" onClick={() => remove(l.id)} className="min-h-8 min-w-8 rounded px-2 text-rust">
                    ×
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

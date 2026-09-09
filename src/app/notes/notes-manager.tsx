"use client";

import { useState } from "react";
import type { NoteRow } from "@/lib/notes/service";

export function NotesManager({ initialNotes }: { initialNotes: NoteRow[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState("");

  async function refetch() {
    const res = await fetch("/api/notes");
    const data = await res.json();
    setNotes(data.notes ?? []);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setContent("");
    await refetch();
  }

  async function toggleDone(note: NoteRow) {
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDone: !note.is_done }),
    });
    await refetch();
  }

  async function remove(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    await refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submitCreate} className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Nova nota ou ideia..."
          className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white">
          Adicionar
        </button>
      </form>

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {notes.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma nota ainda.</p>
        )}
        {notes.map((note) => (
          <div
            key={note.id}
            className="group flex items-center justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0"
          >
            <label className="flex flex-1 items-center gap-2 text-sm">
              <input type="checkbox" checked={note.is_done} onChange={() => toggleDone(note)} />
              <span className={note.is_done ? "text-muted line-through" : "text-ink"}>{note.content}</span>
              <span className="shrink-0 text-xs text-muted">
                {new Date(note.created_at).toLocaleDateString("pt-BR")}
              </span>
            </label>
            <button
              type="button"
              onClick={() => remove(note.id)}
              className="min-h-8 min-w-8 rounded px-2 text-rust opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

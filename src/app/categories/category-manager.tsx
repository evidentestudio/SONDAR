"use client";

import { useState } from "react";
import type { CategoryNode } from "@/lib/categories/service";

type Props = {
  initialCategories: CategoryNode[];
};

type PendingCreate = {
  name: string;
  color: string | null;
  parentId: string | null;
  categoryType: "normal" | "reserve";
};

type Collision = {
  pending: PendingCreate;
  existingName: string;
};

type DeleteState = {
  id: string;
  step: "confirm" | "decision";
  entryCount?: number;
  moveToCategoryId?: string;
};

const RESERVE_DEFAULT_COLOR = "#6B3FA0";

function flattenLeaves(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) out.push(node);
    else out.push(...node.children);
  }
  return out;
}

function rowBackground(node: CategoryNode): React.CSSProperties {
  if (node.category_type === "awaiting_review") {
    return { background: "var(--row-awaiting-bg)" };
  }
  if (node.category_type === "reserve" && node.color) {
    return { background: `color-mix(in srgb, ${node.color} 16%, white)` };
  }
  return {};
}

export function CategoryManager({ initialCategories }: Props) {
  const [categories, setCategories] = useState<CategoryNode[]>(initialCategories);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [addingTopLevel, setAddingTopLevel] = useState(false);
  const [addingReserve, setAddingReserve] = useState(false);
  const [addingSubcategoryFor, setAddingSubcategoryFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [collision, setCollision] = useState<Collision | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);

  async function refetch() {
    const res = await fetch("/api/categories");
    const data = await res.json();
    setCategories(data.categories ?? []);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitCreate(pending: PendingCreate, confirmMerge = false) {
    setError(null);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: pending.name,
        color: pending.color,
        parentId: pending.parentId,
        categoryType: pending.categoryType,
        confirmMerge,
      }),
    });

    if (res.status === 409) {
      const data = await res.json();
      setCollision({ pending, existingName: data.existing.name });
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar a categoria.");
      return;
    }

    setCollision(null);
    setAddingTopLevel(false);
    setAddingReserve(false);
    setAddingSubcategoryFor(null);
    await refetch();
  }

  async function submitUpdate(id: string, name: string, color: string) {
    setError(null);
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: color || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar.");
      return;
    }
    setEditing(null);
    await refetch();
  }

  async function submitDelete(id: string, decision?: { onEntries: "move" | "delete"; moveToCategoryId?: string }) {
    setError(null);
    const res = await fetch(`/api/categories/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision ?? {}),
    });

    if (res.status === 409) {
      const data = await res.json();
      setDeleteState({ id, step: "decision", entryCount: data.entryCount });
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível excluir.");
      setDeleteState(null);
      return;
    }

    setDeleteState(null);
    await refetch();
  }

  const leaves = flattenLeaves(categories);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setAddingTopLevel((v) => !v);
            setAddingReserve(false);
          }}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white"
          style={{ touchAction: "manipulation" }}
        >
          + Nova categoria
        </button>
        <button
          type="button"
          onClick={() => {
            setAddingReserve((v) => !v);
            setAddingTopLevel(false);
          }}
          className="min-h-11 rounded-lg border border-border-strong px-4 text-sm font-medium text-reserve"
          style={{ touchAction: "manipulation" }}
        >
          + Nova Reserva
        </button>
      </div>

      {addingTopLevel && (
        <InlineCategoryForm
          placeholder="Nome da categoria"
          defaultColor="#2F6F5E"
          onCancel={() => setAddingTopLevel(false)}
          onSubmit={(name, color) =>
            submitCreate({ name, color, parentId: null, categoryType: "normal" })
          }
        />
      )}

      {addingReserve && (
        <InlineCategoryForm
          placeholder="Nome da reserva"
          defaultColor={RESERVE_DEFAULT_COLOR}
          onCancel={() => setAddingReserve(false)}
          onSubmit={(name, color) =>
            submitCreate({ name, color, parentId: null, categoryType: "reserve" })
          }
        />
      )}

      {collision && (
        <div className="rounded-lg border border-border-strong bg-card px-4 py-3 text-sm">
          <p className="mb-2 text-ink-soft">
            Já existe uma categoria chamada <strong>&ldquo;{collision.existingName}&rdquo;</strong>. Confirmar
            transforma ela em subcategoria aqui, mantendo os lançamentos que já tiver — nada é
            duplicado.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submitCreate(collision.pending, true)}
              className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white"
            >
              Confirmar fusão
            </button>
            <button
              type="button"
              onClick={() => setCollision(null)}
              className="min-h-11 rounded-lg px-3 text-sm text-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {categories.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Nenhuma categoria ainda. Crie a primeira acima.
          </p>
        )}

        {categories.map((cat) => (
          <div key={cat.id} className="border-b border-border last:border-b-0">
            <CategoryRow
              node={cat}
              depth={0}
              isExpanded={expanded.has(cat.id)}
              onToggleExpand={() => toggleExpanded(cat.id)}
              canAddSubcategory={cat.category_type === "normal"}
              onAddSubcategory={() =>
                setAddingSubcategoryFor((v) => (v === cat.id ? null : cat.id))
              }
              editing={editing?.id === cat.id ? editing : null}
              onStartEdit={() => setEditing({ id: cat.id, name: cat.name, color: cat.color ?? "" })}
              onChangeEdit={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))}
              onCancelEdit={() => setEditing(null)}
              onSubmitEdit={() => editing && submitUpdate(editing.id, editing.name, editing.color)}
              deleteState={deleteState?.id === cat.id ? deleteState : null}
              onStartDelete={() => setDeleteState({ id: cat.id, step: "confirm" })}
              onCancelDelete={() => setDeleteState(null)}
              onConfirmDelete={() => submitDelete(cat.id)}
              onChooseMoveTarget={(moveToCategoryId) =>
                setDeleteState((s) => (s ? { ...s, moveToCategoryId } : s))
              }
              onSubmitDecision={(onEntries) =>
                submitDelete(cat.id, {
                  onEntries,
                  moveToCategoryId: deleteState?.moveToCategoryId,
                })
              }
              leaves={leaves.filter((l) => l.id !== cat.id)}
            />

            {addingSubcategoryFor === cat.id && (
              <div className="px-4 pb-3 pl-10">
                <InlineCategoryForm
                  placeholder="Nome da subcategoria"
                  defaultColor="#2F6F5E"
                  onCancel={() => setAddingSubcategoryFor(null)}
                  onSubmit={(name, color) =>
                    submitCreate({ name, color, parentId: cat.id, categoryType: "normal" })
                  }
                />
              </div>
            )}

            {cat.children.length > 0 &&
              cat.children.map((child) => (
                <CategoryRow
                  key={child.id}
                  node={child}
                  depth={1}
                  isExpanded={expanded.has(child.id)}
                  onToggleExpand={() => toggleExpanded(child.id)}
                  canAddSubcategory={false}
                  onAddSubcategory={() => {}}
                  editing={editing?.id === child.id ? editing : null}
                  onStartEdit={() =>
                    setEditing({ id: child.id, name: child.name, color: child.color ?? "" })
                  }
                  onChangeEdit={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))}
                  onCancelEdit={() => setEditing(null)}
                  onSubmitEdit={() =>
                    editing && submitUpdate(editing.id, editing.name, editing.color)
                  }
                  deleteState={deleteState?.id === child.id ? deleteState : null}
                  onStartDelete={() => setDeleteState({ id: child.id, step: "confirm" })}
                  onCancelDelete={() => setDeleteState(null)}
                  onConfirmDelete={() => submitDelete(child.id)}
                  onChooseMoveTarget={(moveToCategoryId) =>
                    setDeleteState((s) => (s ? { ...s, moveToCategoryId } : s))
                  }
                  onSubmitDecision={(onEntries) =>
                    submitDelete(child.id, {
                      onEntries,
                      moveToCategoryId: deleteState?.moveToCategoryId,
                    })
                  }
                  leaves={leaves.filter((l) => l.id !== child.id)}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineCategoryForm({
  placeholder,
  defaultColor,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  defaultColor: string;
  onSubmit: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit(name, color);
      }}
      className="flex items-center gap-2 rounded-lg border border-border-strong bg-card p-2"
    >
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-9 shrink-0 cursor-pointer rounded"
        aria-label="Cor"
      />
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm text-ink outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white"
        style={{ touchAction: "manipulation" }}
      >
        Adicionar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-lg px-3 text-sm text-muted"
        style={{ touchAction: "manipulation" }}
      >
        Cancelar
      </button>
    </form>
  );
}

function CategoryRow({
  node,
  depth,
  isExpanded,
  onToggleExpand,
  canAddSubcategory,
  onAddSubcategory,
  editing,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSubmitEdit,
  deleteState,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onChooseMoveTarget,
  onSubmitDecision,
  leaves,
}: {
  node: CategoryNode;
  depth: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  canAddSubcategory: boolean;
  onAddSubcategory: () => void;
  editing: { id: string; name: string; color: string } | null;
  onStartEdit: () => void;
  onChangeEdit: (patch: Partial<{ name: string; color: string }>) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  deleteState: DeleteState | null;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onChooseMoveTarget: (id: string) => void;
  onSubmitDecision: (onEntries: "move" | "delete") => void;
  leaves: CategoryNode[];
}) {
  const textClass =
    node.category_type === "awaiting_review" ? "font-bold" : "text-ink";

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2" style={{ paddingLeft: 16 + depth * 24 }}>
        <input
          type="color"
          value={editing.color || "#2F6F5E"}
          onChange={(e) => onChangeEdit({ color: e.target.value })}
          className="h-9 w-9 shrink-0 cursor-pointer rounded"
        />
        <input
          type="text"
          autoFocus
          value={editing.name}
          onChange={(e) => onChangeEdit({ name: e.target.value })}
          className="min-h-11 flex-1 rounded-lg border border-border-strong px-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onSubmitEdit}
          className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white"
        >
          Salvar
        </button>
        <button type="button" onClick={onCancelEdit} className="min-h-11 rounded-lg px-3 text-sm text-muted">
          Cancelar
        </button>
      </div>
    );
  }

  if (deleteState?.step === "confirm") {
    return (
      <div
        className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
        style={{ paddingLeft: 16 + depth * 24 }}
      >
        <span>Excluir &ldquo;{node.name}&rdquo;?</span>
        <div className="flex gap-2">
          <button type="button" onClick={onConfirmDelete} className="min-h-11 rounded-lg bg-rust px-3 text-white">
            Confirmar
          </button>
          <button type="button" onClick={onCancelDelete} className="min-h-11 rounded-lg px-3 text-muted">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (deleteState?.step === "decision") {
    return (
      <div className="flex flex-col gap-2 px-4 py-3 text-sm" style={{ paddingLeft: 16 + depth * 24 }}>
        <p className="text-ink-soft">
          &ldquo;{node.name}&rdquo; tem {deleteState.entryCount} lançamento(s). O que fazer com eles?
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={deleteState.moveToCategoryId ?? ""}
            onChange={(e) => onChooseMoveTarget(e.target.value)}
            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
          >
            <option value="">Mover para...</option>
            {leaves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!deleteState.moveToCategoryId}
            onClick={() => onSubmitDecision("move")}
            className="min-h-11 rounded-lg bg-accent px-3 text-white disabled:opacity-50"
          >
            Mover e excluir categoria
          </button>
          <button
            type="button"
            onClick={() => onSubmitDecision("delete")}
            className="min-h-11 rounded-lg bg-rust px-3 text-white"
          >
            Excluir lançamentos junto
          </button>
          <button type="button" onClick={onCancelDelete} className="min-h-11 rounded-lg px-3 text-muted">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="group flex items-center justify-between gap-2 px-4 py-2 hover:bg-[#FBFAF6]"
        style={{ paddingLeft: 16 + depth * 24, ...rowBackground(node) }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {depth > 0 && <span className="text-muted">↳</span>}
          {node.color && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: node.color }}
              aria-hidden
            />
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className={`truncate border-b border-dotted border-muted text-left text-sm ${textClass}`}
            style={node.category_type === "awaiting_review" ? { color: "var(--row-awaiting-text)" } : undefined}
          >
            {node.name}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {canAddSubcategory && (
            <button
              type="button"
              onClick={onAddSubcategory}
              title="Adicionar subcategoria"
              className="min-h-8 min-w-8 rounded px-2 text-accent-dark"
            >
              +
            </button>
          )}
          <button type="button" onClick={onStartEdit} title="Editar" className="min-h-8 min-w-8 rounded px-2 text-ink-soft">
            ✎
          </button>
          {node.category_type !== "awaiting_review" && (
            <button
              type="button"
              onClick={onStartDelete}
              title="Excluir"
              className="min-h-8 min-w-8 rounded px-2 text-rust"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div
          className="border-t border-border bg-[#FBFAF6] px-4 py-3 text-sm text-muted"
          style={{ paddingLeft: 16 + depth * 24 + 16 }}
        >
          Nenhum lançamento neste mês ainda.
        </div>
      )}
    </div>
  );
}

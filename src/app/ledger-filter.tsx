"use client";

import { useRouter } from "next/navigation";
import type { LedgerRow } from "@/lib/ledgers/service";

/**
 * Checkboxes em vez do antigo chip de seleção única — pedido do usuário pra
 * poder ver vários orçamentos de uma vez (ex: somar "Cartão" entre
 * orçamentos). Sempre precisa de pelo menos um marcado; desmarcar o último
 * é ignorado.
 */
export function LedgerFilter({
  ledgers,
  selectedIds,
  basePath,
}: {
  ledgers: LedgerRow[];
  selectedIds: string[];
  basePath: string;
}) {
  const router = useRouter();

  function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    if (next.length === 0) return;
    router.push(`${basePath}?ledgerIds=${next.join(",")}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Orçamentos:</span>
      {ledgers.map((l) => (
        <label
          key={l.id}
          className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-ink-soft"
        >
          <input type="checkbox" checked={selectedIds.includes(l.id)} onChange={() => toggle(l.id)} />
          {l.name}
        </label>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { InstallmentPlanRow } from "@/lib/installment-plans/service";
import { formatBRL } from "@/lib/format";

type PlanWithProgress = InstallmentPlanRow & { currentInstallmentNumber: number };

export function InstallmentPlanManager({ initialPlans }: { initialPlans: PlanWithProgress[] }) {
  const [plans, setPlans] = useState(initialPlans);
  const [error, setError] = useState<string | null>(null);

  async function cancelPlan(id: string) {
    setError(null);
    const res = await fetch(`/api/installment-plans/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível cancelar.");
      return;
    }
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
          {error}
        </div>
      )}

      <div className="flex flex-col rounded-xl border border-border bg-card">
        {plans.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">Nenhum parcelamento ativo.</p>
        )}
        {plans.map((p) => (
          <div
            key={p.id}
            className="group flex items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-b-0 hover:bg-[#FBFAF6]"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-ink">{p.description}</span>
              <span className="text-xs text-muted">
                {p.category_name} · {formatBRL(Number(p.installment_amount))}/mês · parcela{" "}
                {p.currentInstallmentNumber}/{p.total_installments}
              </span>
            </div>
            <button
              type="button"
              onClick={() => cancelPlan(p.id)}
              className="min-h-8 shrink-0 rounded-lg border border-border-strong px-3 text-xs text-rust opacity-0 group-hover:opacity-100"
            >
              Cancelar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

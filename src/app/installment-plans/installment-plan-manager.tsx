"use client";

import { useState } from "react";
import type { InstallmentPlanRow } from "@/lib/installment-plans/service";
import { formatBRL } from "@/lib/format";
import { currentMonthKey, formatMonthLabel, nextMonthKey } from "@/lib/date";

type PlanWithProgress = InstallmentPlanRow & { currentInstallmentNumber: number };

export function InstallmentPlanManager({ initialPlans }: { initialPlans: PlanWithProgress[] }) {
  const [plans, setPlans] = useState(initialPlans);
  const [error, setError] = useState<string | null>(null);
  const [advanceMonth, setAdvanceMonth] = useState(nextMonthKey(currentMonthKey()));
  const [advancing, setAdvancing] = useState(false);
  const [advanceResult, setAdvanceResult] = useState<string | null>(null);

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

  async function runAdvance() {
    setError(null);
    setAdvanceResult(null);
    setAdvancing(true);
    try {
      const res = await fetch("/api/installment-plans/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: advanceMonth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível avançar.");
        return;
      }
      setAdvanceResult(
        data.created > 0
          ? `${data.created} parcela(s) lançada(s) em ${formatMonthLabel(data.month)}. Veja em "Lançamentos", navegando até esse mês.`
          : `Nenhuma parcela nova em ${formatMonthLabel(data.month)} (já lançada antes, ou nenhum plano ativo cai nesse mês).`,
      );
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-border-strong bg-card p-3">
        <p className="text-xs text-muted">
          Testar o avanço automático sem esperar o dia 1 do mês — isso cria de verdade a parcela
          correspondente de cada parcelamento ativo, como se o mês escolhido já tivesse chegado.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={advanceMonth}
            onChange={(e) => setAdvanceMonth(e.target.value)}
            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
          />
          <button
            type="button"
            disabled={advancing}
            onClick={runAdvance}
            className="min-h-11 rounded-lg border border-border-strong px-4 text-sm text-accent-dark disabled:opacity-50"
          >
            {advancing ? "Avançando..." : "Avançar parcelas pra esse mês"}
          </button>
        </div>
        {advanceResult && <p className="text-xs text-ink-soft">{advanceResult}</p>}
      </div>

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

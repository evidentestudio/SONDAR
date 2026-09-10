"use client";

import { useEffect, useState } from "react";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import { formatBRL } from "@/lib/format";
import { formatMonthLabel } from "@/lib/date";

type ForecastCell = { month: string; installmentNumber: number; amount: number; isReal: boolean };
type ForecastPlanRow = {
  planId: string;
  description: string;
  categoryName: string;
  paymentSourceId: string | null;
  paymentSourceName: string | null;
  totalInstallments: number;
  cells: ForecastCell[];
};
type ForecastGrid = { months: string[]; plans: ForecastPlanRow[]; totalsByMonth: Record<string, number> };

const EMPTY_GRID: ForecastGrid = { months: [], plans: [], totalsByMonth: {} };

export function InstallmentForecast({
  ledgerId,
  paymentSources,
}: {
  ledgerId: string;
  paymentSources: PaymentSourceRow[];
}) {
  const [open, setOpen] = useState(true);
  const [paymentSourceId, setPaymentSourceId] = useState("");
  const [grid, setGrid] = useState<ForecastGrid>(EMPTY_GRID);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const qs = new URLSearchParams({ ledgerId });
    if (paymentSourceId) qs.set("paymentSourceId", paymentSourceId);
    fetch(`/api/installment-plans/forecast?${qs.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setGrid(data);
      });
    return () => {
      cancelled = true;
    };
  }, [ledgerId, paymentSourceId, open]);

  return (
    <div className="mb-8 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 font-serif text-lg text-ink"
        >
          Projeção de parcelas
          <span className="text-sm font-sans text-muted">{open ? "▲ recolher" : "▼ expandir"}</span>
        </button>
        {open && paymentSources.length > 0 && (
          <select
            value={paymentSourceId}
            onChange={(e) => setPaymentSourceId(e.target.value)}
            className="min-h-9 rounded-lg border border-border-strong px-2 text-sm"
          >
            <option value="">Todas as formas</option>
            {paymentSources.map((ps) => (
              <option key={ps.id} value={ps.id}>
                {ps.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {open && (
        <>
          <p className="text-xs text-muted">
            Do mês atual em diante. Valores em <span className="italic">itálico</span> ainda não
            aconteceram (previsão) — os demais já são lançamentos reais, iguais aos de Lançamentos.
          </p>

          {grid.plans.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted">
              Nenhum parcelamento ativo.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2">Parcelamento</th>
                    {grid.months.map((m) => (
                      <th key={m} className="whitespace-nowrap px-3 py-2 text-right">
                        {formatMonthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.plans.map((plan) => {
                    const cellByMonth = new Map(plan.cells.map((c) => [c.month, c]));
                    return (
                      <tr key={plan.planId} className="border-b border-border last:border-b-0">
                        <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                          <div className="max-w-40 truncate text-ink">{plan.description}</div>
                          <div className="truncate text-xs text-muted">
                            {plan.paymentSourceName ?? "Sem forma definida"}
                          </div>
                        </td>
                        {grid.months.map((m) => {
                          const cell = cellByMonth.get(m);
                          return (
                            <td key={m} className="whitespace-nowrap px-3 py-2 text-right">
                              {cell ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] uppercase tracking-wide text-muted">
                                    Parcela {cell.installmentNumber}/{plan.totalInstallments}
                                  </span>
                                  <span className={`money ${cell.isReal ? "text-ink" : "italic text-muted"}`}>
                                    {formatBRL(cell.amount)}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-border-strong">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-strong">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium text-ink">Total</td>
                    {grid.months.map((m) => (
                      <td key={m} className="money whitespace-nowrap px-3 py-2 text-right font-medium text-ink">
                        {formatBRL(grid.totalsByMonth[m] ?? 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

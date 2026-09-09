"use client";

import { useEffect, useState } from "react";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import { formatBRL } from "@/lib/format";
import { formatMonthLabel } from "@/lib/date";

type ForecastEntry = {
  planId: string;
  month: string;
  description: string;
  categoryName: string;
  paymentSourceId: string | null;
  paymentSourceName: string | null;
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
};

type MonthGroup = { month: string; total: number; items: ForecastEntry[] };

function groupByMonth(entries: ForecastEntry[]): MonthGroup[] {
  const groups = new Map<string, ForecastEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.month) ?? [];
    list.push(entry);
    groups.set(entry.month, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({ month, items, total: items.reduce((s, i) => s + i.amount, 0) }));
}

export function InstallmentForecast({
  ledgerId,
  paymentSources,
}: {
  ledgerId: string;
  paymentSources: PaymentSourceRow[];
}) {
  const [paymentSourceId, setPaymentSourceId] = useState("");
  const [entries, setEntries] = useState<ForecastEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ ledgerId });
    if (paymentSourceId) qs.set("paymentSourceId", paymentSourceId);
    fetch(`/api/installment-plans/forecast?${qs.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setEntries(data.forecast ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [ledgerId, paymentSourceId]);

  const months = groupByMonth(entries);

  return (
    <div className="mb-8 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">Projeção de parcelas</h2>
        {paymentSources.length > 0 && (
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
      <p className="text-xs text-muted">
        Quanto ainda falta pagar de compras parceladas, mês a mês — calculado agora, sem esperar o
        mês chegar. Vira lançamento de verdade sozinho quando o mês realmente acontecer.
      </p>

      {months.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted">
          Nenhuma parcela futura prevista.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {months.map((group) => (
            <div
              key={group.month}
              className="rounded-xl border border-dashed border-border-strong bg-card p-3"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{formatMonthLabel(group.month)}</span>
                <span className="money text-sm text-ink">{formatBRL(group.total)}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li
                    key={`${item.planId}-${item.month}`}
                    className="flex items-center justify-between gap-2 text-xs text-ink-soft"
                  >
                    <span className="truncate">
                      {item.description} ({item.installmentNumber}/{item.totalInstallments})
                      {item.paymentSourceName ? ` · ${item.paymentSourceName}` : ""}
                    </span>
                    <span className="money shrink-0">{formatBRL(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

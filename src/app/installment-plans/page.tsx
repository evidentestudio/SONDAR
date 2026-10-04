import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { listInstallmentPlans } from "@/lib/installment-plans/service";
import { ensureDefaultLedger, listLedgers } from "@/lib/ledgers/service";
import { listPaymentSources } from "@/lib/payment-sources/service";
import { currentMonthKey, dbDateToMonthKey, monthsBetween } from "@/lib/date";
import { InstallmentPlanManager } from "./installment-plan-manager";
import { InstallmentForecast } from "./installment-forecast";
import { LedgerFilter } from "../ledger-filter";

export default async function InstallmentPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ ledgerIds?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureDefaultLedger(session.householdId);
  const ledgers = await listLedgers(session.householdId);
  const { ledgerIds: requestedParam } = await searchParams;
  const requested = requestedParam ? requestedParam.split(",").filter(Boolean) : [];
  const validRequested = requested.filter((id) => ledgers.some((l) => l.id === id));
  const selectedLedgerIds =
    validRequested.length > 0 ? validRequested : [(ledgers.find((l) => l.is_default) ?? ledgers[0]).id];
  const showLedgerBadge = selectedLedgerIds.length > 1;
  const ledgerNameById = Object.fromEntries(ledgers.map((l) => [l.id, l.name]));

  const plans = await listInstallmentPlans(session.householdId, selectedLedgerIds);
  const paymentSources = await listPaymentSources(session.householdId);
  const month = currentMonthKey();
  const plansWithProgress = plans.map((p) => ({
    ...p,
    ledgerName: showLedgerBadge ? ledgerNameById[p.ledger_id] : undefined,
    currentInstallmentNumber: Math.min(
      Math.max(1, monthsBetween(dbDateToMonthKey(p.anchor_month), month) + 1),
      p.total_installments,
    ),
  }));

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-paper px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Parcelamentos</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">
          Cada compra parcelada lança só a parcela do mês atual — as próximas aparecem sozinhas nos
          meses seguintes. Cancelar um parcelamento aqui só impede as parcelas futuras; as que já
          foram lançadas continuam no histórico.
        </p>
        {ledgers.length > 1 && (
          <LedgerFilter ledgers={ledgers} selectedIds={selectedLedgerIds} basePath="/installment-plans" />
        )}
        <InstallmentForecast ledgerIds={selectedLedgerIds} ledgerNameById={ledgerNameById} paymentSources={paymentSources} />

        <InstallmentPlanManager initialPlans={plansWithProgress} />
      </main>
    </div>
  );
}

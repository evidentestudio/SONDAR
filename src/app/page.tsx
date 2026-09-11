import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { LogoutButton } from "./logout-button";
import { MonthView } from "./month-view";
import { currentMonthKey } from "@/lib/date";
import { getCategoryMonthSummary, getMonthTotals, getPaymentSourceTotals } from "@/lib/budget-summary/service";
import { listEntries } from "@/lib/entries/service";
import { listPaymentSources } from "@/lib/payment-sources/service";
import { ensureDefaultLedger, listLedgers } from "@/lib/ledgers/service";
import { findGapWarnings } from "@/lib/gap-warnings/service";

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const month = currentMonthKey();
  const defaultLedgerId = await ensureDefaultLedger(session.householdId);
  const [ledgers, categories, totals, paymentSourceTotals, entries, paymentSources, gapWarnings] =
    await Promise.all([
      listLedgers(session.householdId),
      getCategoryMonthSummary(session.householdId, defaultLedgerId, month),
      getMonthTotals(session.householdId, defaultLedgerId, month),
      getPaymentSourceTotals(session.householdId, defaultLedgerId, month),
      listEntries(session.householdId, defaultLedgerId, month),
      listPaymentSources(session.householdId),
      findGapWarnings(session.householdId, defaultLedgerId, month),
    ]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-paper px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="font-serif text-xl text-ink">Sondar</h1>
          <Link href="/categories" className="text-sm text-accent-dark hover:underline">
            Categorias
          </Link>
          <Link href="/payment-sources" className="text-sm text-accent-dark hover:underline">
            Formas
          </Link>
          <Link href="/notes" className="text-sm text-accent-dark hover:underline">
            Notas
          </Link>
          <Link href="/merchant-rules" className="text-sm text-accent-dark hover:underline">
            Regras
          </Link>
          <Link href="/ledgers" className="text-sm text-accent-dark hover:underline">
            Orçamentos
          </Link>
          <Link href="/installment-plans" className="text-sm text-accent-dark hover:underline">
            Parcelamentos
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm text-ink-soft">
          <span>{session.displayName ?? session.email}</span>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <MonthView
          initialMonth={month}
          ledgers={ledgers}
          defaultLedgerId={defaultLedgerId}
          initialData={{ categories, totals, paymentSourceTotals, entries, gapWarnings }}
          paymentSources={paymentSources}
        />
      </main>
    </div>
  );
}

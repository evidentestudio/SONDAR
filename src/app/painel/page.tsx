import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { currentMonthKey } from "@/lib/date";
import { getCategoryMonthSummary } from "@/lib/budget-summary/service";
import { listEntries } from "@/lib/entries/service";
import { listDashboardFilters } from "@/lib/dashboard-filters/service";
import { ensureDefaultLedger, listLedgers } from "@/lib/ledgers/service";
import { PainelManager } from "./painel-manager";

export default async function PainelPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = currentMonthKey();
  const defaultLedgerId = await ensureDefaultLedger(session.householdId);
  const [ledgers, categories, entries, filters] = await Promise.all([
    listLedgers(session.householdId),
    getCategoryMonthSummary(session.householdId, defaultLedgerId, month),
    listEntries(session.householdId, defaultLedgerId, month),
    listDashboardFilters(session.householdId, defaultLedgerId),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-paper px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Painel</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <PainelManager
          initialMonth={month}
          ledgers={ledgers}
          defaultLedgerId={defaultLedgerId}
          initialCategories={categories}
          initialEntries={entries}
          initialFilters={filters}
        />
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { getCategoryTree } from "@/lib/categories/service";
import { ensureDefaultLedger, listLedgers } from "@/lib/ledgers/service";
import { CategoryManager } from "./category-manager";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ ledgerId?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureDefaultLedger(session.householdId);
  const ledgers = await listLedgers(session.householdId);
  const { ledgerId: requestedLedgerId } = await searchParams;
  const ledgerId = ledgers.some((l) => l.id === requestedLedgerId)
    ? requestedLedgerId!
    : (ledgers.find((l) => l.is_default) ?? ledgers[0]).id;

  const categories = await getCategoryTree(session.householdId, ledgerId);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Categorias</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {ledgers.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Orçamento:</span>
            {ledgers.map((l) => (
              <Link
                key={l.id}
                href={`/categories?ledgerId=${l.id}`}
                className={`rounded-full px-3 py-1 ${l.id === ledgerId ? "bg-accent text-white" : "border border-border-strong text-ink-soft"}`}
              >
                {l.name}
              </Link>
            ))}
          </div>
        )}
        <CategoryManager initialCategories={categories} ledgerId={ledgerId} />
      </main>
    </div>
  );
}

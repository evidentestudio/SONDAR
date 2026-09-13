import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { listEntriesForReview } from "@/lib/entries/service";
import { listLedgers } from "@/lib/ledgers/service";
import { listPaymentSources } from "@/lib/payment-sources/service";
import { ReviewQueueManager } from "./review-queue-manager";

export default async function ReviewQueuePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [entries, ledgers, paymentSources] = await Promise.all([
    listEntriesForReview(session.householdId),
    listLedgers(session.householdId),
    listPaymentSources(session.householdId),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-paper px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Revisão em lote</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">
          Todo lançamento sinalizado pra revisar (categoria incerta, ou possível duplicidade) — de
          qualquer mês, de qualquer orçamento — aparece aqui num só lugar, pra corrigir em sequência
          em vez de caçar mês a mês.
        </p>
        <ReviewQueueManager initialEntries={entries} ledgers={ledgers} paymentSources={paymentSources} />
      </main>
    </div>
  );
}

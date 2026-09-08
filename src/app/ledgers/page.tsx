import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { ensureDefaultLedger, listLedgers } from "@/lib/ledgers/service";
import { LedgerManager } from "./ledger-manager";

export default async function LedgersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureDefaultLedger(session.householdId);
  const ledgers = await listLedgers(session.householdId);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Orçamentos</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">
          O orçamento <strong>Principal</strong> é onde a maioria dos gastos da família entra, e não
          pode ser excluído. Crie quantos suborçamentos paralelos quiser — Reserva de Emergência,
          Investimentos, Empresa, Mesadas, o que fizer sentido pra você. Cada um tem sua própria
          árvore de categorias e seus próprios totais, sem influenciar os demais.
        </p>
        <LedgerManager initialLedgers={ledgers} />
      </main>
    </div>
  );
}

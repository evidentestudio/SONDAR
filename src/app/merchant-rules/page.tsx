import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { listMerchantRules } from "@/lib/merchant-rules/service";
import { listLeafCategories } from "@/lib/categories/service";
import { MerchantRuleManager } from "./merchant-rule-manager";

export default async function MerchantRulesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rules, leaves] = await Promise.all([
    listMerchantRules(session.householdId),
    listLeafCategories(session.householdId),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Regras de categorização</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">
          Quando o nome do estabelecimento corresponder a um padrão aqui (tolerante a erro de
          grafia/acento), a categoria é aplicada automaticamente na extração por IA. Marque
          &ldquo;sempre ambíguo&rdquo; pra nomes que às vezes são uma coisa, às vezes outra — esses
          nunca aplicam categoria sozinhos, sempre caem em Aguardando Revisão.
        </p>
        <MerchantRuleManager initialRules={rules} leaves={leaves} />
      </main>
    </div>
  );
}

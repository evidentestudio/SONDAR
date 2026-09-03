import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current";
import { LogoutButton } from "./logout-button";

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="font-serif text-xl text-ink">Sondar</h1>
        <div className="flex items-center gap-4 text-sm text-ink-soft">
          <span>{session.displayName ?? session.email}</span>
          <LogoutButton />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-md text-center text-muted">
          Nenhum lançamento ainda. As categorias, o orçamento e os lançamentos
          aparecem aqui nas próximas etapas.
        </p>
      </main>
    </div>
  );
}

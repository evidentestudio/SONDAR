import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/current";
import { listNotes } from "@/lib/notes/service";
import { NotesManager } from "./notes-manager";

export default async function NotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const notes = await listNotes(session.householdId);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Início
          </Link>
          <h1 className="font-serif text-xl text-ink">Notas e ideias</h1>
        </div>
        <span className="text-sm text-ink-soft">{session.displayName ?? session.email}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">Espaço para suas anotações e lembretes.</p>
        <NotesManager initialNotes={notes} />
      </main>
    </div>
  );
}

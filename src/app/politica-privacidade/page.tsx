import Link from "next/link";
import { PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy-policy";

export default function PrivacyPolicyPage() {
  return (
    <main className="flex min-h-screen justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 rounded-lg border border-rust bg-rust-light p-4 text-sm text-ink-soft">
          <strong className="text-ink">Rascunho.</strong> Este texto ainda não passou por revisão
          jurídica — reflete com precisão o que o Sondar faz tecnicamente com os dados, mas não deve
          ser tratado como documento legal definitivo.
        </div>

        <h1 className="mb-1 font-serif text-2xl text-ink">Política de Privacidade</h1>
        <p className="mb-8 text-sm text-muted">Versão {PRIVACY_POLICY_VERSION}</p>

        <div className="flex flex-col gap-6">
          {PRIVACY_POLICY_SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="mb-2 font-serif text-lg text-ink">{section.title}</h2>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i} className="mb-2 text-sm leading-relaxed text-ink-soft">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-muted">
          <Link href="/login" className="text-accent-dark hover:underline">
            Voltar
          </Link>
        </p>
      </div>
    </main>
  );
}

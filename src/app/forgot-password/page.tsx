"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-1 font-serif text-xl text-ink">Esqueci minha senha</h1>
        <p className="mb-6 text-sm text-muted">Enviamos um link pra você escolher uma nova senha.</p>

        {sent ? (
          <p className="text-sm text-ink-soft">
            Se {email} tiver uma conta, o email de redefinição já foi enviado. Confira sua caixa de
            entrada (e o spam).
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-ink-soft">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-11 rounded-lg border border-border-strong bg-card px-3 text-base text-ink outline-none focus:border-accent"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 min-h-11 rounded-lg bg-accent px-5 text-base font-medium text-white disabled:opacity-60"
              style={{ touchAction: "manipulation" }}
            >
              {loading ? "Enviando..." : "Enviar link"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/login" className="text-accent-dark hover:underline">
            Voltar pro login
          </Link>
        </p>
      </div>
    </main>
  );
}

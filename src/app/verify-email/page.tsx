"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}

function VerifyEmail() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "verified" | "error">(token ? "checking" : "error");
  const [error, setError] = useState<string | null>(
    token ? null : "Link inválido — falta o token na URL.",
  );

  useEffect(() => {
    if (!token) return;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Não foi possível confirmar o email.");
          setStatus("error");
          return;
        }
        setStatus("verified");
      })
      .catch(() => {
        setError("Falha de rede ao confirmar o email.");
        setStatus("error");
      });
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="mb-3 font-serif text-xl text-ink">Confirmação de email</h1>

        {status === "checking" && <p className="text-sm text-muted">Confirmando...</p>}
        {status === "verified" && <p className="text-sm text-ink-soft">Email confirmado com sucesso!</p>}
        {status === "error" && <p className="text-sm text-rust">{error}</p>}

        <p className="mt-4 text-sm text-muted">
          <Link href="/" className="text-accent-dark hover:underline">
            Ir para o Sondar
          </Link>
        </p>
      </div>
    </main>
  );
}

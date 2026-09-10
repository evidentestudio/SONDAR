/**
 * Thin wrapper over Resend's REST API (no SDK — one endpoint, plain fetch is
 * simpler than a dependency for it). Without RESEND_API_KEY set (local dev
 * before the account exists), logs the email to the console instead of
 * failing — signup/reset flows stay fully testable without real email
 * infrastructure, and the printed link is exactly what a real inbox would
 * receive.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Sondar <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(`\n[email não enviado — RESEND_API_KEY não configurada]\nPara: ${input.to}\nAssunto: ${input.subject}\n${input.html}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar email via Resend (${res.status}): ${body}`);
  }
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

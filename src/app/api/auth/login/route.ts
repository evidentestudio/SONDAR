import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Informe email e senha." }, { status: 400 });
  }

  const session = await authenticateWithPassword(email, password);
  if (!session) {
    return NextResponse.json({ error: "Email ou senha inválidos." }, { status: 401 });
  }

  const token = await createSessionToken(session);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);

  return NextResponse.json({ ok: true });
}

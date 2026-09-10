import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAccount } from "@/lib/auth/signup";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName : "";
  const householdName = typeof body?.householdName === "string" ? body.householdName : null;

  const result = await createAccount({ email, password, displayName, householdName });
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  const token = await createSessionToken({
    userId: result.userId,
    householdId: result.householdId,
    email: email.trim().toLowerCase(),
    displayName: displayName.trim(),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);

  return NextResponse.json({ ok: true }, { status: 201 });
}

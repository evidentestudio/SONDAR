import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/signup";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  if (email) await requestPasswordReset(email);

  // Always the same response, whether or not the email exists.
  return NextResponse.json({ ok: true });
}

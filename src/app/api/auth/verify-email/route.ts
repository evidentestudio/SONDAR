import { NextResponse } from "next/server";
import { verifyEmail } from "@/lib/auth/signup";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "Link inválido." }, { status: 400 });

  const result = await verifyEmail(token);
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

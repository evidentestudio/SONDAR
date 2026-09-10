import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";

export type TokenPurpose = "verify_email" | "reset_password";

const TOKEN_TTL_HOURS: Record<TokenPurpose, number> = {
  verify_email: 48,
  reset_password: 1,
};

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a token for the given purpose and returns the raw value (goes in
 * the email link — never stored). The DB only ever sees its hash, same
 * reasoning as password storage: a leaked database row can't be replayed as
 * the token itself.
 */
export async function createAuthToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS[purpose] * 60 * 60 * 1000);

  await db(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, purpose, hashToken(rawToken), expiresAt],
  );

  return rawToken;
}

export type ConsumeTokenResult =
  | { status: "valid"; userId: string }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "used" };

/**
 * Verifies a raw token and marks it used in one step (single-use) — callers
 * that only need to validate the token without spending it, don't exist yet
 * on purpose: every current use case (verify email, reset password) wants
 * the token spent atomically with the action it authorizes.
 */
export async function consumeAuthToken(
  rawToken: string,
  purpose: TokenPurpose,
): Promise<ConsumeTokenResult> {
  const { rows } = await db<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    `SELECT id, user_id, expires_at, used_at FROM auth_tokens
     WHERE token_hash = $1 AND purpose = $2`,
    [hashToken(rawToken), purpose],
  );
  const token = rows[0];
  if (!token) return { status: "invalid" };
  if (token.used_at) return { status: "used" };
  if (new Date(token.expires_at) < new Date()) return { status: "expired" };

  await db(`UPDATE auth_tokens SET used_at = now() WHERE id = $1`, [token.id]);
  return { status: "valid", userId: token.user_id };
}

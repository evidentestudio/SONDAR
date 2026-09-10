import { db } from "@/lib/db";
import { hashPassword } from "./password";
import { createAuthToken, consumeAuthToken } from "./tokens";
import { sendEmail, appUrl } from "@/lib/email/send";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type CreateAccountInput = {
  householdName?: string | null;
  displayName: string;
  email: string;
  password: string;
};

export type CreateAccountResult =
  | { status: "created"; userId: string; householdId: string }
  | { status: "error"; message: string };

/**
 * Creates a brand-new household + its first user (role 'owner') — the entry
 * point for anyone who isn't part of an existing household yet. The
 * household's own ledger/categories are NOT created here: every page already
 * lazily ensures them on first visit (ensureDefaultLedger,
 * ensureAwaitingReviewCategory), so a signup that stops right after this
 * still lands the user in a fully working (empty) household.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const householdName = input.householdName?.trim() || "Minha família";

  if (!EMAIL_RE.test(email)) return { status: "error", message: "Email inválido." };
  if (!displayName) return { status: "error", message: "Informe seu nome." };
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { status: "error", message: `Senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  const { rows: existing } = await db<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [email],
  );
  if (existing[0]) return { status: "error", message: "Já existe uma conta com esse email." };

  const passwordHash = await hashPassword(input.password);

  const { rows: householdRows } = await db<{ id: string }>(
    `INSERT INTO households (name) VALUES ($1) RETURNING id`,
    [householdName],
  );
  const householdId = householdRows[0].id;

  const { rows: userRows } = await db<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, displayName, passwordHash],
  );
  const userId = userRows[0].id;

  await db(
    `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [householdId, userId],
  );

  const token = await createAuthToken(userId, "verify_email");
  const link = `${appUrl()}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Confirme seu email — Sondar",
    html: `<p>Olá, ${displayName}!</p><p>Confirme seu email pra ativar sua conta no Sondar:</p><p><a href="${link}">${link}</a></p><p>Esse link expira em 48 horas.</p>`,
  });

  return { status: "created", userId, householdId };
}

export type VerifyEmailResult = { status: "verified" } | { status: "error"; message: string };

export async function verifyEmail(rawToken: string): Promise<VerifyEmailResult> {
  const result = await consumeAuthToken(rawToken, "verify_email");
  if (result.status === "invalid") return { status: "error", message: "Link inválido." };
  if (result.status === "used") return { status: "error", message: "Esse link já foi usado." };
  if (result.status === "expired") return { status: "error", message: "Esse link expirou." };

  await db(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [result.userId]);
  return { status: "verified" };
}

/**
 * Always succeeds from the caller's point of view, whether or not the email
 * exists — never reveal which emails have accounts. The actual email only
 * goes out when one does.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await db<{ id: string; display_name: string | null }>(
    `SELECT id, display_name FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [normalizedEmail],
  );
  const user = rows[0];
  if (!user) return;

  const token = await createAuthToken(user.id, "reset_password");
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmail({
    to: normalizedEmail,
    subject: "Redefinir senha — Sondar",
    html: `<p>Olá${user.display_name ? `, ${user.display_name}` : ""}!</p><p>Clique pra escolher uma nova senha:</p><p><a href="${link}">${link}</a></p><p>Esse link expira em 1 hora. Se você não pediu isso, ignore este email.</p>`,
  });
}

export type ResetPasswordResult = { status: "reset" } | { status: "error"; message: string };

export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { status: "error", message: `Senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  const result = await consumeAuthToken(rawToken, "reset_password");
  if (result.status === "invalid") return { status: "error", message: "Link inválido." };
  if (result.status === "used") return { status: "error", message: "Esse link já foi usado." };
  if (result.status === "expired") return { status: "error", message: "Esse link expirou." };

  const passwordHash = await hashPassword(newPassword);
  await db(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, result.userId]);
  return { status: "reset" };
}

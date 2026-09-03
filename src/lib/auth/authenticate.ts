import { db } from "@/lib/db";
import { verifyPassword } from "./password";
import type { SessionPayload } from "./session";

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string | null;
};

type HouseholdRow = {
  household_id: string;
};

/**
 * Checks email/password against `users` and resolves the household the user
 * belongs to. Returns null on any failure (unknown email, wrong password, no
 * household membership) without distinguishing which — callers should show a
 * single generic "invalid credentials" message.
 */
export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<SessionPayload | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return null;

  const { rows: userRows } = await db<UserRow>(
    `SELECT id, email, display_name, password_hash
     FROM users
     WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [normalizedEmail],
  );
  const user = userRows[0];
  if (!user || !user.password_hash) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  const { rows: householdRows } = await db<HouseholdRow>(
    `SELECT household_id FROM household_members WHERE user_id = $1 LIMIT 1`,
    [user.id],
  );
  const household = householdRows[0];
  if (!household) return null;

  return {
    userId: user.id,
    householdId: household.household_id,
    email: user.email,
    displayName: user.display_name,
  };
}

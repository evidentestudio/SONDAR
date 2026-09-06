import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { authenticateWithPassword } from "@/lib/auth/authenticate";

const pool = getPool();

describe("senha", () => {
  it("faz round-trip de hash/verify", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("sessão (JWT)", () => {
  it("faz round-trip de create/verify", async () => {
    const token = await createSessionToken({
      userId: "11111111-1111-1111-1111-111111111111",
      householdId: "22222222-2222-2222-2222-222222222222",
      email: "test@example.com",
      displayName: "Teste",
    });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({
      userId: "11111111-1111-1111-1111-111111111111",
      householdId: "22222222-2222-2222-2222-222222222222",
      email: "test@example.com",
      displayName: "Teste",
    });
  });

  it("rejeita token inválido", async () => {
    expect(await verifySessionToken("not-a-real-token")).toBeNull();
  });
});

describe("login funciona (autenticação básica de household)", () => {
  const email = "__foundation_test_user__@example.com";
  const password = "senha-de-teste-123";
  let householdId: string;
  let userId: string;

  beforeAll(async () => {
    const { rows: hh } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_auth__') RETURNING id`,
    );
    householdId = hh[0].id;

    const passwordHash = await hashPassword(password);
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, "Usuário de Teste", passwordHash],
    );
    userId = userRows[0].id;

    await pool.query(
      `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [householdId, userId],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM household_members WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("autentica com credenciais corretas e resolve o household", async () => {
    const session = await authenticateWithPassword(email, password);
    expect(session).toEqual({
      userId,
      householdId,
      email,
      displayName: "Usuário de Teste",
    });
  });

  it("recusa senha errada", async () => {
    expect(await authenticateWithPassword(email, "senha-errada")).toBeNull();
  });

  it("recusa email desconhecido", async () => {
    expect(await authenticateWithPassword("ninguem@example.com", password)).toBeNull();
  });

  it("é case-insensitive no email", async () => {
    const session = await authenticateWithPassword(email.toUpperCase(), password);
    expect(session?.userId).toBe(userId);
  });
});

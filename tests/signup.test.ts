import { describe, expect, it, afterAll, vi } from "vitest";
import { getPool } from "@/lib/db";
import { createAccount, verifyEmail, requestPasswordReset, resetPassword } from "@/lib/auth/signup";
import { createAuthToken, consumeAuthToken } from "@/lib/auth/tokens";
import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy-policy";
import * as emailModule from "@/lib/email/send";

const pool = getPool();

describe("cadastro de conta (Multi-Família)", () => {
  const cleanupEmails: string[] = [];

  afterAll(async () => {
    if (cleanupEmails.length > 0) {
      await pool.query(
        `DELETE FROM consent_records WHERE user_id IN (SELECT id FROM users WHERE lower(email) = ANY($1))`,
        [cleanupEmails],
      );
      await pool.query(
        `DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE lower(email) = ANY($1))`,
        [cleanupEmails],
      );
      await pool.query(
        `DELETE FROM household_members WHERE user_id IN (SELECT id FROM users WHERE lower(email) = ANY($1))`,
        [cleanupEmails],
      );
      await pool.query(`DELETE FROM households WHERE name = '__cadastro_test__'`);
      await pool.query(`DELETE FROM users WHERE lower(email) = ANY($1)`, [cleanupEmails]);
    }
    await pool.end();
  });

  describe("createAccount", () => {
    it("cria household + usuário owner + token de verificação", async () => {
      const email = "__signup_test_1__@example.com";
      cleanupEmails.push(email);

      const result = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      expect(result.status).toBe("created");
      if (result.status !== "created") throw new Error("unreachable");

      const { rows: memberRows } = await pool.query<{ role: string }>(
        `SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2`,
        [result.householdId, result.userId],
      );
      expect(memberRows[0].role).toBe("owner");

      const { rows: tokenRows } = await pool.query<{ purpose: string }>(
        `SELECT purpose FROM auth_tokens WHERE user_id = $1`,
        [result.userId],
      );
      expect(tokenRows.map((r) => r.purpose)).toEqual(["verify_email"]);

      // Já dá pra logar imediatamente — verificação de email não bloqueia login.
      const session = await authenticateWithPassword(email, "senha-valida-123");
      expect(session?.userId).toBe(result.userId);
    });

    it("recusa cadastro sem aceitar a política de privacidade", async () => {
      const result = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email: "__signup_test_no_consent__@example.com",
        password: "senha-valida-123",
        acceptedPrivacyPolicy: false,
      });
      expect(result.status).toBe("error");
    });

    it("registra o consentimento com a versão vigente da política", async () => {
      const email = "__signup_test_consent__@example.com";
      cleanupEmails.push(email);

      const result = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      if (result.status !== "created") throw new Error("setup failed");

      const { rows } = await pool.query<{ policy_version: string }>(
        `SELECT policy_version FROM consent_records WHERE user_id = $1`,
        [result.userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].policy_version).toBe(PRIVACY_POLICY_VERSION);
    });

    it("não deixa household/usuário órfãos se algo falhar no meio do cadastro", async () => {
      // Simula uma falha a meio caminho da transação: insere direto um
      // usuário soft-deletado com o mesmo email (a checagem de duplicidade
      // do createAccount ignora deleted_at, então ela não pega isso — mas a
      // constraint UNIQUE de verdade no banco pega, no meio da transação).
      // Se a transação não reverter direito, sobra um household criado sem
      // usuário nenhum ligado a ele.
      const email = "__signup_test_rollback__@example.com";
      const householdName = "__cadastro_test_rollback__";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, deleted_at) VALUES ($1, 'Antigo', 'x', now()) RETURNING id`,
        [email],
      );
      const oldUserId = rows[0].id;

      try {
        const result = await createAccount({
          householdName,
          displayName: "Fulano",
          email,
          password: "senha-valida-123",
          acceptedPrivacyPolicy: true,
        });
        expect(result.status).toBe("error");

        const { rows: householdRows } = await pool.query(`SELECT id FROM households WHERE name = $1`, [
          householdName,
        ]);
        expect(householdRows).toHaveLength(0);
      } finally {
        await pool.query(`DELETE FROM users WHERE id = $1`, [oldUserId]);
      }
    });

    it("cria a conta mesmo se o envio do email de verificação falhar", async () => {
      const email = "__signup_test_email_fails__@example.com";
      cleanupEmails.push(email);

      const sendEmailSpy = vi.spyOn(emailModule, "sendEmail").mockRejectedValueOnce(
        new Error("Falha simulada de envio (ex: restrição de sandbox do Resend)"),
      );
      try {
        const result = await createAccount({
          householdName: "__cadastro_test__",
          displayName: "Fulano",
          email,
          password: "senha-valida-123",
          acceptedPrivacyPolicy: true,
        });
        expect(result.status).toBe("created");
        if (result.status !== "created") throw new Error("unreachable");

        const session = await authenticateWithPassword(email, "senha-valida-123");
        expect(session?.userId).toBe(result.userId);
      } finally {
        sendEmailSpy.mockRestore();
      }
    });

    it("recusa email já cadastrado", async () => {
      const email = "__signup_test_2__@example.com";
      cleanupEmails.push(email);

      await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Primeira",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      const second = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Segunda",
        email,
        password: "outra-senha-123",
        acceptedPrivacyPolicy: true,
      });
      expect(second.status).toBe("error");
    });

    it("recusa email inválido, senha curta ou nome vazio", async () => {
      const badEmail = await createAccount({
        displayName: "Fulano",
        email: "não-é-email",
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      expect(badEmail.status).toBe("error");

      const shortPassword = await createAccount({
        displayName: "Fulano",
        email: "__signup_test_3__@example.com",
        password: "curta",
        acceptedPrivacyPolicy: true,
      });
      expect(shortPassword.status).toBe("error");

      const noName = await createAccount({
        displayName: "  ",
        email: "__signup_test_4__@example.com",
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      expect(noName.status).toBe("error");
    });
  });

  describe("verifyEmail", () => {
    it("confirma o email com token válido e marca como usado", async () => {
      const email = "__signup_test_5__@example.com";
      cleanupEmails.push(email);
      const created = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      if (created.status !== "created") throw new Error("setup failed");

      const token = await createAuthToken(created.userId, "verify_email");
      const result = await verifyEmail(token);
      expect(result.status).toBe("verified");

      const { rows } = await pool.query<{ email_verified_at: string | null }>(
        `SELECT email_verified_at FROM users WHERE id = $1`,
        [created.userId],
      );
      expect(rows[0].email_verified_at).not.toBeNull();

      // Mesmo token não pode ser usado de novo.
      const second = await verifyEmail(token);
      expect(second.status).toBe("error");
    });

    it("recusa token inexistente", async () => {
      const result = await verifyEmail("token-que-nunca-existiu");
      expect(result.status).toBe("error");
    });
  });

  describe("requestPasswordReset / resetPassword", () => {
    it("gera token de reset e permite trocar a senha com ele", async () => {
      const email = "__signup_test_6__@example.com";
      cleanupEmails.push(email);
      const created = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-antiga-123",
        acceptedPrivacyPolicy: true,
      });
      if (created.status !== "created") throw new Error("setup failed");

      await requestPasswordReset(email);
      const { rows: tokenRows } = await pool.query<{ id: string }>(
        `SELECT id FROM auth_tokens WHERE user_id = $1 AND purpose = 'reset_password'`,
        [created.userId],
      );
      expect(tokenRows).toHaveLength(1);

      const rawToken = await createAuthToken(created.userId, "reset_password");
      const result = await resetPassword(rawToken, "senha-nova-456");
      expect(result.status).toBe("reset");

      expect(await authenticateWithPassword(email, "senha-nova-456")).not.toBeNull();
      expect(await authenticateWithPassword(email, "senha-antiga-123")).toBeNull();
    });

    it("não revela se o email existe (sempre silencioso)", async () => {
      await expect(requestPasswordReset("ninguem-cadastrado@example.com")).resolves.toBeUndefined();
    });

    it("recusa senha nova curta e token já usado", async () => {
      const email = "__signup_test_7__@example.com";
      cleanupEmails.push(email);
      const created = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      if (created.status !== "created") throw new Error("setup failed");

      const rawToken = await createAuthToken(created.userId, "reset_password");
      const shortPassword = await resetPassword(rawToken, "curta");
      expect(shortPassword.status).toBe("error");

      const okReset = await resetPassword(rawToken, "senha-valida-outra-123");
      expect(okReset.status).toBe("reset");

      const reused = await resetPassword(rawToken, "mais-uma-senha-123");
      expect(reused.status).toBe("error");
    });
  });

  describe("consumeAuthToken", () => {
    it("recusa token expirado", async () => {
      const email = "__signup_test_8__@example.com";
      cleanupEmails.push(email);
      const created = await createAccount({
        householdName: "__cadastro_test__",
        displayName: "Fulano",
        email,
        password: "senha-valida-123",
        acceptedPrivacyPolicy: true,
      });
      if (created.status !== "created") throw new Error("setup failed");

      const rawToken = await createAuthToken(created.userId, "reset_password");
      await pool.query(`UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, [
        created.userId,
      ]);

      const result = await consumeAuthToken(rawToken, "reset_password");
      expect(result.status).toBe("expired");
    });
  });
});

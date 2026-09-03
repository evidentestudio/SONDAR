import { describe, expect, it, afterAll } from "vitest";
import { pool } from "@/lib/db";

const EXPECTED_TABLES = [
  "users",
  "households",
  "household_members",
  "categories",
  "budgets",
  "payment_sources",
  "installment_plans",
  "financial_entries",
  "merchant_rules",
  "notes",
  "audit_log",
  "ai_extraction_logs",
];

const EXPECTED_VIEWS = [
  "category_month_summary",
  "payment_source_month_summary",
  "month_totals",
];

describe("Etapa 0 — fundação", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("conecta ao banco", async () => {
    const { rows } = await pool.query("SELECT 1 AS ok");
    expect(rows[0].ok).toBe(1);
  });

  it("todas as tabelas do sondar_schema.sql existem", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const existing = new Set(rows.map((r) => r.table_name));
    for (const table of EXPECTED_TABLES) {
      expect(existing.has(table), `missing table: ${table}`).toBe(true);
    }
  });

  it("todas as views de apoio existem", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );
    const existing = new Set(rows.map((r) => r.table_name));
    for (const view of EXPECTED_VIEWS) {
      expect(existing.has(view), `missing view: ${view}`).toBe(true);
    }
  });

  it("users.password_hash existe (extensão de auth)", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash'`,
    );
    expect(rows.length).toBe(1);
  });

  it("name_normalized ignora maiúscula e acento (bug do MESADA PAPAI)", async () => {
    const { rows: hh } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household__') RETURNING id`,
    );
    const householdId = hh[0].id;
    try {
      await pool.query(
        `INSERT INTO categories (household_id, name) VALUES ($1, 'Mesada Papai')`,
        [householdId],
      );
      await expect(
        pool.query(`INSERT INTO categories (household_id, name) VALUES ($1, 'MESADA PAPAI')`, [
          householdId,
        ]),
      ).rejects.toThrow();
      await expect(
        pool.query(`INSERT INTO categories (household_id, name) VALUES ($1, 'mesadá papai')`, [
          householdId,
        ]),
      ).rejects.toThrow();
    } finally {
      await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
      await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    }
  });
});

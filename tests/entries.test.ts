import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createEntry, listEntries } from "@/lib/entries/service";

const pool = getPool();
const MONTH = "2026-09";

describe("lançamentos — regressão do bug de tipo do pg", () => {
  let householdId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_entries__') RETURNING id`,
    );
    householdId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("entry_date volta como string 'YYYY-MM-DD', não Date — pg parseia DATE como objeto Date por padrão, e a UI (e o tipo EntryRow) espera string; sem o type parser em lib/db.ts, isso quebra em produção (TypeError: entry_date.slice is not a function) assim que existe pelo menos um lançamento", async () => {
    const cat = await createCategory(householdId, { name: "Categoria Teste" });
    if (cat.status !== "created") throw new Error("setup failed");

    await createEntry(householdId, {
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Teste",
      amount: 10,
      categoryId: cat.category.id,
    });

    const entries = await listEntries(householdId, MONTH);
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].entry_date).toBe("string");
    expect(entries[0].entry_date.slice(0, 10)).toBe("2026-09-10");
  });
});

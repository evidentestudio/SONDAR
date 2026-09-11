import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory, ensureAwaitingReviewCategory } from "@/lib/categories/service";
import { createEntry, listEntries, updateEntry } from "@/lib/entries/service";

const pool = getPool();
const MONTH = "2026-09";

describe("lançamentos", () => {
  let householdId: string;
  let ledgerId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_entries__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("entry_date volta como string 'YYYY-MM-DD', não Date — pg parseia DATE como objeto Date por padrão, e a UI (e o tipo EntryRow) espera string; sem o type parser em lib/db.ts, isso quebra em produção (TypeError: entry_date.slice is not a function) assim que existe pelo menos um lançamento", async () => {
    const cat = await createCategory(householdId, ledgerId, { name: "Categoria Teste" });
    if (cat.status !== "created") throw new Error("setup failed");

    await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Teste",
      amount: 10,
      categoryId: cat.category.id,
    });

    const entries = await listEntries(householdId, ledgerId, MONTH);
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].entry_date).toBe("string");
    expect(entries[0].entry_date.slice(0, 10)).toBe("2026-09-10");
  });

  it("amount_confidence é 'exact' por padrão e aceita 'approximate' explícito", async () => {
    const cat = await createCategory(householdId, ledgerId, { name: "Categoria Confianca" });
    if (cat.status !== "created") throw new Error("setup failed");

    await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-11",
      description: "Sem confiança explícita",
      amount: 15,
      categoryId: cat.category.id,
    });
    await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-11",
      description: "Valor arredondado por áudio",
      amount: 40,
      categoryId: cat.category.id,
      amountConfidence: "approximate",
    });

    const entries = await listEntries(householdId, ledgerId, MONTH);
    const exact = entries.find((e) => e.description === "Sem confiança explícita")!;
    const approximate = entries.find((e) => e.description === "Valor arredondado por áudio")!;
    expect(exact.amount_confidence).toBe("exact");
    expect(approximate.amount_confidence).toBe("approximate");
  });

  it("despesa manual sem categoria escolhida cai em 'Aguardando Revisão' em vez de bloquear", async () => {
    const awaitingReviewId = await ensureAwaitingReviewCategory(householdId, ledgerId);

    const result = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-12",
      description: "Sem categoria escolhida",
      amount: 20,
      categoryId: null,
    });
    expect(result.status).toBe("created");

    const entries = await listEntries(householdId, ledgerId, MONTH);
    const entry = entries.find((e) => e.description === "Sem categoria escolhida")!;
    expect(entry.category_id).toBe(awaitingReviewId);
  });

  it("editar lançamento pode trocar de orçamento, caindo na Aguardando Revisão do destino", async () => {
    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Suborçamento Teste', false) RETURNING id`,
      [householdId],
    );
    const otherLedgerId = ledgerRows[0].id;

    const cat = await createCategory(householdId, ledgerId, { name: "Categoria Origem" });
    if (cat.status !== "created") throw new Error("setup failed");

    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-20",
      description: "Lançamento pra mover",
      amount: 30,
      categoryId: cat.category.id,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await updateEntry(householdId, created.entry.id, { ledgerId: otherLedgerId });
    expect(result.status).toBe("updated");

    const entriesOld = await listEntries(householdId, ledgerId, MONTH);
    expect(entriesOld.find((e) => e.id === created.entry.id)).toBeUndefined();

    const otherAwaitingReviewId = await ensureAwaitingReviewCategory(householdId, otherLedgerId);
    const entriesNew = await listEntries(householdId, otherLedgerId, MONTH);
    const moved = entriesNew.find((e) => e.id === created.entry.id)!;
    expect(moved.category_id).toBe(otherAwaitingReviewId);
  });

  it("editar lançamento rejeita trocar para um orçamento de outro household", async () => {
    const { rows: otherHouseholdRows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_entries_other__') RETURNING id`,
    );
    const { rows: foreignLedgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [otherHouseholdRows[0].id],
    );

    const cat = await createCategory(householdId, ledgerId, { name: "Categoria Segura" });
    if (cat.status !== "created") throw new Error("setup failed");
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-21",
      description: "Não pode migrar de household",
      amount: 15,
      categoryId: cat.category.id,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await updateEntry(householdId, created.entry.id, { ledgerId: foreignLedgerRows[0].id });
    expect(result.status).toBe("error");

    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [otherHouseholdRows[0].id]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [otherHouseholdRows[0].id]);
  });
});

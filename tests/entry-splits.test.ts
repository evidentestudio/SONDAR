import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createEntry, listEntries, splitEntry } from "@/lib/entries/service";
import { createInstallmentPlan } from "@/lib/installment-plans/service";

const pool = getPool();
const MONTH = "2026-09";

describe("dividir lançamento em N categorias (Etapa 5)", () => {
  let householdId: string;
  let ledgerId: string;
  let mercadoId: string;
  let farmaciaId: string;
  let limpezaId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_entry_splits__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const mercado = await createCategory(householdId, ledgerId, { name: "Mercado" });
    const farmacia = await createCategory(householdId, ledgerId, { name: "Farmácia" });
    const limpeza = await createCategory(householdId, ledgerId, { name: "Limpeza" });
    if (mercado.status !== "created" || farmacia.status !== "created" || limpeza.status !== "created") {
      throw new Error("setup failed");
    }
    mercadoId = mercado.category.id;
    farmaciaId = farmacia.category.id;
    limpezaId = limpeza.category.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM installment_plans WHERE household_id = $1`, [householdId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("divide um lançamento normal em N categorias cuja soma bate com o valor original", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra grande no mercado",
      amount: 100,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 60 },
      { categoryId: farmaciaId, amount: 25 },
      { categoryId: limpezaId, amount: 15 },
    ]);
    expect(result.status).toBe("split");
    if (result.status !== "split") throw new Error("unreachable");
    expect(result.entryIds).toHaveLength(3);

    const entries = await listEntries(householdId, ledgerId, MONTH);
    // O lançamento original some (soft delete), substituído pelas 3 partes.
    expect(entries.find((e) => e.id === created.entry.id)).toBeUndefined();
    expect(entries).toHaveLength(3);

    const groupId = entries[0].split_group_id;
    expect(groupId).not.toBeNull();
    expect(entries.every((e) => e.split_group_id === groupId)).toBe(true);
    expect(entries.reduce((s, e) => s + Number(e.amount), 0)).toBeCloseTo(100, 2);

    const mercadoPart = entries.find((e) => e.category_id === mercadoId)!;
    const farmaciaPart = entries.find((e) => e.category_id === farmaciaId)!;
    const limpezaPart = entries.find((e) => e.category_id === limpezaId)!;
    expect(Number(mercadoPart.amount)).toBe(60);
    expect(Number(farmaciaPart.amount)).toBe(25);
    expect(Number(limpezaPart.amount)).toBe(15);
  });

  it("rejeita quando a soma das partes não bate com o valor original", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra",
      amount: 100,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 60 },
      { categoryId: farmaciaId, amount: 30 },
    ]);
    expect(result.status).toBe("error");

    // O lançamento original continua intacto — nada foi tocado.
    const entries = await listEntries(householdId, ledgerId, MONTH);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(created.entry.id);
  });

  it("editar uma divisão existente (+ mais uma parte) preserva a soma do GRUPO, não de uma linha só", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra",
      amount: 100,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const firstSplit = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 70 },
      { categoryId: farmaciaId, amount: 30 },
    ]);
    expect(firstSplit.status).toBe("split");
    if (firstSplit.status !== "split") throw new Error("unreachable");

    // Reabre a divisão a partir de QUALQUER uma das partes — o total a
    // preservar precisa ser 100 (a soma do grupo), não 70 nem 30.
    const secondSplit = await splitEntry(householdId, firstSplit.entryIds[0], [
      { categoryId: mercadoId, amount: 50 },
      { categoryId: farmaciaId, amount: 30 },
      { categoryId: limpezaId, amount: 20 },
    ]);
    expect(secondSplit.status).toBe("split");
    if (secondSplit.status !== "split") throw new Error("unreachable");
    expect(secondSplit.entryIds).toHaveLength(3);

    const entries = await listEntries(householdId, ledgerId, MONTH);
    expect(entries).toHaveLength(3);
    expect(entries.reduce((s, e) => s + Number(e.amount), 0)).toBeCloseTo(100, 2);
  });

  it("remover uma parte no meio (3 vira 2) ainda precisa fechar com o total do grupo", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra",
      amount: 90,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const firstSplit = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 30 },
      { categoryId: farmaciaId, amount: 30 },
      { categoryId: limpezaId, amount: 30 },
    ]);
    if (firstSplit.status !== "split") throw new Error("unreachable");

    // Remove a parte de limpeza sem redistribuir — deve rejeitar.
    const badRemoval = await splitEntry(householdId, firstSplit.entryIds[0], [
      { categoryId: mercadoId, amount: 30 },
      { categoryId: farmaciaId, amount: 30 },
    ]);
    expect(badRemoval.status).toBe("error");

    // Remove redistribuindo os 30 que sobraram — deve funcionar.
    const goodRemoval = await splitEntry(householdId, firstSplit.entryIds[0], [
      { categoryId: mercadoId, amount: 45 },
      { categoryId: farmaciaId, amount: 45 },
    ]);
    expect(goodRemoval.status).toBe("split");
  });

  it("colapsar pra 1 parte só volta a ser um lançamento normal (split_group_id null)", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra",
      amount: 100,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const split = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 60 },
      { categoryId: farmaciaId, amount: 40 },
    ]);
    if (split.status !== "split") throw new Error("unreachable");

    const collapsed = await splitEntry(householdId, split.entryIds[0], [{ categoryId: limpezaId, amount: 100 }]);
    expect(collapsed.status).toBe("split");
    if (collapsed.status !== "split") throw new Error("unreachable");
    expect(collapsed.entryIds).toHaveLength(1);

    const entries = await listEntries(householdId, ledgerId, MONTH);
    expect(entries).toHaveLength(1);
    expect(entries[0].split_group_id).toBeNull();
    expect(entries[0].category_id).toBe(limpezaId);
  });

  it("rejeita categoria inválida (não-folha ou de outro orçamento)", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Compra",
      amount: 100,
      categoryId: mercadoId,
    });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await splitEntry(householdId, created.entry.id, [
      { categoryId: mercadoId, amount: 50 },
      { categoryId: "00000000-0000-0000-0000-000000000000", amount: 50 },
    ]);
    expect(result.status).toBe("error");
  });

  it("nunca divide receita nem parcela de parcelamento", async () => {
    const income = await createEntry(householdId, {
      ledgerId,
      entryType: "income",
      entryDate: "2026-09-10",
      description: "Salário",
      amount: 100,
    });
    if (income.status !== "created") throw new Error("setup failed");
    const incomeResult = await splitEntry(householdId, income.entry.id, [
      { categoryId: null, amount: 50 },
      { categoryId: null, amount: 50 },
    ]);
    expect(incomeResult.status).toBe("error");

    const plan = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Geladeira",
      categoryId: mercadoId,
      installmentAmount: 100,
      totalInstallments: 3,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-10",
    });
    if (plan.status !== "created") throw new Error("setup failed");
    const installmentResult = await splitEntry(householdId, plan.entryId, [
      { categoryId: mercadoId, amount: 50 },
      { categoryId: farmaciaId, amount: 50 },
    ]);
    expect(installmentResult.status).toBe("error");
  });
});

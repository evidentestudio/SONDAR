import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory, ensureAwaitingReviewCategory } from "@/lib/categories/service";
import {
  advanceInstallmentsForMonth,
  createInstallmentPlan,
  getInstallmentForecastGrid,
  listInstallmentPlans,
  stopInstallmentPlan,
} from "@/lib/installment-plans/service";
import { createPaymentSource } from "@/lib/payment-sources/service";
import { dbDateToMonthKey } from "@/lib/date";

const pool = getPool();

describe("parcelamentos — Etapa 4", () => {
  let householdId: string;
  let ledgerId: string;
  let assinaturasId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_installments__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const assinaturas = await createCategory(householdId, ledgerId, { name: "Assinaturas" });
    if (assinaturas.status !== "created") throw new Error("setup failed");
    assinaturasId = assinaturas.category.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM installment_plans WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("calcula o anchor_month subtraindo (parcela atual - 1) meses da data informada", async () => {
    const result = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Hotmart Acel*acelerape",
      categoryId: assinaturasId,
      installmentAmount: 24.16,
      totalInstallments: 12,
      currentInstallmentNumber: 3,
      currentInstallmentDate: "2026-09-18",
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(dbDateToMonthKey(result.plan.anchor_month)).toBe("2026-07");

    const { rows } = await pool.query<{ description: string; installment_number: number }>(
      `SELECT description, installment_number FROM financial_entries WHERE id = $1`,
      [result.entryId],
    );
    expect(rows[0].description).toBe("Hotmart Acel*acelerape (3/12)");
    expect(rows[0].installment_number).toBe(3);
  });

  it("nunca duplica o indicador de parcela mesmo se a descrição já vier com um", async () => {
    const result = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Streaming XPTO (1/12)",
      categoryId: assinaturasId,
      installmentAmount: 30,
      totalInstallments: 12,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-05",
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.plan.description).toBe("Streaming XPTO");

    const { rows } = await pool.query<{ description: string }>(
      `SELECT description FROM financial_entries WHERE id = $1`,
      [result.entryId],
    );
    expect(rows[0].description).toBe("Streaming XPTO (1/12)");
  });

  it("recusa total de parcelas <= 1 e número de parcela fora do intervalo", async () => {
    const badTotal = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Item Qualquer",
      categoryId: assinaturasId,
      installmentAmount: 10,
      totalInstallments: 1,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-05",
    });
    expect(badTotal.status).toBe("error");

    const badNumber = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Item Qualquer",
      categoryId: assinaturasId,
      installmentAmount: 10,
      totalInstallments: 5,
      currentInstallmentNumber: 6,
      currentInstallmentDate: "2026-09-05",
    });
    expect(badNumber.status).toBe("error");
  });

  it("avança automaticamente pro próximo mês sem duplicar, e para quando termina", async () => {
    const created = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Curso Online",
      categoryId: assinaturasId,
      installmentAmount: 50,
      totalInstallments: 3,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-10",
    });
    if (created.status !== "created") throw new Error("setup failed");

    const firstRun = await advanceInstallmentsForMonth("2026-10");
    expect(firstRun.created).toBeGreaterThanOrEqual(1);

    // idempotente — rodar de novo pro mesmo mês não duplica
    const secondRun = await advanceInstallmentsForMonth("2026-10");
    const { rows: octRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM financial_entries
       WHERE installment_plan_id = $1 AND date_trunc('month', entry_date::timestamp) = '2026-10-01'::date`,
      [created.plan.id],
    );
    expect(Number(octRows[0].count)).toBe(1);
    expect(secondRun.created).toBe(0);

    // parcela 3/3 em novembro — última parcela, ainda cria
    await advanceInstallmentsForMonth("2026-11");
    const { rows: novRows } = await pool.query<{ installment_number: number }>(
      `SELECT installment_number FROM financial_entries
       WHERE installment_plan_id = $1 AND date_trunc('month', entry_date::timestamp) = '2026-11-01'::date`,
      [created.plan.id],
    );
    expect(novRows[0].installment_number).toBe(3);

    // acabou em novembro (3/3) — dezembro não gera mais nada
    await advanceInstallmentsForMonth("2026-12");
    const { rows: decRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM financial_entries
       WHERE installment_plan_id = $1 AND date_trunc('month', entry_date::timestamp) = '2026-12-01'::date`,
      [created.plan.id],
    );
    expect(Number(decRows[0].count)).toBe(0);
  });

  it("cancelar um parcelamento para o avanço automático sem mexer nas parcelas já lançadas", async () => {
    const created = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Compra Cancelável",
      categoryId: assinaturasId,
      installmentAmount: 20,
      totalInstallments: 6,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-01",
    });
    if (created.status !== "created") throw new Error("setup failed");

    const stopped = await stopInstallmentPlan(householdId, created.plan.id);
    expect(stopped.status).toBe("stopped");

    await advanceInstallmentsForMonth("2026-10");
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM financial_entries WHERE installment_plan_id = $1`,
      [created.plan.id],
    );
    // só a parcela 1, criada antes de cancelar
    expect(Number(rows[0].count)).toBe(1);

    const plans = await listInstallmentPlans(householdId, ledgerId);
    expect(plans.find((p) => p.id === created.plan.id)).toBeUndefined();
  });

  it("categoria que virou grupo (ganhou subcategoria) não trava o avanço — cai em Aguardando Revisão", async () => {
    const soloCategory = await createCategory(householdId, ledgerId, { name: "Vai Virar Grupo" });
    if (soloCategory.status !== "created") throw new Error("setup failed");

    const created = await createInstallmentPlan(householdId, {
      ledgerId,
      description: "Parcelamento Categoria Instável",
      categoryId: soloCategory.category.id,
      installmentAmount: 15,
      totalInstallments: 4,
      currentInstallmentNumber: 1,
      currentInstallmentDate: "2026-09-01",
    });
    if (created.status !== "created") throw new Error("setup failed");

    await createCategory(householdId, ledgerId, {
      name: "Subcategoria Nova",
      parentId: soloCategory.category.id,
    });

    await advanceInstallmentsForMonth("2026-10");
    const awaitingReviewId = await ensureAwaitingReviewCategory(householdId, ledgerId);

    const { rows } = await pool.query<{ category_id: string }>(
      `SELECT category_id FROM financial_entries
       WHERE installment_plan_id = $1 AND date_trunc('month', entry_date::timestamp) = '2026-10-01'::date`,
      [created.plan.id],
    );
    expect(rows[0].category_id).toBe(awaitingReviewId);
  });

  describe("projeção de parcelas", () => {
    it("grade inclui o mês inicial (já real) e os futuros (previsto)", async () => {
      const created = await createInstallmentPlan(householdId, {
        ledgerId,
        description: "Notebook Parcelado",
        categoryId: assinaturasId,
        installmentAmount: 100,
        totalInstallments: 3,
        currentInstallmentNumber: 1,
        currentInstallmentDate: "2026-09-05",
      });
      if (created.status !== "created") throw new Error("setup failed");

      const grid = await getInstallmentForecastGrid(householdId, ledgerId, { fromMonth: "2026-09" });
      const row = grid.plans.find((p) => p.planId === created.plan.id)!;

      expect(row.cells.map((c) => c.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
      expect(row.cells[0]).toMatchObject({ isReal: true, installmentNumber: 1, amount: 100 });
      expect(row.cells[1]).toMatchObject({ isReal: false, installmentNumber: 2, amount: 100 });
      expect(row.cells[2]).toMatchObject({ isReal: false, installmentNumber: 3, amount: 100 });
      expect(grid.totalsByMonth["2026-09"]).toBeGreaterThanOrEqual(100);
    });

    it("marca como real o mês já lançado pelo avanço automático", async () => {
      const created = await createInstallmentPlan(householdId, {
        ledgerId,
        description: "Curso Parcelado",
        categoryId: assinaturasId,
        installmentAmount: 40,
        totalInstallments: 4,
        currentInstallmentNumber: 1,
        currentInstallmentDate: "2026-09-01",
      });
      if (created.status !== "created") throw new Error("setup failed");

      await advanceInstallmentsForMonth("2026-10");

      const grid = await getInstallmentForecastGrid(householdId, ledgerId, { fromMonth: "2026-09" });
      const row = grid.plans.find((p) => p.planId === created.plan.id)!;

      expect(row.cells.map((c) => ({ month: c.month, isReal: c.isReal }))).toEqual([
        { month: "2026-09", isReal: true },
        { month: "2026-10", isReal: true },
        { month: "2026-11", isReal: false },
        { month: "2026-12", isReal: false },
      ]);
    });

    it("não inclui plano já totalmente concluído antes do mês inicial", async () => {
      const created = await createInstallmentPlan(householdId, {
        ledgerId,
        description: "Compra Já Quitada",
        categoryId: assinaturasId,
        installmentAmount: 10,
        totalInstallments: 2,
        currentInstallmentNumber: 2,
        currentInstallmentDate: "2026-09-01",
      });
      if (created.status !== "created") throw new Error("setup failed");

      const grid = await getInstallmentForecastGrid(householdId, ledgerId, { fromMonth: "2026-10" });
      expect(grid.plans.find((p) => p.planId === created.plan.id)).toBeUndefined();
    });

    it("filtra a projeção por forma de pagamento", async () => {
      const pix = await createPaymentSource(householdId, { name: "Pix Projeção Teste" });
      const cartao = await createPaymentSource(householdId, { name: "Cartão Projeção Teste" });
      if (pix.status !== "created" || cartao.status !== "created") throw new Error("setup failed");

      const created = await createInstallmentPlan(householdId, {
        ledgerId,
        description: "Compra no Pix Parcelado",
        categoryId: assinaturasId,
        paymentSourceId: pix.source.id,
        installmentAmount: 25,
        totalInstallments: 3,
        currentInstallmentNumber: 1,
        currentInstallmentDate: "2026-09-01",
      });
      if (created.status !== "created") throw new Error("setup failed");

      const matching = await getInstallmentForecastGrid(householdId, ledgerId, {
        paymentSourceId: pix.source.id,
        fromMonth: "2026-09",
      });
      expect(matching.plans.some((p) => p.planId === created.plan.id)).toBe(true);

      const other = await getInstallmentForecastGrid(householdId, ledgerId, {
        paymentSourceId: cartao.source.id,
        fromMonth: "2026-09",
      });
      expect(other.plans.some((p) => p.planId === created.plan.id)).toBe(false);
    });
  });
});

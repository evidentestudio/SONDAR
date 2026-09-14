import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createDashboardFilter, deleteDashboardFilter, listDashboardFilters } from "@/lib/dashboard-filters/service";

const pool = getPool();

describe("filtros salvos do painel (Etapa 6 — 'painel economizável' é um filtro nomeado)", () => {
  let householdId: string;
  let ledgerId: string;
  let mercadoId: string;
  let assinaturasId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_dashboard_filters__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const mercado = await createCategory(householdId, ledgerId, { name: "Mercado" });
    const assinaturas = await createCategory(householdId, ledgerId, { name: "Assinaturas" });
    if (mercado.status !== "created" || assinaturas.status !== "created") throw new Error("setup failed");
    mercadoId = mercado.category.id;
    assinaturasId = assinaturas.category.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM dashboard_filters WHERE household_id = $1`, [householdId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("cria um filtro nomeado com as categorias escolhidas pela pessoa", async () => {
    const result = await createDashboardFilter(householdId, ledgerId, {
      name: "Economizável",
      categoryIds: [mercadoId],
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.filter.name).toBe("Economizável");
    expect(result.filter.category_ids).toEqual([mercadoId]);

    const filters = await listDashboardFilters(householdId, ledgerId);
    expect(filters).toHaveLength(1);
    expect(filters[0].category_ids).toContain(mercadoId);
  });

  it("recusa nome vazio", async () => {
    const result = await createDashboardFilter(householdId, ledgerId, { name: "   ", categoryIds: [mercadoId] });
    expect(result.status).toBe("error");
  });

  it("recusa filtro sem nenhuma categoria", async () => {
    const result = await createDashboardFilter(householdId, ledgerId, { name: "Vazio", categoryIds: [] });
    expect(result.status).toBe("error");
  });

  it("recusa categoria que não é folha (categoria-mãe com subcategoria)", async () => {
    const parent = await createCategory(householdId, ledgerId, { name: "Carro" });
    if (parent.status !== "created") throw new Error("setup failed");
    await createCategory(householdId, ledgerId, { name: "Combustível", parentId: parent.category.id });

    const result = await createDashboardFilter(householdId, ledgerId, {
      name: "Inválido",
      categoryIds: [parent.category.id],
    });
    expect(result.status).toBe("error");
  });

  it("recusa nome duplicado no mesmo orçamento, insensível a acento/caixa", async () => {
    const first = await createDashboardFilter(householdId, ledgerId, {
      name: "Economizável",
      categoryIds: [mercadoId],
    });
    expect(first.status).toBe("created");

    const duplicate = await createDashboardFilter(householdId, ledgerId, {
      name: "ECONOMIZAVEL",
      categoryIds: [assinaturasId],
    });
    expect(duplicate.status).toBe("error");
  });

  it("mesmo nome é permitido em orçamentos diferentes — filtros são por orçamento", async () => {
    const { rows: otherLedgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name) VALUES ($1, 'Empresa') RETURNING id`,
      [householdId],
    );
    const otherLedgerId = otherLedgerRows[0].id;
    const otherCategory = await createCategory(householdId, otherLedgerId, { name: "Despesas Empresa" });
    if (otherCategory.status !== "created") throw new Error("setup failed");

    const first = await createDashboardFilter(householdId, ledgerId, {
      name: "Economizável",
      categoryIds: [mercadoId],
    });
    expect(first.status).toBe("created");

    const second = await createDashboardFilter(householdId, otherLedgerId, {
      name: "Economizável",
      categoryIds: [otherCategory.category.id],
    });
    expect(second.status).toBe("created");

    await pool.query(`DELETE FROM dashboard_filters WHERE ledger_id = $1`, [otherLedgerId]);
    await pool.query(`DELETE FROM categories WHERE ledger_id = $1`, [otherLedgerId]);
    await pool.query(`DELETE FROM ledgers WHERE id = $1`, [otherLedgerId]);
  });

  it("exclui um filtro salvo", async () => {
    const created = await createDashboardFilter(householdId, ledgerId, {
      name: "Temporário",
      categoryIds: [mercadoId],
    });
    if (created.status !== "created") throw new Error("setup failed");

    await deleteDashboardFilter(householdId, created.filter.id);

    const filters = await listDashboardFilters(householdId, ledgerId);
    expect(filters.find((f) => f.id === created.filter.id)).toBeUndefined();
  });
});

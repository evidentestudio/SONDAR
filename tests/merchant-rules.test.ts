import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createMerchantRule, findMatchingRule } from "@/lib/merchant-rules/service";

const pool = getPool();

describe("regras de estabelecimento", () => {
  let householdId: string;
  let mercadoId: string;
  let assinaturasId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_rules__') RETURNING id`,
    );
    householdId = rows[0].id;

    const mercado = await createCategory(householdId, { name: "Mercado" });
    const assinaturas = await createCategory(householdId, { name: "Assinaturas" });
    if (mercado.status !== "created" || assinaturas.status !== "created") {
      throw new Error("setup failed");
    }
    mercadoId = mercado.category.id;
    assinaturasId = assinaturas.category.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM merchant_rules WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("regra casa mesmo com erro de grafia/acento no lançamento", async () => {
    const rule = await createMerchantRule(householdId, { pattern: "ifood", categoryId: mercadoId });
    expect(rule.status).toBe("created");

    const match = await findMatchingRule(householdId, "IFOOD*Restaurante Bom Ltda");
    expect(match).toEqual({
      type: "matched",
      categoryId: mercadoId,
      categoryName: "Mercado",
      ruleId: expect.any(String),
      pattern: "ifood",
    });
  });

  it("regra ambígua nunca aplica categoria sozinha — força revisão", async () => {
    await createMerchantRule(householdId, {
      pattern: "anthropic",
      categoryId: assinaturasId,
      isAmbiguous: true,
    });

    const match = await findMatchingRule(householdId, "ANTHROPIC PBC");
    expect(match.type).toBe("ambiguous");
  });

  it("recusa padrão duplicado", async () => {
    const result = await createMerchantRule(householdId, { pattern: "IFOOD", categoryId: mercadoId });
    expect(result.status).toBe("error");
  });

  it("recusa categoria que não é folha", async () => {
    const parent = await createCategory(householdId, { name: "Carro" });
    if (parent.status !== "created") throw new Error("setup failed");
    await createCategory(householdId, { name: "Combustível", parentId: parent.category.id });

    const result = await createMerchantRule(householdId, {
      pattern: "posto",
      categoryId: parent.category.id,
    });
    expect(result.status).toBe("error");
  });

  it("descrição sem nenhuma regra correspondente não casa nada", async () => {
    const match = await findMatchingRule(householdId, "Loja Qualquer Sem Relação");
    expect(match.type).toBe("none");
  });
});

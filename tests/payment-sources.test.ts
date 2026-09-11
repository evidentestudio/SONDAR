import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import {
  createPaymentSource,
  deletePaymentSource,
  listPaymentSources,
  resolvePaymentSourceHint,
  setDefaultPaymentSource,
} from "@/lib/payment-sources/service";

const pool = getPool();

describe("formas de pagamento", () => {
  let householdId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_payment_sources__') RETURNING id`,
    );
    householdId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM payment_sources WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("permite criar forma de pagamento com o mesmo nome de uma já excluída", async () => {
    const first = await createPaymentSource(householdId, { name: "Pix" });
    if (first.status !== "created") throw new Error("setup failed");

    await deletePaymentSource(householdId, first.source.id);

    const second = await createPaymentSource(householdId, { name: "Pix" });
    expect(second.status).toBe("created");
  });

  it("só uma forma de pagamento é principal por vez", async () => {
    const a = await createPaymentSource(householdId, { name: "Cartão de Crédito" });
    const b = await createPaymentSource(householdId, { name: "Carteira" });
    if (a.status !== "created" || b.status !== "created") throw new Error("setup failed");

    await setDefaultPaymentSource(householdId, a.source.id);
    let sources = await listPaymentSources(householdId);
    expect(sources.find((s) => s.id === a.source.id)?.is_default).toBe(true);
    expect(sources.find((s) => s.id === b.source.id)?.is_default).toBe(false);

    await setDefaultPaymentSource(householdId, b.source.id);
    sources = await listPaymentSources(householdId);
    expect(sources.find((s) => s.id === a.source.id)?.is_default).toBe(false);
    expect(sources.find((s) => s.id === b.source.id)?.is_default).toBe(true);
  });

  describe("resolvePaymentSourceHint (extração de áudio)", () => {
    it("resolve um termo falado contra o nome real, tolerando variação", async () => {
      const cartao = await createPaymentSource(householdId, { name: "Cartão de Crédito" });
      if (cartao.status !== "created") throw new Error("setup failed");

      const resolved = await resolvePaymentSourceHint(householdId, "cartao");
      expect(resolved?.id).toBe(cartao.source.id);
    });

    it("retorna null quando não reconhece o termo — nunca inventa forma nova", async () => {
      const resolved = await resolvePaymentSourceHint(householdId, "criptomoeda");
      expect(resolved).toBeNull();
    });
  });
});

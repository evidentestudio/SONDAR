import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import {
  createLedger,
  deleteLedger,
  ensureDefaultLedger,
  listLedgers,
  resolveLedgerId,
  updateLedger,
} from "@/lib/ledgers/service";
import { createCategory } from "@/lib/categories/service";

const pool = getPool();

describe("orçamentos paralelos (ledgers) — Etapa 3.5", () => {
  let householdId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_ledgers__') RETURNING id`,
    );
    householdId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("cria o Principal automaticamente e de forma idempotente", async () => {
    const first = await ensureDefaultLedger(householdId);
    const second = await ensureDefaultLedger(householdId);
    expect(first).toBe(second);

    const ledgers = await listLedgers(householdId);
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ name: "Principal", is_default: true });
  });

  it("usuário cria suborçamentos livremente, com qualquer nome", async () => {
    const reserva = await createLedger(householdId, { name: "Reserva de Emergência" });
    const empresa = await createLedger(householdId, { name: "Empresa" });
    expect(reserva.status).toBe("created");
    expect(empresa.status).toBe("created");

    const ledgers = await listLedgers(householdId);
    expect(ledgers.map((l) => l.name)).toEqual(
      expect.arrayContaining(["Principal", "Reserva de Emergência", "Empresa"]),
    );
  });

  it("recusa nome duplicado (normalizado)", async () => {
    const result = await createLedger(householdId, { name: "empresa" });
    expect(result.status).toBe("error");
  });

  it("renomeia um suborçamento", async () => {
    const created = await createLedger(householdId, { name: "Mesadas" });
    if (created.status !== "created") throw new Error("setup failed");

    const renamed = await updateLedger(householdId, created.ledger.id, { name: "Mesadas dos Filhos" });
    expect(renamed.status).toBe("updated");
    if (renamed.status !== "updated") throw new Error("unreachable");
    expect(renamed.ledger.name).toBe("Mesadas dos Filhos");
  });

  it("nunca deixa excluir o orçamento Principal", async () => {
    const defaultId = await ensureDefaultLedger(householdId);
    const result = await deleteLedger(householdId, defaultId);
    expect(result.status).toBe("error");
  });

  it("recusa excluir suborçamento que ainda tem categorias", async () => {
    const created = await createLedger(householdId, { name: "Investimentos" });
    if (created.status !== "created") throw new Error("setup failed");

    await createCategory(householdId, created.ledger.id, { name: "Ações" });

    const result = await deleteLedger(householdId, created.ledger.id);
    expect(result.status).toBe("error");
  });

  it("exclui suborçamento vazio normalmente", async () => {
    const created = await createLedger(householdId, { name: "Suborçamento Vazio" });
    if (created.status !== "created") throw new Error("setup failed");

    const result = await deleteLedger(householdId, created.ledger.id);
    expect(result.status).toBe("deleted");
  });

  it("mesmo nome de categoria pode existir em dois orçamentos diferentes", async () => {
    const defaultId = await ensureDefaultLedger(householdId);
    const other = await createLedger(householdId, { name: "Orçamento Paralelo" });
    if (other.status !== "created") throw new Error("setup failed");

    const inDefault = await createCategory(householdId, defaultId, { name: "Combustível" });
    const inOther = await createCategory(householdId, other.ledger.id, { name: "Combustível" });
    expect(inDefault.status).toBe("created");
    expect(inOther.status).toBe("created");
  });

  it("resolveLedgerId cai pro Principal quando o id pedido não pertence ao household", async () => {
    const resolved = await resolveLedgerId(householdId, "00000000-0000-0000-0000-000000000000");
    const defaultId = await ensureDefaultLedger(householdId);
    expect(resolved).toBe(defaultId);
  });
});

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { getPool } from "@/lib/db";
import {
  createCategory,
  deleteCategory,
  ensureAwaitingReviewCategory,
  getCategoryTree,
  updateCategory,
} from "@/lib/categories/service";

const pool = getPool();

describe("categorias — Etapa 1", () => {
  let householdId: string;
  let ledgerId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_categories__') RETURNING id`,
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

  beforeEach(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  });

  describe("onboarding", () => {
    it("nenhuma categoria existe até o onboarding rodar", async () => {
      const tree = await getCategoryTree(householdId, ledgerId);
      expect(tree).toEqual([]);
    });

    it("cria exatamente 'Aguardando Revisão', nenhuma reserva pré-criada", async () => {
      await ensureAwaitingReviewCategory(householdId, ledgerId);
      const tree = await getCategoryTree(householdId, ledgerId);
      expect(tree).toHaveLength(1);
      expect(tree[0]).toMatchObject({ name: "Aguardando Revisão", category_type: "awaiting_review" });
    });

    it("é idempotente — rodar de novo não duplica", async () => {
      await ensureAwaitingReviewCategory(householdId, ledgerId);
      await ensureAwaitingReviewCategory(householdId, ledgerId);
      await ensureAwaitingReviewCategory(householdId, ledgerId);
      const tree = await getCategoryTree(householdId, ledgerId);
      expect(tree).toHaveLength(1);
    });
  });

  describe("normalização de nome (bug MESADA PAPAI)", () => {
    it("impede duplicata por maiúscula", async () => {
      const first = await createCategory(householdId, ledgerId, { name: "Mesada Papai" });
      expect(first.status).toBe("created");

      const dup = await createCategory(householdId, ledgerId, { name: "MESADA PAPAI" });
      expect(dup.status).toBe("error");
    });

    it("impede duplicata por acento", async () => {
      const first = await createCategory(householdId, ledgerId, { name: "Educação" });
      expect(first.status).toBe("created");

      const dup = await createCategory(householdId, ledgerId, { name: "educacao" });
      expect(dup.status).toBe("error");
    });
  });

  describe("fusão de subcategoria com categoria existente", () => {
    it("sinaliza colisão sem confirmMerge", async () => {
      await createCategory(householdId, ledgerId, { name: "Internet" });
      const carro = await createCategory(householdId, ledgerId, { name: "Carro" });
      if (carro.status !== "created") throw new Error("setup failed");

      const result = await createCategory(householdId, ledgerId, {
        name: "Internet",
        parentId: carro.category.id,
      });
      expect(result.status).toBe("collision");
    });

    it("reaproveita o mesmo id ao confirmar (não duplica lançamento nenhum)", async () => {
      const internet = await createCategory(householdId, ledgerId, { name: "Internet" });
      const carro = await createCategory(householdId, ledgerId, { name: "Carro" });
      if (internet.status !== "created" || carro.status !== "created") {
        throw new Error("setup failed");
      }

      const merged = await createCategory(householdId, ledgerId, {
        name: "Internet",
        parentId: carro.category.id,
        confirmMerge: true,
      });
      expect(merged.status).toBe("merged");
      if (merged.status !== "merged") throw new Error("unreachable");
      expect(merged.category.id).toBe(internet.category.id);
      expect(merged.category.parent_id).toBe(carro.category.id);

      const tree = await getCategoryTree(householdId, ledgerId);
      const carroNode = tree.find((c) => c.id === carro.category.id)!;
      expect(carroNode.children).toHaveLength(1);
      expect(carroNode.children[0].id).toBe(internet.category.id);
    });

    it("não permite subcategoria de subcategoria", async () => {
      const carro = await createCategory(householdId, ledgerId, { name: "Carro" });
      if (carro.status !== "created") throw new Error("setup failed");
      const sub = await createCategory(householdId, ledgerId, {
        name: "Combustível",
        parentId: carro.category.id,
      });
      if (sub.status !== "created") throw new Error("setup failed");

      const result = await createCategory(householdId, ledgerId, {
        name: "Gasolina Aditivada",
        parentId: sub.category.id,
      });
      expect(result.status).toBe("error");
    });
  });

  describe("ordenação", () => {
    it("normal alfabética primeiro, depois reserve, depois awaiting_review por último", async () => {
      await ensureAwaitingReviewCategory(householdId, ledgerId);
      await createCategory(householdId, ledgerId, { name: "Zebra" });
      await createCategory(householdId, ledgerId, { name: "Alimentação" });
      await createCategory(householdId, ledgerId, { name: "Reserva de emergência", categoryType: "reserve" });

      const tree = await getCategoryTree(householdId, ledgerId);
      expect(tree.map((c) => c.name)).toEqual([
        "Alimentação",
        "Zebra",
        "Reserva de emergência",
        "Aguardando Revisão",
      ]);
    });
  });

  describe("exclusão com lançamentos existentes", () => {
    it("pede decisão quando há lançamentos, e move ao decidir 'move'", async () => {
      const origem = await createCategory(householdId, ledgerId, { name: "Lazer" });
      const destino = await createCategory(householdId, ledgerId, { name: "Outros" });
      if (origem.status !== "created" || destino.status !== "created") {
        throw new Error("setup failed");
      }

      await pool.query(
        `INSERT INTO financial_entries (household_id, ledger_id, entry_type, entry_date, description, amount, category_id)
         VALUES ($1, $2, 'expense', '2026-09-01', 'Cinema', 50.00, $3)`,
        [householdId, ledgerId, origem.category.id],
      );

      const needsDecision = await deleteCategory(householdId, origem.category.id);
      expect(needsDecision).toEqual({ status: "needs_decision", entryCount: 1 });

      const moved = await deleteCategory(householdId, origem.category.id, {
        onEntries: "move",
        moveToCategoryId: destino.category.id,
      });
      expect(moved.status).toBe("deleted");

      const { rows } = await pool.query<{ category_id: string }>(
        `SELECT category_id FROM financial_entries WHERE description = 'Cinema' AND deleted_at IS NULL`,
      );
      expect(rows[0].category_id).toBe(destino.category.id);
    });

    it("exclui os lançamentos junto ao decidir 'delete'", async () => {
      const origem = await createCategory(householdId, ledgerId, { name: "Assinaturas" });
      if (origem.status !== "created") throw new Error("setup failed");

      await pool.query(
        `INSERT INTO financial_entries (household_id, ledger_id, entry_type, entry_date, description, amount, category_id)
         VALUES ($1, $2, 'expense', '2026-09-01', 'Streaming', 30.00, $3)`,
        [householdId, ledgerId, origem.category.id],
      );

      const result = await deleteCategory(householdId, origem.category.id, { onEntries: "delete" });
      expect(result.status).toBe("deleted");

      const { rows } = await pool.query<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM financial_entries WHERE description = 'Streaming'`,
      );
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it("exclui direto sem perguntar quando não há lançamentos", async () => {
      const cat = await createCategory(householdId, ledgerId, { name: "Categoria Vazia" });
      if (cat.status !== "created") throw new Error("setup failed");

      const result = await deleteCategory(householdId, cat.category.id);
      expect(result.status).toBe("deleted");
    });

    it("recusa excluir categoria que ainda tem subcategorias", async () => {
      const carro = await createCategory(householdId, ledgerId, { name: "Carro" });
      if (carro.status !== "created") throw new Error("setup failed");
      const sub = await createCategory(householdId, ledgerId, {
        name: "Estacionamento",
        parentId: carro.category.id,
      });
      if (sub.status !== "created") throw new Error("setup failed");

      const result = await deleteCategory(householdId, carro.category.id);
      expect(result.status).toBe("error");
    });
  });

  describe("edição", () => {
    it("renomear passa pela mesma checagem de duplicata", async () => {
      const a = await createCategory(householdId, ledgerId, { name: "Categoria A" });
      const b = await createCategory(householdId, ledgerId, { name: "Categoria B" });
      if (a.status !== "created" || b.status !== "created") throw new Error("setup failed");

      const result = await updateCategory(householdId, b.category.id, { name: "categoria a" });
      expect(result.status).toBe("error");
    });

    it("atualiza cor sem exigir nome", async () => {
      const cat = await createCategory(householdId, ledgerId, { name: "Saúde" });
      if (cat.status !== "created") throw new Error("setup failed");

      const result = await updateCategory(householdId, cat.category.id, { color: "#FF0000" });
      expect(result.status).toBe("updated");
      if (result.status !== "updated") throw new Error("unreachable");
      expect(result.category.color).toBe("#FF0000");
      expect(result.category.name).toBe("Saúde");
    });
  });
});

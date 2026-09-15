import { describe, expect, it } from "vitest";
import { planRedistribution, type CategoryBudgetInput } from "@/lib/radar/redistribution";

function cat(categoryId: string, label: string, orcado: number, gasto: number): CategoryBudgetInput {
  return { categoryId, label, orcado, gasto };
}

describe("planRedistribution — 'não estourar a meta' (Radar Financeiro)", () => {
  it("sem nenhuma categoria estourada, não muda nada", () => {
    const plan = planRedistribution(
      [cat("a", "Mercado", 500, 300), cat("b", "Lazer", 200, 150)],
      "nao_estourar",
      null,
    );
    expect(plan.status).toBe("ok");
    if (plan.status === "ok") {
      expect(plan.items).toEqual([]);
      expect(plan.totalBefore).toBe(plan.totalAfter);
    }
  });

  it("fecha o estouro de uma categoria puxando folga de outra, preservando o total orçado", () => {
    // Mercado estourou 100 (gasto 600, orçado 500); Lazer tem 100 de folga.
    const plan = planRedistribution(
      [cat("a", "Mercado", 500, 600), cat("b", "Lazer", 200, 100)],
      "nao_estourar",
      null,
    );
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") throw new Error("unreachable");
    const mercado = plan.items.find((i) => i.categoryId === "a")!;
    const lazer = plan.items.find((i) => i.categoryId === "b")!;
    expect(mercado.newOrcado).toBe(600); // sobe até bater com o gasto — deixa de estourar
    expect(lazer.newOrcado).toBe(100); // perde exatamente a folga usada
    expect(plan.totalAfter).toBe(plan.totalBefore); // redistribuição, nunca cria dinheiro novo
  });

  it("divide a folga proporcionalmente quando há mais de uma categoria com espaço", () => {
    // Estouro de 90; duas categorias com folga de 60 e 30 (2:1) — cada uma
    // cede sua fatia proporcional (60 e 30) até fechar os 90.
    const plan = planRedistribution(
      [cat("a", "Mercado", 100, 190), cat("b", "Lazer", 160, 100), cat("c", "Assinaturas", 80, 50)],
      "nao_estourar",
      null,
    );
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") throw new Error("unreachable");
    const lazer = plan.items.find((i) => i.categoryId === "b")!;
    const assinaturas = plan.items.find((i) => i.categoryId === "c")!;
    expect(lazer.newOrcado).toBe(100); // 160 - 60
    expect(assinaturas.newOrcado).toBe(50); // 80 - 30
  });

  it("meta irrealista: folga selecionada não cobre o estouro", () => {
    const plan = planRedistribution([cat("a", "Mercado", 100, 300), cat("b", "Lazer", 100, 90)], "nao_estourar", null);
    expect(plan.status).toBe("infeasible");
    if (plan.status !== "infeasible") throw new Error("unreachable");
    expect(plan.maxFeasible).toBe(10); // folga real disponível (100-90)
    expect(plan.message).toContain("R$");
  });
});

describe("planRedistribution — 'economizar R$X' (base: orçado total atual)", () => {
  it("corta proporcionalmente a folga das categorias selecionadas até bater a meta", () => {
    // Folga total = (500-300) + (200-50) = 200 + 150 = 350. Meta de 70 → corta
    // 40% da folga de cada uma (70/350).
    const plan = planRedistribution(
      [cat("a", "Mercado", 500, 300), cat("b", "Lazer", 200, 50)],
      "economizar",
      70,
    );
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") throw new Error("unreachable");
    const mercado = plan.items.find((i) => i.categoryId === "a")!;
    const lazer = plan.items.find((i) => i.categoryId === "b")!;
    expect(mercado.newOrcado).toBe(460); // 500 - 200*(70/350)=500-40
    expect(lazer.newOrcado).toBe(170); // 200 - 150*(70/350)=200-30
    expect(plan.totalAfter).toBe(plan.totalBefore - 70);
  });

  it("nunca corta um orçado abaixo do que já foi gasto no mês", () => {
    const plan = planRedistribution([cat("a", "Mercado", 500, 300)], "economizar", 200);
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") throw new Error("unreachable");
    expect(plan.items[0].newOrcado).toBe(300); // toda a folga (200) usada, nunca menos que o gasto
  });

  it("meta maior que a folga disponível é irrealista — nada é alterado", () => {
    const plan = planRedistribution([cat("a", "Mercado", 500, 450)], "economizar", 100);
    expect(plan.status).toBe("infeasible");
    if (plan.status !== "infeasible") throw new Error("unreachable");
    expect(plan.maxFeasible).toBe(50);
  });

  it("recusa meta zero ou negativa", () => {
    const zero = planRedistribution([cat("a", "Mercado", 500, 300)], "economizar", 0);
    expect(zero.status).toBe("infeasible");
    const negative = planRedistribution([cat("a", "Mercado", 500, 300)], "economizar", -50);
    expect(negative.status).toBe("infeasible");
  });
});

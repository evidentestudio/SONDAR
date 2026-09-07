import { describe, expect, it } from "vitest";
import { normalizeStr, levenshtein, fuzzyMatch } from "@/lib/text/normalize";

describe("normalizeStr", () => {
  it("remove acentos, baixa caixa, colapsa pontuação", () => {
    expect(normalizeStr("São João!!")).toBe("sao joao");
    expect(normalizeStr("IFOOD*Restaurante-Bom")).toBe("ifood restaurante bom");
  });
});

describe("levenshtein", () => {
  it("conta edições mínimas", () => {
    expect(levenshtein("resturante", "restaurante")).toBe(1);
    expect(levenshtein("ifood", "ifood")).toBe(0);
  });
});

describe("fuzzyMatch — tolerante a erro de grafia/acento", () => {
  it("casa substring direta", () => {
    expect(fuzzyMatch(normalizeStr("IFOOD*Restaurante Bom"), normalizeStr("ifood"))).toBe(true);
  });

  it("tolera pequeno erro de digitação", () => {
    expect(fuzzyMatch(normalizeStr("Anthropc Serviços"), normalizeStr("anthropic"))).toBe(true);
  });

  it("não casa nomes sem relação", () => {
    expect(fuzzyMatch(normalizeStr("Padaria do Bairro"), normalizeStr("netflix"))).toBe(false);
  });
});

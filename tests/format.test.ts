import { describe, expect, it } from "vitest";
import { parseBRLAmount, toAmountInputValue } from "@/lib/format";

describe("parseBRLAmount — formato brasileiro (ponto = milhar, vírgula = decimal)", () => {
  it("número sem separador", () => {
    expect(parseBRLAmount("15000")).toBe(15000);
  });

  it("ponto como separador de milhar (bug real: virava 15)", () => {
    expect(parseBRLAmount("15.000")).toBe(15000);
  });

  it("vírgula como separador decimal", () => {
    expect(parseBRLAmount("15,50")).toBe(15.5);
  });

  it("milhar e decimal juntos", () => {
    expect(parseBRLAmount("1.234.567,89")).toBe(1234567.89);
  });
});

describe("toAmountInputValue — número da API vira campo editável em formato BR", () => {
  it("usa vírgula, não ponto, como decimal (bug real: campo mostrava '133.33')", () => {
    expect(toAmountInputValue(133.33)).toBe("133,33");
  });

  it("sempre duas casas decimais", () => {
    expect(toAmountInputValue(50)).toBe("50,00");
  });

  it("é o inverso de parseBRLAmount pra qualquer valor com centavos exatos", () => {
    expect(parseBRLAmount(toAmountInputValue(24.16))).toBe(24.16);
  });
});

import { describe, expect, it } from "vitest";
import { parseBRLAmount } from "@/lib/format";

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

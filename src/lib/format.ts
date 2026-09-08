const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(amount: number): string {
  return currencyFormatter.format(amount);
}

/**
 * Parses a monetary value typed in Brazilian format: "." is always a
 * thousands separator, "," is always the decimal separator (e.g. "15.000,50"
 * -> 15000.5, "15.000" -> 15000). A naive `.replace(",", ".")` gets the
 * comma case right but leaves stray thousands dots in place, so "15.000"
 * silently parses as 15 — a real bug found while testing Etapa 2.
 */
export function parseBRLAmount(input: string): number {
  const cleaned = input.trim().replace(/\./g, "").replace(",", ".");
  return Number(cleaned);
}

/**
 * Formats a number for an editable amount field using Brazilian decimal
 * notation (comma, two places) — the inverse of parseBRLAmount, and what an
 * input pre-filled from a number (an AI-extracted value, an existing entry
 * being edited) needs to show instead of JS's own "133.33".
 */
export function toAmountInputValue(amount: number): string {
  return amount.toFixed(2).replace(".", ",");
}

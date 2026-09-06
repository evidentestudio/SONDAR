const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(amount: number): string {
  return currencyFormatter.format(amount);
}

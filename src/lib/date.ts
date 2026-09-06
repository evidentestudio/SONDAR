/**
 * Months are represented as plain "YYYY-MM" strings everywhere in the app
 * (API payloads, service functions) — never as JS Date objects — to avoid
 * timezone-shift bugs around month boundaries. Only monthToDbDate() crosses
 * into an actual DATE string for Postgres (always day 1, UTC-agnostic).
 */

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function isValidMonthKey(value: string): boolean {
  if (!MONTH_KEY_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function monthToDbDate(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) throw new Error(`Invalid month key: ${monthKey}`);
  return `${monthKey}-01`;
}

export function dbDateToMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function currentMonthKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function addMonthsToKey(monthKey: string, delta: number): string {
  if (!isValidMonthKey(monthKey)) throw new Error(`Invalid month key: ${monthKey}`);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const totalMonths = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

export function previousMonthKey(monthKey: string): string {
  return addMonthsToKey(monthKey, -1);
}

export function nextMonthKey(monthKey: string): string {
  return addMonthsToKey(monthKey, 1);
}

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function formatMonthLabel(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) return monthKey;
  const year = monthKey.slice(0, 4);
  const month = Number(monthKey.slice(5, 7));
  return `${MONTH_NAMES_PT[month - 1]} de ${year}`;
}

/**
 * dashboardAggregation.js — Phase 6. Pure aggregation functions for the
 * Dashboard screen (PROJECT_SPEC.md §3.9): totals, spending by category,
 * top merchants, and monthly evolution.
 *
 * These functions take an already-filtered array of transactions (the
 * Dashboard screen applies the shared filters.js logic first, per §3.8) and
 * compute numbers from it. They have no DOM dependency and no SQL — like
 * domain/money.js, this is plain money math, kept in integer minor units
 * throughout (ARCHITECTURE.md §6: "no floating-point arithmetic for
 * financial values, anywhere in the domain layer"). dashboard.js (the UI
 * module) is responsible for feeding these functions filtered data and
 * rendering the results as charts/text.
 */

import { sum } from './money.js';
import { isExpense, isIncome } from './transaction.js';

const UNCATEGORIZED_LABEL = 'Uncategorized';

/**
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {string} YYYY-MM
 *
 * Deliberately duplicated (not imported) from ui-utils.js's toMonthKey():
 * this file lives in domain/, and ARCHITECTURE.md §3 says domain code may
 * only depend on the Database port — it must not depend on a UI-layer
 * module (ui-utils.js is listed under §5, Frontend Architecture). The two
 * implementations are one line each and trivially kept in sync, but this is
 * a real small duplication worth resolving properly — flagged at wrap-up
 * for the Requirements & Architecture chat (e.g. moving month-key derivation
 * into domain/transaction.js as the canonical home, with ui-utils.js
 * re-exporting it, since "which month is this transaction in" is really a
 * domain concept, not a UI one).
 */
function toMonthKey(isoDate) {
  return isoDate.slice(0, 7);
}

/**
 * @typedef {Object} DashboardTotals
 * @property {number} totalIncomeMinorUnits - sum of all positive amounts
 * @property {number} totalExpenseMinorUnits - sum of all negative amounts,
 *   expressed as a positive magnitude (i.e. "how much was spent", not a
 *   signed number) — this is how §3.9's "total expenses" is meant to read
 *   on screen.
 * @property {number} netMinorUnits - income minus expenses (can be negative)
 */

/**
 * @param {Array} transactions - already filtered
 * @returns {DashboardTotals}
 */
export function computeTotals(transactions) {
  const incomeAmounts = transactions.filter(isIncome).map((t) => t.amountMinorUnits);
  const expenseAmounts = transactions.filter(isExpense).map((t) => t.amountMinorUnits);

  const totalIncomeMinorUnits = sum(incomeAmounts);
  // expenseAmounts are negative; negate the sum to report a positive
  // "amount spent" magnitude rather than a signed number. `|| 0` normalizes
  // the -0 that -sum([]) would otherwise produce when there are no
  // expenses, so this never surprises a caller doing strict equality.
  const totalExpenseMinorUnits = -sum(expenseAmounts) || 0;
  const netMinorUnits = totalIncomeMinorUnits - totalExpenseMinorUnits;

  return { totalIncomeMinorUnits, totalExpenseMinorUnits, netMinorUnits };
}

/**
 * @typedef {Object} CategorySpending
 * @property {string|null} categoryId - null for the uncategorized bucket
 * @property {string} categoryName
 * @property {number} totalMinorUnits - positive magnitude spent in this category
 */

/**
 * Spending by category (PROJECT_SPEC.md §3.9 "spending by category" /
 * "spending distribution"). Only expenses are counted — income isn't
 * "spending". Categories with no expense transactions in the filtered set
 * are omitted rather than shown as zero, since an empty pie/bar slice adds
 * no information. Sorted by amount spent, descending.
 *
 * @param {Array} transactions - already filtered
 * @param {Array} categories - full category list, for id → name lookup
 * @returns {CategorySpending[]}
 */
export function computeSpendingByCategory(transactions, categories) {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  /** @type {Map<string, number>} categoryId (or 'uncategorized') -> total */
  const totals = new Map();

  for (const t of transactions.filter(isExpense)) {
    const key = t.categoryId ?? 'uncategorized';
    totals.set(key, (totals.get(key) ?? 0) - t.amountMinorUnits);
  }

  const result = [...totals.entries()].map(([key, totalMinorUnits]) => ({
    categoryId: key === 'uncategorized' ? null : key,
    categoryName: key === 'uncategorized' ? UNCATEGORIZED_LABEL : (nameById.get(key) ?? 'Unknown category'),
    totalMinorUnits,
  }));

  result.sort((a, b) => b.totalMinorUnits - a.totalMinorUnits);
  return result;
}

/**
 * @typedef {Object} MerchantSpending
 * @property {string} merchant - falls back to the transaction description
 *   when no merchant was extracted, so every expense is still attributable
 *   to something readable
 * @property {number} totalMinorUnits - positive magnitude
 */

/**
 * Top merchants/counterparties by spending (PROJECT_SPEC.md §3.9). Only
 * expenses are counted, same reasoning as computeSpendingByCategory().
 *
 * @param {Array} transactions - already filtered
 * @param {{limit?: number}} [options]
 * @returns {MerchantSpending[]} sorted descending by amount, at most `limit`
 */
export function computeTopMerchants(transactions, { limit = 10 } = {}) {
  /** @type {Map<string, number>} */
  const totals = new Map();

  for (const t of transactions.filter(isExpense)) {
    const key = t.merchant || t.description;
    totals.set(key, (totals.get(key) ?? 0) - t.amountMinorUnits);
  }

  const result = [...totals.entries()].map(([merchant, totalMinorUnits]) => ({
    merchant,
    totalMinorUnits,
  }));

  result.sort((a, b) => b.totalMinorUnits - a.totalMinorUnits);
  return result.slice(0, limit);
}

/**
 * @typedef {Object} MonthlyEvolution
 * @property {string} monthKey - YYYY-MM
 * @property {number} incomeMinorUnits
 * @property {number} expenseMinorUnits - positive magnitude
 * @property {number} netMinorUnits
 */

/**
 * Monthly income, expenses, and net cash flow (PROJECT_SPEC.md §3.9),
 * across whichever months are present in the (already filtered) input.
 * Sorted ascending by month, so a line/bar chart reads left-to-right in
 * chronological order.
 *
 * @param {Array} transactions - already filtered
 * @returns {MonthlyEvolution[]}
 */
export function computeMonthlyEvolution(transactions) {
  /** @type {Map<string, {income: number, expense: number}>} */
  const byMonth = new Map();

  for (const t of transactions) {
    const key = toMonthKey(t.date);
    const entry = byMonth.get(key) ?? { income: 0, expense: 0 };
    if (isIncome(t)) {
      entry.income += t.amountMinorUnits;
    } else if (isExpense(t)) {
      entry.expense += -t.amountMinorUnits;
    }
    byMonth.set(key, entry);
  }

  const result = [...byMonth.entries()].map(([monthKey, { income, expense }]) => ({
    monthKey,
    incomeMinorUnits: income,
    expenseMinorUnits: expense,
    netMinorUnits: income - expense,
  }));

  result.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  return result;
}

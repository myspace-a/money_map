import { describe, it, expect } from 'vitest';
import { createTransaction } from '../../src/domain/transaction.js';
import {
  computeTotals,
  computeSpendingByCategory,
  computeTopMerchants,
  computeMonthlyEvolution,
} from '../../src/domain/dashboardAggregation.js';

/**
 * Dashboard aggregation is scoped to Vitest (rather than left purely to
 * Playwright) because it's money math over integer minor units —
 * ARCHITECTURE.md §7.2's "money math" Vitest area — not UI wiring. Chart
 * rendering itself is covered by Playwright (tests/e2e/dashboard.spec.js).
 */

let counter = 0;
function tx(overrides) {
  counter += 1;
  return createTransaction({
    date: '2026-03-01',
    amountMinorUnits: -100,
    description: `Test transaction ${counter}`,
    fingerprint: `fp-${counter}`,
    ...overrides,
  });
}

describe('computeTotals', () => {
  it('sums income and expenses separately, expense as a positive magnitude', () => {
    const transactions = [
      tx({ amountMinorUnits: 200000 }), // income: 2000,00
      tx({ amountMinorUnits: -3500 }), // expense: 35,00
      tx({ amountMinorUnits: -531683 }), // expense: 5316,83
    ];

    const totals = computeTotals(transactions);
    expect(totals.totalIncomeMinorUnits).toBe(200000);
    expect(totals.totalExpenseMinorUnits).toBe(535183);
    expect(totals.netMinorUnits).toBe(200000 - 535183);
  });

  it('returns zeros for an empty transaction list', () => {
    expect(computeTotals([])).toEqual({
      totalIncomeMinorUnits: 0,
      totalExpenseMinorUnits: 0,
      netMinorUnits: 0,
    });
  });
});

describe('computeSpendingByCategory', () => {
  const categories = [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-transport', name: 'Transport' },
  ];

  it('sums expenses per category as a positive magnitude, sorted descending', () => {
    const transactions = [
      tx({ amountMinorUnits: -1000, categoryId: 'cat-groceries' }),
      tx({ amountMinorUnits: -2500, categoryId: 'cat-groceries' }),
      tx({ amountMinorUnits: -500, categoryId: 'cat-transport' }),
      tx({ amountMinorUnits: 100000 }), // income, must be excluded entirely
    ];

    const result = computeSpendingByCategory(transactions, categories);
    expect(result).toEqual([
      { categoryId: 'cat-groceries', categoryName: 'Groceries', totalMinorUnits: 3500 },
      { categoryId: 'cat-transport', categoryName: 'Transport', totalMinorUnits: 500 },
    ]);
  });

  it('groups uncategorized expenses under a null-id bucket', () => {
    const transactions = [tx({ amountMinorUnits: -750, categoryId: null })];
    const result = computeSpendingByCategory(transactions, categories);
    expect(result).toEqual([
      { categoryId: null, categoryName: 'Uncategorized', totalMinorUnits: 750 },
    ]);
  });

  it('omits categories with no expenses in the given set', () => {
    const result = computeSpendingByCategory([], categories);
    expect(result).toEqual([]);
  });
});

describe('computeTopMerchants', () => {
  it('sums expenses by merchant, falling back to description, sorted and limited', () => {
    const transactions = [
      tx({ amountMinorUnits: -1000, merchant: 'Amazon' }),
      tx({ amountMinorUnits: -500, merchant: 'Amazon' }),
      tx({ amountMinorUnits: -2000, merchant: null, description: 'Bonifico In Uscita' }),
      tx({ amountMinorUnits: 50000, merchant: 'Employer' }), // income, excluded
    ];

    const result = computeTopMerchants(transactions, { limit: 1 });
    expect(result).toEqual([{ merchant: 'Bonifico In Uscita', totalMinorUnits: 2000 }]);

    const full = computeTopMerchants(transactions);
    expect(full).toEqual([
      { merchant: 'Bonifico In Uscita', totalMinorUnits: 2000 },
      { merchant: 'Amazon', totalMinorUnits: 1500 },
    ]);
  });
});

describe('computeMonthlyEvolution', () => {
  it('buckets income/expense/net by month, sorted ascending', () => {
    const transactions = [
      tx({ date: '2026-02-10', amountMinorUnits: -1000 }),
      tx({ date: '2026-01-15', amountMinorUnits: 300000 }),
      tx({ date: '2026-01-20', amountMinorUnits: -5000 }),
    ];

    const result = computeMonthlyEvolution(transactions);
    expect(result).toEqual([
      { monthKey: '2026-01', incomeMinorUnits: 300000, expenseMinorUnits: 5000, netMinorUnits: 295000 },
      { monthKey: '2026-02', incomeMinorUnits: 0, expenseMinorUnits: 1000, netMinorUnits: -1000 },
    ]);
  });

  it('returns an empty array for no transactions', () => {
    expect(computeMonthlyEvolution([])).toEqual([]);
  });
});

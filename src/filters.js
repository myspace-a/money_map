/**
 * filters.js — shared transaction filter logic (Phase 6).
 *
 * Extracted from transactions.js (Phase 4), where this logic originally lived
 * as private functions inside initTransactionsUI(). PROJECT_SPEC.md §3.8
 * requires that "filters should behave consistently in transaction and
 * dashboard views" — the Dashboard screen (Phase 6) needs the exact same
 * month/date-range/category/type/search filtering the Transactions screen
 * already has. Extracting it here means both screens call the same code,
 * so consistency is enforced by sharing an implementation, not by keeping
 * two copies in sync by convention.
 *
 * This module has no DOM dependency beyond reading `.value` off form
 * controls passed in explicitly by the caller — it doesn't know or care
 * which screen's controls they are, so each screen can use its own
 * differently-id'd filter inputs (transactions.js and dashboard.js each
 * have their own `#filter-*` element ids in index.html).
 */

import { isExpense, isIncome } from './domain/transaction.js';
import { el, toMonthKey } from './ui-utils.js';

/**
 * @typedef {Object} TransactionFilters
 * @property {string} month - 'all' or a YYYY-MM key
 * @property {string|null} dateFrom - YYYY-MM-DD, or null
 * @property {string|null} dateTo - YYYY-MM-DD, or null
 * @property {string} categoryId - 'all', 'uncategorized', or a category id
 * @property {string} type - 'all', 'income', or 'expense'
 * @property {string} search - trimmed, lowercased search text
 */

/**
 * Reads a {@link TransactionFilters} object from a set of filter form
 * controls. Each screen passes its own control elements — this function
 * doesn't assume any particular element ids.
 *
 * @param {{
 *   monthSelect: HTMLSelectElement,
 *   dateFromInput: HTMLInputElement,
 *   dateToInput: HTMLInputElement,
 *   categorySelect: HTMLSelectElement,
 *   typeSelect: HTMLSelectElement,
 *   searchInput: HTMLInputElement,
 * }} controls
 * @returns {TransactionFilters}
 */
export function readTransactionFilters({
  monthSelect,
  dateFromInput,
  dateToInput,
  categorySelect,
  typeSelect,
  searchInput,
}) {
  return {
    month: monthSelect.value,
    dateFrom: dateFromInput.value || null,
    dateTo: dateToInput.value || null,
    categoryId: categorySelect.value,
    type: typeSelect.value,
    search: searchInput.value.trim().toLowerCase(),
  };
}

/**
 * Filters an array of transactions against a {@link TransactionFilters}
 * object. This is the single implementation of "what does it mean for a
 * transaction to match the current filters" used across the app.
 *
 * @param {Array} transactions
 * @param {TransactionFilters} filters
 * @returns {Array} the matching subset, in the same order as the input
 */
export function applyTransactionFilters(transactions, filters) {
  return transactions.filter((t) => {
    if (filters.month && filters.month !== 'all' && toMonthKey(t.date) !== filters.month) {
      return false;
    }
    if (filters.dateFrom && t.date < filters.dateFrom) return false;
    if (filters.dateTo && t.date > filters.dateTo) return false;

    if (filters.categoryId === 'uncategorized') {
      if (t.categoryId) return false;
    } else if (filters.categoryId && filters.categoryId !== 'all') {
      if (t.categoryId !== filters.categoryId) return false;
    }

    if (filters.type === 'income' && !isIncome(t)) return false;
    if (filters.type === 'expense' && !isExpense(t)) return false;

    if (filters.search) {
      const haystack = [t.description, t.merchant, t.rawDescription]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }

    return true;
  });
}

/**
 * Populates a month-filter <select> with "All months" plus one option per
 * distinct month present in the given transactions, most recent first.
 * Preserves the previously-selected value when it's still valid.
 *
 * @param {HTMLSelectElement} select
 * @param {Array} transactions
 * @param {{formatMonthKey: (monthKey: string) => string}} options - the
 *   display formatter is injected (rather than imported directly) to avoid
 *   this module depending on ui-utils' formatMonthKey signature changing
 *   silently; both current callers pass ui-utils.formatMonthKey.
 */
export function populateMonthFilterOptions(select, transactions, { formatMonthKey }) {
  const previousValue = select.value || 'all';
  const months = [...new Set(transactions.map((t) => toMonthKey(t.date)))].sort().reverse();

  select.innerHTML = '';
  select.appendChild(el('option', { value: 'all', text: 'All months' }));
  for (const monthKey of months) {
    select.appendChild(el('option', { value: monthKey, text: formatMonthKey(monthKey) }));
  }
  select.value = months.includes(previousValue) || previousValue === 'all' ? previousValue : 'all';
}

/**
 * Populates a category-filter <select> with "All categories", "Uncategorized",
 * plus one option per given category. This is the *filter* dropdown shape
 * (with the all/uncategorized pseudo-values) — distinct from
 * categories.js's own populateCategoryOptions(), which populates an
 * action-target dropdown (merge/split) with no such pseudo-values.
 *
 * @param {HTMLSelectElement} select
 * @param {Array} categories
 */
export function populateCategoryFilterOptions(select, categories) {
  const previousValue = select.value || 'all';
  select.innerHTML = '';
  select.appendChild(el('option', { value: 'all', text: 'All categories' }));
  select.appendChild(el('option', { value: 'uncategorized', text: 'Uncategorized' }));
  for (const category of categories) {
    select.appendChild(el('option', { value: category.id, text: category.name }));
  }
  const validValues = new Set(['all', 'uncategorized', ...categories.map((c) => c.id)]);
  select.value = validValues.has(previousValue) ? previousValue : 'all';
}

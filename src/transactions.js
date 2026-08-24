/**
 * transactions.js — Phase 4 UI feature module (ARCHITECTURE.md §5: one
 * module per screen/feature area). Owns the transaction table screen:
 *
 *   - table listing transactions (date, description/merchant, amount,
 *     category, categorization method) — PROJECT_SPEC.md §3.7
 *   - filters: month, date range, category, income/expense, search text —
 *     PROJECT_SPEC.md §3.8
 *   - sorting by date or amount (click a column header)
 *   - an expandable per-row detail panel showing the categorization
 *     explanation (method, evidence, confidence) — PROJECT_SPEC.md §3.5
 *   - manual category correction via a dropdown in the detail panel,
 *     reusing categorization/manualCorrection.js (already built in Phase 3)
 *
 * Filtering and sorting are done in memory over the array returned by
 * TransactionRepository.findAll() rather than pushed into SQL. This is a
 * deliberate MVP choice (PROJECT_SPEC.md §2): the app is local-first,
 * single-user, and realistic data volumes here are hundreds of rows, not
 * millions — an in-memory filter is simple to read and reason about, and
 * avoids building a parameterized-query layer speculatively. If real usage
 * ever shows this is too slow, moving specific filters into SQL is a
 * contained change (this module is the only thing that would need to
 * change — nothing outside it depends on how filtering is implemented).
 *
 * Category creation (Phase 5) and dashboard aggregation (Phase 6) are out
 * of scope here — this module only lists, filters, sorts, explains, and
 * lets the user manually recategorize existing transactions.
 */

import { applyManualCategory } from './categorization/manualCorrection.js';
import { formatMinorUnits } from './domain/money.js';
import { isExpense, isIncome } from './domain/transaction.js';
import { el, formatDate, formatMonthKey, toMonthKey } from './ui-utils.js';

const METHOD_LABELS = {
  default: 'Default rule',
  rule: 'Custom rule',
  learned: 'Learned',
  manual: 'Manual',
  uncategorized: 'Uncategorized',
};

/**
 * @param {{
 *   root: HTMLElement,
 *   transactionRepo: import('./repositories/transactionRepository.js').TransactionRepository,
 *   categoryRepo: import('./repositories/categoryRepository.js').CategoryRepository,
 * }} options
 * @returns {{ refresh: () => Promise<void> }} exposes refresh() so other
 *   screens (e.g. import.js after a commit) can ask this screen to reload
 *   without this module needing to know about them
 */
export function initTransactionsUI({ root, transactionRepo, categoryRepo }) {
  const tbody = root.querySelector('#transaction-table-body');
  const emptyMessageEl = root.querySelector('#transaction-empty-message');
  const monthSelect = root.querySelector('#filter-month');
  const dateFromInput = root.querySelector('#filter-date-from');
  const dateToInput = root.querySelector('#filter-date-to');
  const categorySelect = root.querySelector('#filter-category');
  const typeSelect = root.querySelector('#filter-type');
  const searchInput = root.querySelector('#filter-search');
  const resetBtn = root.querySelector('#filter-reset-btn');
  const table = root.querySelector('#transaction-table');

  /** @type {Array} full, unfiltered set from the last load */
  let allTransactions = [];
  /** @type {Array} */
  let categories = [];
  /** @type {Map<string, string>} */
  let categoryNameById = new Map();

  /** @type {{column: 'date'|'amount', direction: 'asc'|'desc'}} */
  let sortState = { column: 'date', direction: 'desc' };

  /** @type {string|null} id of the transaction whose detail row is open */
  let expandedTransactionId = null;

  async function refresh() {
    const [transactions, cats] = await Promise.all([
      transactionRepo.findAll(),
      categoryRepo.findAll({ includeInactive: true }),
    ]);
    allTransactions = transactions;
    categories = cats;
    categoryNameById = new Map(cats.map((c) => [c.id, c.name]));

    populateMonthOptions(monthSelect, transactions);
    populateCategoryOptions(categorySelect, cats);
    render();
  }

  function readFilters() {
    return {
      month: monthSelect.value,
      dateFrom: dateFromInput.value || null,
      dateTo: dateToInput.value || null,
      categoryId: categorySelect.value,
      type: typeSelect.value,
      search: searchInput.value.trim().toLowerCase(),
    };
  }

  function applyFilters(transactions, filters) {
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

  function applySort(transactions, sort) {
    const sorted = [...transactions];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sort.column === 'date') {
        cmp = a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
      } else if (sort.column === 'amount') {
        cmp = a.amountMinorUnits - b.amountMinorUnits;
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }

  function render() {
    const filters = readFilters();
    const filtered = applyFilters(allTransactions, filters);
    const sorted = applySort(filtered, sortState);

    updateSortIndicators(table, sortState);

    tbody.innerHTML = '';
    emptyMessageEl.hidden = sorted.length > 0;

    for (const t of sorted) {
      tbody.appendChild(renderRow(t));
      if (t.id === expandedTransactionId) {
        tbody.appendChild(renderDetailRow(t));
      }
    }
  }

  function renderRow(t) {
    const categoryLabel = t.categoryId
      ? (categoryNameById.get(t.categoryId) ?? 'Unknown category')
      : 'Uncategorized';

    const row = el('tr', {
      dataset: { transactionId: t.id, categorizationMethod: t.categorizationMethod },
      on: {
        click: () => {
          expandedTransactionId = expandedTransactionId === t.id ? null : t.id;
          render();
        },
      },
    });
    row.style.cursor = 'pointer';

    row.appendChild(el('td', { text: formatDate(t.date) }));
    row.appendChild(el('td', { text: t.merchant ?? t.description }));
    row.appendChild(
      el('td', { text: formatMinorUnits(t.amountMinorUnits, { currency: t.currency }) })
    );
    row.appendChild(el('td', { text: categoryLabel }));
    row.appendChild(el('td', { text: METHOD_LABELS[t.categorizationMethod] ?? t.categorizationMethod }));

    return row;
  }

  function renderDetailRow(t) {
    const detailRow = el('tr', {
      class: 'transaction-detail-row',
      dataset: { transactionId: t.id, testid: 'transaction-detail' },
    });
    const cell = el('td', { colspan: '5' });

    cell.appendChild(el('p', { text: `Description: ${t.description}` }));
    if (t.rawDescription && t.rawDescription !== t.description) {
      cell.appendChild(el('p', { text: `Original bank text: ${t.rawDescription}` }));
    }
    if (t.transactionType) {
      cell.appendChild(el('p', { text: `Transaction type: ${t.transactionType}` }));
    }

    cell.appendChild(renderExplanation(t));
    cell.appendChild(renderCategoryEditor(t));

    cell.addEventListener('click', (event) => event.stopPropagation());
    detailRow.appendChild(cell);
    return detailRow;
  }

  /**
   * Renders the "why was this categorized this way" explanation
   * (PROJECT_SPEC.md §3.5): method, evidence, and confidence where
   * applicable. Evidence shape depends on categorizationMethod — see
   * categorization/categorizationEngine.js and learningEngine.js for the
   * shapes this reads.
   */
  function renderExplanation(t) {
    const wrapper = el('div', { dataset: { testid: 'categorization-explanation' } });
    const methodLine = el('p', {
      text: `Categorized by: ${METHOD_LABELS[t.categorizationMethod] ?? t.categorizationMethod}`,
    });
    wrapper.appendChild(methodLine);

    if (t.categorizationConfidence !== null && t.categorizationConfidence !== undefined) {
      wrapper.appendChild(
        el('p', { text: `Confidence: ${Math.round(t.categorizationConfidence * 100)}%` })
      );
    }

    const evidence = t.categorizationEvidence;
    if (evidence?.type === 'rule') {
      const ruleKind = evidence.ruleSource === 'default' ? 'built-in default rule' : 'your custom rule';
      wrapper.appendChild(
        el('p', {
          text: `Matched ${ruleKind}: ${evidence.matchType} "${evidence.matchValue}"`,
        })
      );
    } else if (evidence?.type === 'learned') {
      wrapper.appendChild(
        el('p', {
          text: `Based on ${evidence.agreeingCount} of ${evidence.sampleCount} past manual corrections for merchant "${evidence.merchant}"`,
        })
      );
    } else if (evidence?.type === 'manual') {
      wrapper.appendChild(el('p', { text: 'Set manually.' }));
    } else if (t.categorizationMethod === 'uncategorized') {
      wrapper.appendChild(el('p', { text: 'No rule or history matched this transaction.' }));
    }

    return wrapper;
  }

  function renderCategoryEditor(t) {
    const wrapper = el('div', { dataset: { testid: 'category-editor' } });
    const select = el('select', { dataset: { testid: 'category-editor-select' } });

    const placeholder = el('option', { value: '', text: '— choose a category —' });
    select.appendChild(placeholder);
    for (const category of categories) {
      const option = el('option', { value: category.id, text: category.name });
      if (category.id === t.categoryId) option.selected = true;
      select.appendChild(option);
    }

    const applyBtn = el('button', { type: 'button', text: 'Set category' });
    const statusEl = el('span', { dataset: { testid: 'category-editor-status' } });

    applyBtn.addEventListener('click', async () => {
      const categoryId = select.value;
      if (!categoryId) {
        statusEl.textContent = 'Choose a category first.';
        return;
      }
      const current = await transactionRepo.findById(t.id);
      if (!current) {
        statusEl.textContent = 'This transaction no longer exists.';
        return;
      }
      await applyManualCategory(current, categoryId, transactionRepo);
      await refresh();
    });

    wrapper.appendChild(select);
    wrapper.appendChild(applyBtn);
    wrapper.appendChild(statusEl);
    return wrapper;
  }

  table.querySelectorAll('th[data-sort]').forEach((th) => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (sortState.column === column) {
        sortState = { column, direction: sortState.direction === 'asc' ? 'desc' : 'asc' };
      } else {
        sortState = { column, direction: 'asc' };
      }
      render();
    });
  });

  for (const control of [monthSelect, dateFromInput, dateToInput, categorySelect, typeSelect]) {
    control.addEventListener('change', render);
  }
  searchInput.addEventListener('input', render);

  resetBtn.addEventListener('click', () => {
    monthSelect.value = 'all';
    dateFromInput.value = '';
    dateToInput.value = '';
    categorySelect.value = 'all';
    typeSelect.value = 'all';
    searchInput.value = '';
    render();
  });

  refresh().catch((err) => {
    console.error('Failed to load transactions', err);
  });

  return { refresh };
}

function populateMonthOptions(select, transactions) {
  const previousValue = select.value || 'all';
  const months = [...new Set(transactions.map((t) => toMonthKey(t.date)))].sort().reverse();

  select.innerHTML = '';
  select.appendChild(el('option', { value: 'all', text: 'All months' }));
  for (const monthKey of months) {
    select.appendChild(el('option', { value: monthKey, text: formatMonthKey(monthKey) }));
  }
  select.value = months.includes(previousValue) || previousValue === 'all' ? previousValue : 'all';
}

function populateCategoryOptions(select, categories) {
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

function updateSortIndicators(table, sortState) {
  table.querySelectorAll('th[data-sort]').forEach((th) => {
    const isActive = th.dataset.sort === sortState.column;
    th.dataset.sortDirection = isActive ? sortState.direction : '';
    const arrow = isActive ? (sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
    th.dataset.baseLabel = th.dataset.baseLabel ?? th.textContent;
    th.textContent = th.dataset.baseLabel + arrow;
  });
}

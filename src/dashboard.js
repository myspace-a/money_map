/**
 * dashboard.js — Phase 6 UI feature module (ARCHITECTURE.md §5: one module
 * per screen/feature area). Owns the Dashboard screen (PROJECT_SPEC.md
 * §3.9):
 *
 *   - total income, total expenses, net balance (text summary)
 *   - spending by category / spending distribution (pie chart)
 *   - top merchants/counterparties by spending (bar chart)
 *   - income vs. expenses (bar chart)
 *   - monthly income, expenses and net cash flow (line chart)
 *
 * Filters (month, date range, category, income/expense, search) reuse
 * filters.js — the same module transactions.js uses — so this screen
 * filters transactions identically to the Transactions screen, per
 * PROJECT_SPEC.md §3.8. The dashboard has its own filter <select>/<input>
 * elements in index.html (different ids from the Transactions screen's),
 * but the matching logic itself is shared code, not a re-implementation.
 *
 * Charting: Chart.js, loaded from a CDN in index.html (ARCHITECTURE.md §2 —
 * "Chart.js when the dashboard phase adds it" — loaded at runtime like
 * wa-sqlite, not bundled, consistent with the no-build-step approach).
 * This module expects the global `Chart` constructor to already exist on
 * `window` by the time initDashboardUI() runs.
 *
 * All aggregation (money math: totals, per-category sums, per-merchant
 * sums, per-month sums) is delegated to domain/dashboardAggregation.js —
 * this module's job is just: read filters, filter transactions, hand the
 * result to those pure functions, and draw/update charts with what comes
 * back. No money arithmetic happens directly in this file.
 */

import { formatMinorUnits } from './domain/money.js';
import {
  computeTotals,
  computeSpendingByCategory,
  computeTopMerchants,
  computeMonthlyEvolution,
} from './domain/dashboardAggregation.js';
import {
  applyTransactionFilters,
  populateCategoryFilterOptions,
  populateMonthFilterOptions,
  readTransactionFilters,
} from './filters.js';
import { formatMonthKey } from './ui-utils.js';

// A small fixed palette, reused across charts with multiple slices/bars.
// Kept deliberately simple (no per-category color persistence) — MVP scope
// per PROJECT_SPEC.md §2.
const CHART_COLORS = [
  '#4C72B0',
  '#DD8452',
  '#55A868',
  '#C44E52',
  '#8172B2',
  '#937860',
  '#DA8BC3',
  '#8C8C8C',
  '#CCB974',
  '#64B5CD',
];

/**
 * @param {{
 *   root: HTMLElement,
 *   transactionRepo: import('./repositories/transactionRepository.js').TransactionRepository,
 *   categoryRepo: import('./repositories/categoryRepository.js').CategoryRepository,
 * }} options
 * @returns {{ refresh: () => Promise<void> }} exposes refresh() so other
 *   screens (import, category merge/split) can ask the dashboard to reload
 *   without this module needing to know about them — mirrors
 *   transactions.js/categories.js.
 */
export function initDashboardUI({ root, transactionRepo, categoryRepo }) {
  const monthSelect = root.querySelector('#dashboard-filter-month');
  const dateFromInput = root.querySelector('#dashboard-filter-date-from');
  const dateToInput = root.querySelector('#dashboard-filter-date-to');
  const categorySelect = root.querySelector('#dashboard-filter-category');
  const typeSelect = root.querySelector('#dashboard-filter-type');
  const searchInput = root.querySelector('#dashboard-filter-search');
  const resetBtn = root.querySelector('#dashboard-filter-reset-btn');

  const totalIncomeEl = root.querySelector('#dashboard-total-income');
  const totalExpenseEl = root.querySelector('#dashboard-total-expense');
  const netBalanceEl = root.querySelector('#dashboard-net-balance');
  const emptyMessageEl = root.querySelector('#dashboard-empty-message');

  const categoryCanvas = root.querySelector('#dashboard-chart-category');
  const merchantsCanvas = root.querySelector('#dashboard-chart-merchants');
  const incomeExpenseCanvas = root.querySelector('#dashboard-chart-income-expense');
  const monthlyCanvas = root.querySelector('#dashboard-chart-monthly');

  /** @type {Array} full, unfiltered set from the last load */
  let allTransactions = [];
  /** @type {Array} */
  let allCategories = [];

  /** @type {{category: any, merchants: any, incomeExpense: any, monthly: any}}
   * Chart.js instances, created once and updated in place thereafter —
   * Chart.js requires destroying an existing chart on a canvas before
   * drawing a new one, so these are tracked rather than re-created blindly
   * on every render(). */
  const charts = { category: null, merchants: null, incomeExpense: null, monthly: null };

  async function refresh() {
    const [transactions, categories] = await Promise.all([
      transactionRepo.findAll(),
      categoryRepo.findAll({ includeInactive: true }),
    ]);
    allTransactions = transactions;
    allCategories = categories;

    populateMonthFilterOptions(monthSelect, transactions, { formatMonthKey });
    populateCategoryFilterOptions(categorySelect, categories);
    render();
  }

  function render() {
    const filters = readTransactionFilters({
      monthSelect,
      dateFromInput,
      dateToInput,
      categorySelect,
      typeSelect,
      searchInput,
    });
    const filtered = applyTransactionFilters(allTransactions, filters);

    emptyMessageEl.hidden = filtered.length > 0;

    renderTotals(filtered);
    renderCategoryChart(filtered);
    renderMerchantsChart(filtered);
    renderIncomeExpenseChart(filtered);
    renderMonthlyChart(filtered);
  }

  function renderTotals(transactions) {
    const totals = computeTotals(transactions);
    totalIncomeEl.textContent = formatMinorUnits(totals.totalIncomeMinorUnits);
    totalExpenseEl.textContent = formatMinorUnits(totals.totalExpenseMinorUnits);
    netBalanceEl.textContent = formatMinorUnits(totals.netMinorUnits);
  }

  function renderCategoryChart(transactions) {
    const data = computeSpendingByCategory(transactions, allCategories);
    charts.category = upsertChart(charts.category, categoryCanvas, {
      type: 'pie',
      data: {
        labels: data.map((d) => d.categoryName),
        datasets: [
          {
            data: data.map((d) => d.totalMinorUnits / 100),
            backgroundColor: data.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          },
        ],
      },
      options: {
        plugins: { title: { display: true, text: 'Spending by category' } },
      },
    });
  }

  function renderMerchantsChart(transactions) {
    const data = computeTopMerchants(transactions, { limit: 10 });
    charts.merchants = upsertChart(charts.merchants, merchantsCanvas, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.merchant),
        datasets: [
          {
            label: 'Spent',
            data: data.map((d) => d.totalMinorUnits / 100),
            backgroundColor: CHART_COLORS[0],
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: { title: { display: true, text: 'Top merchants by spending' }, legend: { display: false } },
      },
    });
  }

  function renderIncomeExpenseChart(transactions) {
    const totals = computeTotals(transactions);
    charts.incomeExpense = upsertChart(charts.incomeExpense, incomeExpenseCanvas, {
      type: 'bar',
      data: {
        labels: ['Income', 'Expenses'],
        datasets: [
          {
            label: 'Amount',
            data: [totals.totalIncomeMinorUnits / 100, totals.totalExpenseMinorUnits / 100],
            backgroundColor: [CHART_COLORS[2], CHART_COLORS[3]],
          },
        ],
      },
      options: {
        plugins: { title: { display: true, text: 'Income vs. expenses' }, legend: { display: false } },
      },
    });
  }

  function renderMonthlyChart(transactions) {
    const data = computeMonthlyEvolution(transactions);
    charts.monthly = upsertChart(charts.monthly, monthlyCanvas, {
      type: 'line',
      data: {
        labels: data.map((d) => formatMonthKey(d.monthKey)),
        datasets: [
          {
            label: 'Income',
            data: data.map((d) => d.incomeMinorUnits / 100),
            borderColor: CHART_COLORS[2],
            backgroundColor: CHART_COLORS[2],
          },
          {
            label: 'Expenses',
            data: data.map((d) => d.expenseMinorUnits / 100),
            borderColor: CHART_COLORS[3],
            backgroundColor: CHART_COLORS[3],
          },
          {
            label: 'Net',
            data: data.map((d) => d.netMinorUnits / 100),
            borderColor: CHART_COLORS[4],
            backgroundColor: CHART_COLORS[4],
          },
        ],
      },
      options: {
        plugins: { title: { display: true, text: 'Monthly income, expenses & net cash flow' } },
      },
    });
  }

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
    console.error('Failed to load dashboard', err);
  });

  return { refresh };
}

/**
 * Creates a Chart.js chart on first call, or updates an existing one's data
 * in place on subsequent calls (rather than destroying and recreating every
 * time filters change) — avoids a visible flash/rebuild on every filter
 * change and is the pattern Chart.js itself recommends for "same chart,
 * new data".
 *
 * @param {import('chart.js').Chart|null} existingChart
 * @param {HTMLCanvasElement} canvas
 * @param {{type: string, data: object, options?: object}} config
 * @returns {import('chart.js').Chart}
 */
function upsertChart(existingChart, canvas, config) {
  if (existingChart) {
    existingChart.data = config.data;
    existingChart.options = { ...existingChart.options, ...config.options };
    existingChart.update();
    return existingChart;
  }
  return new window.Chart(canvas, {
    ...config,
    options: { responsive: true, ...config.options },
  });
}

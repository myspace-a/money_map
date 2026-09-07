// @ts-check
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ing-sample.csv');

/**
 * STATUS: written but not executed in this container — no browser available
 * (DEVELOPMENT.md §3.2). Run locally via `npx playwright test` before
 * merging.
 *
 * Exercises Phase 6 (Dashboard, PROJECT_SPEC.md §3.9) against the real app:
 * totals, spending-by-category, top merchants, income-vs-expense, and
 * monthly evolution, and that dashboard filters (§3.8) actually change what
 * the charts show — using the shared fixture also used by Phases 2-5
 * (tests/e2e/fixtures/ing-sample.csv — fabricated data, not a real export):
 *
 *   - BAR CENTRALE           -12.50 (expense) / Pagamento Carta -> "Card Payment"
 *   - SUPERMERCATO GIALLO    -45.90 (expense) / Pagamento Carta -> "Card Payment"
 *   - Accredito stipendio  +1500.00 (income)  / Accredito Stipendio/Pensione -> "Salary / Pension"
 *   - Prelievo Carta ATM     -20.00 (expense) / Prelievo Carta -> "Cash Withdrawal"
 *
 * Totals: income 1500,00 / expenses 78,40 (12.50+45.90+20.00) / net 1421,60.
 *
 * Chart contents are read back via Chart.js's own `Chart.getChart(canvas)`
 * static lookup (available since the CDN script sets window.Chart) rather
 * than needing extra test-only hooks in dashboard.js.
 */
async function importFixture(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });
  await page.setInputFiles('#import-file-input', FIXTURE_PATH);
  await page.click('#import-preview-btn');
  await page.click('#import-confirm-btn');
  await expect(page.locator('#import-summary')).toHaveText(
    'Imported 4 transaction(s); skipped 0.'
  );
}

function getChartData(page, canvasId) {
  return page.evaluate((id) => {
    const chart = window.Chart.getChart(id);
    return chart ? chart.data : null;
  }, canvasId);
}

test.describe('Dashboard', () => {
  test('shows totals for imported transactions', async ({ page }) => {
    await importFixture(page);

    await expect(page.locator('#dashboard-total-income')).toContainText('1.500,00');
    await expect(page.locator('#dashboard-total-expense')).toContainText('78,40');
    await expect(page.locator('#dashboard-net-balance')).toContainText('1.421,60');
  });

  test('spending-by-category chart groups by category, income excluded', async ({ page }) => {
    await importFixture(page);

    const data = await getChartData(page, 'dashboard-chart-category');
    expect(data.labels).toContain('Card Payment');
    expect(data.labels).toContain('Cash Withdrawal');
    expect(data.labels).not.toContain('Salary / Pension'); // income, not spending

    const cardIndex = data.labels.indexOf('Card Payment');
    const cashIndex = data.labels.indexOf('Cash Withdrawal');
    expect(data.datasets[0].data[cardIndex]).toBeCloseTo(58.4, 2); // 12.50 + 45.90
    expect(data.datasets[0].data[cashIndex]).toBeCloseTo(20.0, 2);
  });

  test('top merchants chart lists merchants by spending', async ({ page }) => {
    await importFixture(page);

    const data = await getChartData(page, 'dashboard-chart-merchants');
    // Merchant extraction (Phase 2) pulls the text after "presso"; the
    // withdrawal transaction has no "presso" so falls back to its
    // description, per computeTopMerchants()'s documented fallback.
    expect(data.labels.some((label) => label.includes('BAR CENTRALE'))).toBe(true);
    expect(data.labels.some((label) => label.includes('SUPERMERCATO GIALLO'))).toBe(true);
  });

  test('income-vs-expense chart reflects the totals', async ({ page }) => {
    await importFixture(page);

    const data = await getChartData(page, 'dashboard-chart-income-expense');
    expect(data.labels).toEqual(['Income', 'Expenses']);
    expect(data.datasets[0].data[0]).toBeCloseTo(1500.0, 2);
    expect(data.datasets[0].data[1]).toBeCloseTo(78.4, 2);
  });

  test('monthly evolution chart has one bucket for March 2026', async ({ page }) => {
    await importFixture(page);

    const data = await getChartData(page, 'dashboard-chart-monthly');
    expect(data.labels).toHaveLength(1);
    const [incomeDataset, expenseDataset, netDataset] = data.datasets;
    expect(incomeDataset.data[0]).toBeCloseTo(1500.0, 2);
    expect(expenseDataset.data[0]).toBeCloseTo(78.4, 2);
    expect(netDataset.data[0]).toBeCloseTo(1421.6, 2);
  });

  test('category filter narrows totals and charts, consistent with the Transactions screen', async ({
    page,
  }) => {
    await importFixture(page);

    await page.selectOption('#dashboard-filter-category', { label: 'Card Payment' });

    await expect(page.locator('#dashboard-total-income')).toContainText('0,00');
    await expect(page.locator('#dashboard-total-expense')).toContainText('58,40');

    const merchantData = await getChartData(page, 'dashboard-chart-merchants');
    expect(merchantData.labels.some((label) => label.includes('BAR CENTRALE'))).toBe(true);
    expect(merchantData.labels.some((label) => label.includes('SUPERMERCATO GIALLO'))).toBe(true);
    expect(merchantData.labels.some((label) => label.includes('ATM'))).toBe(false);
  });

  test('type filter set to income shows only income in totals', async ({ page }) => {
    await importFixture(page);

    await page.selectOption('#dashboard-filter-type', 'income');

    await expect(page.locator('#dashboard-total-income')).toContainText('1.500,00');
    await expect(page.locator('#dashboard-total-expense')).toContainText('0,00');

    const categoryData = await getChartData(page, 'dashboard-chart-category');
    expect(categoryData.labels).toEqual([]); // no expenses left to show
  });

  test('reset filters restores full totals', async ({ page }) => {
    await importFixture(page);

    await page.selectOption('#dashboard-filter-type', 'income');
    await expect(page.locator('#dashboard-total-expense')).toContainText('0,00');

    await page.click('#dashboard-filter-reset-btn');

    await expect(page.locator('#dashboard-total-income')).toContainText('1.500,00');
    await expect(page.locator('#dashboard-total-expense')).toContainText('78,40');
  });

  test('dashboard reflects a manual recategorization made in the Transactions screen', async ({
    page,
  }) => {
    await importFixture(page);

    // Move the "Prelievo Carta ATM" transaction to "Card Payment" via the
    // Transactions screen's own category editor, then confirm the
    // Dashboard (a different screen) picks up the change without a
    // manual page reload — PROJECT_SPEC.md §3.8 consistency requirement
    // implies the two screens must stay in sync, not just filter alike.
    const row = page.locator('#transaction-table-body tr:not(.transaction-detail-row)', {
      hasText: 'Prelievo Carta ATM',
    });
    await row.click();
    const editor = page.locator('[data-testid="category-editor"]');
    await editor.locator('select').selectOption({ label: 'Card Payment' });
    await editor.locator('button', { hasText: 'Set category' }).click();

    await page.selectOption('#dashboard-filter-category', { label: 'Card Payment' });
    await expect(page.locator('#dashboard-total-expense')).toContainText('78,40'); // 58.40 + 20.00
  });
});

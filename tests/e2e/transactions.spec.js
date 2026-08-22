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
 * Exercises Phase 4 end to end against the real app: the transaction table,
 * filters (search, category, income/expense, month), sorting, the
 * expandable detail/explanation panel (PROJECT_SPEC.md §3.5), and manual
 * category correction via the table's own category editor.
 *
 * Reuses the same fixture as Phase 2/3
 * (tests/e2e/fixtures/ing-sample.csv — fabricated data, not a real export):
 *   - BAR CENTRALE           -12.50 (expense)  / Pagamento Carta -> default categorized
 *   - SUPERMERCATO GIALLO    -45.90 (expense)  / Pagamento Carta -> default categorized
 *   - Accredito stipendio  +1500.00 (income)   / Accredito Stipendio/Pensione -> Salary/Pension
 *   - Prelievo Carta ATM     -20.00 (expense)  / Prelievo Carta -> Cash Withdrawal
 * All four fall in March 2026.
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

function mainRows(page) {
  return page.locator('#transaction-table-body tr:not(.transaction-detail-row)');
}

test.describe('Transaction table', () => {
  test('lists all imported transactions', async ({ page }) => {
    await importFixture(page);
    await expect(mainRows(page)).toHaveCount(4);
  });

  test('search filters by merchant/description text', async ({ page }) => {
    await importFixture(page);

    await page.fill('#filter-search', 'BAR CENTRALE');
    await expect(mainRows(page)).toHaveCount(1);
    await expect(mainRows(page).first()).toContainText('BAR CENTRALE');

    await page.fill('#filter-search', '');
    await expect(mainRows(page)).toHaveCount(4);
  });

  test('income/expense filter narrows the list', async ({ page }) => {
    await importFixture(page);

    await page.selectOption('#filter-type', 'income');
    await expect(mainRows(page)).toHaveCount(1);
    await expect(mainRows(page).first()).toContainText('Accredito stipendio');

    await page.selectOption('#filter-type', 'expense');
    await expect(mainRows(page)).toHaveCount(3);

    await page.selectOption('#filter-type', 'all');
    await expect(mainRows(page)).toHaveCount(4);
  });

  test('category filter narrows the list to a single category', async ({ page }) => {
    await importFixture(page);

    await page.selectOption('#filter-category', { label: 'Cash Withdrawal' });
    await expect(mainRows(page)).toHaveCount(1);
    await expect(mainRows(page).first()).toContainText('Prelievo Carta ATM');

    await page.selectOption('#filter-category', 'all');
    await expect(mainRows(page)).toHaveCount(4);
  });

  test('month filter shows only transactions in the selected month', async ({ page }) => {
    await importFixture(page);

    // All four fixture transactions fall in March 2026 — selecting that
    // month should keep all of them; the "All months" option is the
    // reset case, already covered by the category/search tests above.
    await page.selectOption('#filter-month', { index: 1 }); // first real month option after "All months"
    await expect(mainRows(page)).toHaveCount(4);
  });

  test('date range filter excludes transactions outside the range', async ({ page }) => {
    await importFixture(page);

    await page.fill('#filter-date-from', '2026-03-10');
    await page.fill('#filter-date-to', '2026-03-20');
    // Only "Accredito stipendio" (03-10) and "Prelievo Carta ATM" (03-15)
    // fall within this range; the two card payments (03-02, 03-05) do not.
    await expect(mainRows(page)).toHaveCount(2);
  });

  test('reset filters button clears all filters back to the full list', async ({ page }) => {
    await importFixture(page);

    await page.fill('#filter-search', 'BAR CENTRALE');
    await page.selectOption('#filter-type', 'expense');
    await expect(mainRows(page)).toHaveCount(1);

    await page.click('#filter-reset-btn');
    await expect(mainRows(page)).toHaveCount(4);
    await expect(page.locator('#filter-search')).toHaveValue('');
  });

  test('sorting by amount toggles ascending/descending order', async ({ page }) => {
    await importFixture(page);

    await page.click('#transaction-table th[data-sort="amount"]');
    const firstAscending = await mainRows(page).first().getAttribute('data-transaction-id');

    await page.click('#transaction-table th[data-sort="amount"]');
    const firstDescending = await mainRows(page).first().getAttribute('data-transaction-id');

    expect(firstAscending).not.toBe(firstDescending);
  });

  test('clicking a row expands a detail panel with the categorization explanation', async ({
    page,
  }) => {
    await importFixture(page);

    const cashRow = mainRows(page).filter({ hasText: 'Prelievo Carta ATM' });
    await cashRow.click();

    const detail = page.locator('[data-testid="transaction-detail"]');
    await expect(detail).toBeVisible();

    const explanation = detail.locator('[data-testid="categorization-explanation"]');
    await expect(explanation).toContainText('Default rule');
    await expect(explanation).toContainText('Matched');

    // Clicking again collapses it.
    await cashRow.click();
    await expect(detail).toHaveCount(0);
  });

  test('the category editor in the detail panel applies a manual correction', async ({ page }) => {
    await importFixture(page);

    const cardRow = mainRows(page).filter({ hasText: 'SUPERMERCATO GIALLO' });
    await cardRow.click();

    const editor = page.locator('[data-testid="category-editor"]');
    await editor.locator('[data-testid="category-editor-select"]').selectOption({
      label: 'Cash Withdrawal',
    });
    await editor.locator('button', { hasText: 'Set category' }).click();

    const updatedRow = mainRows(page).filter({ hasText: 'SUPERMERCATO GIALLO' });
    await expect(updatedRow).toHaveAttribute('data-categorization-method', 'manual');
    await expect(updatedRow).toContainText('Cash Withdrawal');
  });
});

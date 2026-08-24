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
 * Exercises Phase 5 end to end against the real app: creating, renaming,
 * deactivating/reactivating a category, merging one category into another
 * (transactions and rules reassigned, source deactivated), and splitting a
 * category by moving text-matching transactions into another one.
 * PROJECT_SPEC.md §3.6.
 *
 * Reuses the same fixture as Phase 2/3/4
 * (tests/e2e/fixtures/ing-sample.csv — fabricated data, not a real export):
 *   - BAR CENTRALE           -12.50 (expense) / Pagamento Carta -> default "Card Payment"
 *   - SUPERMERCATO GIALLO    -45.90 (expense) / Pagamento Carta -> default "Card Payment"
 *   - Accredito stipendio  +1500.00 (income)  / Accredito Stipendio/Pensione -> "Salary / Pension"
 *   - Prelievo Carta ATM     -20.00 (expense) / Prelievo Carta -> "Cash Withdrawal"
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

test.describe('Category management', () => {
  test('create a category', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await page.fill('#category-create-name', 'Travel');
    await page.click('#category-create-form button[type="submit"]');

    const row = page.locator('.category-row', { hasText: 'Travel' });
    await expect(row).toHaveAttribute('data-active', 'true');
  });

  test('rename a category', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await page.fill('#category-create-name', 'Hobbies');
    await page.click('#category-create-form button[type="submit"]');
    const row = page.locator('.category-row', { hasText: 'Hobbies' });
    await expect(row).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept('Hobbies & Crafts'));
    await row.locator('button', { hasText: 'Rename' }).click();

    await expect(page.locator('.category-row', { hasText: 'Hobbies & Crafts' })).toBeVisible();
  });

  test('deactivate then reactivate a category', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await page.fill('#category-create-name', 'Temporary');
    await page.click('#category-create-form button[type="submit"]');
    const row = page.locator('.category-row', { hasText: 'Temporary' });
    await expect(row).toHaveAttribute('data-active', 'true');

    await row.locator('button', { hasText: 'Deactivate' }).click();
    await expect(row).toHaveAttribute('data-active', 'false');

    // Deactivated categories drop out of the merge/split source pickers
    // (active-only), since they shouldn't be selectable as a live source.
    await expect(page.locator('#category-merge-source')).not.toContainText('Temporary');

    await row.locator('button', { hasText: 'Reactivate' }).click();
    await expect(row).toHaveAttribute('data-active', 'true');
  });

  test('merge moves transactions and rules, then deactivates the source category', async ({
    page,
  }) => {
    await importFixture(page);

    // A user rule pointing at "Cash Withdrawal", the category we're about
    // to merge away — this rule must end up pointing at "Card Payment"
    // afterwards, not be left dangling.
    await page.selectOption('#rule-category', { label: 'Cash Withdrawal' });
    await page.selectOption('#rule-match-type', 'keyword');
    await page.fill('#rule-match-value', 'BANCOMAT');
    await page.click('#rule-submit-btn');
    await expect(page.locator('.rule-row[data-source="user"]', { hasText: 'BANCOMAT' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.selectOption('#category-merge-source', { label: 'Cash Withdrawal' });
    await page.selectOption('#category-merge-target', { label: 'Card Payment' });
    await page.click('#category-merge-form button[type="submit"]');

    await expect(page.locator('#category-merge-status')).toContainText(
      'moved 1 transaction(s) and 1 rule(s)'
    );

    // Source category is now inactive, not deleted.
    await expect(page.locator('.category-row', { hasText: 'Cash Withdrawal' })).toHaveAttribute(
      'data-active',
      'false'
    );

    // The transaction that was in "Cash Withdrawal" now shows "Card Payment"
    // and categorization method "manual" (a merge is a deliberate decision,
    // same as any other manual correction).
    const cashItem = mainRows(page).filter({ hasText: 'Prelievo Carta ATM' });
    await expect(cashItem).toContainText('Card Payment');
    await expect(cashItem).toHaveAttribute('data-categorization-method', 'manual');

    // The reassigned rule now points at "Card Payment".
    const ruleRow = page.locator('.rule-row[data-source="user"]', { hasText: 'BANCOMAT' });
    await expect(ruleRow).toContainText('Card Payment');
  });

  test('split moves only text-matching transactions to the target category', async ({ page }) => {
    await importFixture(page);

    await page.fill('#category-create-name', 'Bar Expenses');
    await page.click('#category-create-form button[type="submit"]');
    await expect(page.locator('.category-row', { hasText: 'Bar Expenses' })).toBeVisible();

    await page.selectOption('#category-split-source', { label: 'Card Payment' });
    await page.fill('#category-split-text', 'BAR CENTRALE');
    await page.click('#category-split-preview-btn');
    await expect(page.locator('#category-split-status')).toContainText('1 transaction(s) match');

    page.once('dialog', (dialog) => dialog.accept());
    await page.selectOption('#category-split-target', { label: 'Bar Expenses' });
    await page.click('#category-split-form button[type="submit"]');

    await expect(page.locator('#category-split-status')).toContainText('Moved 1 transaction(s)');

    const barItem = mainRows(page).filter({ hasText: 'BAR CENTRALE' });
    await expect(barItem).toContainText('Bar Expenses');
    await expect(barItem).toHaveAttribute('data-categorization-method', 'manual');

    // The other "Card Payment" transaction (different merchant text) is
    // untouched by the split.
    const supermarketItem = mainRows(page).filter({ hasText: 'SUPERMERCATO GIALLO' });
    await expect(supermarketItem).toContainText('Card Payment');
  });
});

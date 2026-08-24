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
 * Exercises Phase 3 end to end against the real app: default-rule
 * categorization applied automatically during import, a user rule
 * outranking a default rule, the rules management screen (create,
 * enable/disable, delete), and a manual correction.
 *
 * Reuses the same fixture as Phase 2's import.spec.js
 * (tests/e2e/fixtures/ing-sample.csv — fabricated data, not a real export):
 *   - BAR CENTRALE           / CAUSALE "Pagamento Carta"              (generic card payment)
 *   - SUPERMERCATO GIALLO    / CAUSALE "Pagamento Carta"              (generic card payment)
 *   - Accredito stipendio    / CAUSALE "Accredito Stipendio/Pensione" (salary)
 *   - Prelievo Carta ATM     / CAUSALE "Prelievo Carta"               (cash withdrawal)
 */
test.describe('Categorization', () => {
  test('default rules categorize transactions automatically during import', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await page.setInputFiles('#import-file-input', FIXTURE_PATH);
    await page.click('#import-preview-btn');
    await page.click('#import-confirm-btn');
    await expect(page.locator('#import-summary')).toHaveText(
      'Imported 4 transaction(s); skipped 0.'
    );

    const items = page.locator('#transaction-table-body tr:not(.transaction-detail-row)');

    // Accredito Stipendio/Pensione -> the "Salary / Pension" default rule
    const salaryItem = items.filter({ hasText: 'Accredito stipendio' });
    await expect(salaryItem).toContainText('Salary / Pension');
    await expect(salaryItem).toHaveAttribute('data-categorization-method', 'default');

    // Prelievo Carta -> the "Cash Withdrawal" default rule
    const cashItem = items.filter({ hasText: 'Prelievo Carta ATM' });
    await expect(cashItem).toContainText('Cash Withdrawal');
    await expect(cashItem).toHaveAttribute('data-categorization-method', 'default');

    // A generic "Pagamento Carta" -> the lowest-priority "Card Payment"
    // catch-all default rule
    const genericCardItem = items.filter({ hasText: 'SUPERMERCATO GIALLO' });
    await expect(genericCardItem).toContainText('Card Payment');
    await expect(genericCardItem).toHaveAttribute('data-categorization-method', 'default');
  });

  test('a user rule outranks a matching default rule', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    // Create a user rule for BAR CENTRALE, pointing at a different category
    // than the generic "Card Payment" default rule would assign.
    await page.selectOption('#rule-category', { label: 'Cash Withdrawal' });
    await page.selectOption('#rule-match-type', 'merchant');
    await page.fill('#rule-match-value', 'BAR CENTRALE');
    await page.fill('#rule-priority', '5');
    await page.click('#rule-submit-btn');

    await expect(page.locator('.rule-row[data-source="user"]')).toContainText('BAR CENTRALE');

    await page.setInputFiles('#import-file-input', FIXTURE_PATH);
    await page.click('#import-preview-btn');
    await page.click('#import-confirm-btn');

    const items = page.locator('#transaction-table-body tr:not(.transaction-detail-row)');

    // BAR CENTRALE: the user rule wins -> Cash Withdrawal / rule
    const barItem = items.filter({ hasText: 'BAR CENTRALE' });
    await expect(barItem).toContainText('Cash Withdrawal');
    await expect(barItem).toHaveAttribute('data-categorization-method', 'rule');

    // SUPERMERCATO GIALLO: no user rule matches it -> still the default rule
    const supermarketItem = items.filter({ hasText: 'SUPERMERCATO GIALLO' });
    await expect(supermarketItem).toContainText('Card Payment');
    await expect(supermarketItem).toHaveAttribute('data-categorization-method', 'default');
  });

  test('rules screen: create, disable, and delete a user rule', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await page.selectOption('#rule-category', { label: 'Transfer' });
    await page.selectOption('#rule-match-type', 'keyword');
    await page.fill('#rule-match-value', 'AFFITTO');
    await page.click('#rule-submit-btn');

    const ruleRow = page.locator('.rule-row[data-source="user"]', { hasText: 'AFFITTO' });
    await expect(ruleRow).toHaveAttribute('data-enabled', 'true');

    await ruleRow.locator('button', { hasText: 'Disable' }).click();
    await expect(ruleRow).toHaveAttribute('data-enabled', 'false');

    await ruleRow.locator('button', { hasText: 'Delete' }).click();
    await expect(page.locator('.rule-row[data-source="user"]', { hasText: 'AFFITTO' })).toHaveCount(0);
  });

  test('default rules are shown read-only, without edit/disable/delete controls', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const defaultRuleRow = page.locator('.rule-row[data-source="default"]').first();
    await expect(defaultRuleRow).toBeVisible();
    await expect(defaultRuleRow.locator('button')).toHaveCount(0);
  });

  test('a manual correction sets method to manual and overrides the prior category', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const inserted = await page.evaluate(() => window.MoneyMapApp.insertSampleTransaction());

    // Pick a category to correct to, different from the sample transaction's
    // own "Demo" category, by reading an option's value out of the rules
    // screen's category picker (the only category-bearing UI at this phase).
    await page.selectOption('#rule-category', { index: 2 });
    const targetCategoryId = await page.locator('#rule-category').inputValue();
    expect(targetCategoryId).not.toBe(inserted.categoryId);

    const corrected = await page.evaluate(
      ({ id, categoryId }) => window.MoneyMapApp.correctTransactionCategory(id, categoryId),
      { id: inserted.id, categoryId: targetCategoryId }
    );

    expect(corrected.categorizationMethod).toBe('manual');
    expect(corrected.categoryId).toBe(targetCategoryId);

    const item = page.locator(`#transaction-table-body tr[data-transaction-id="${inserted.id}"]`);
    await expect(item).toHaveAttribute('data-categorization-method', 'manual');
  });
});

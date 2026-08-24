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
 * Exercises the real Phase 2 flow end to end: load a synthetic ING CSV
 * fixture (tests/e2e/fixtures/ing-sample.csv — fabricated data, not a real
 * export), preview/classify it, confirm the import, then re-import the same
 * file to confirm every row is now flagged as an exact duplicate and,
 * left at its default (unchecked) decision, nothing is inserted twice.
 */
test.describe('ING CSV import', () => {
  test('imports new transactions, skips balance markers, and flags re-import as duplicates', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const initialCount = await page.locator('#transaction-table-body tr:not(.transaction-detail-row)').count();

    // --- First import: everything should be classified 'new' ---
    await page.setInputFiles('#import-file-input', FIXTURE_PATH);
    await page.click('#import-preview-btn');

    await expect(page.locator('.import-review-row')).toHaveCount(4);
    await expect(page.locator('[data-testid="import-skipped-note"]')).toContainText('2 row(s)');

    const rows = page.locator('.import-review-row');
    for (let i = 0; i < 4; i++) {
      await expect(rows.nth(i)).toHaveAttribute('data-status', 'new');
      await expect(rows.nth(i).locator('input[type="checkbox"]')).toBeChecked();
    }

    await page.click('#import-confirm-btn');
    await expect(page.locator('#import-summary')).toHaveText(
      'Imported 4 transaction(s); skipped 0.'
    );

    const afterFirstImportCount = await page.locator('#transaction-table-body tr:not(.transaction-detail-row)').count();
    expect(afterFirstImportCount).toBe(initialCount + 4);

    // --- Second import of the same file: everything should now be an
    // exact duplicate, defaulting to unchecked (skip), so confirming with
    // no changes imports nothing new. ---
    await page.setInputFiles('#import-file-input', FIXTURE_PATH);
    await page.click('#import-preview-btn');

    await expect(page.locator('.import-review-row')).toHaveCount(4);
    const rowsSecondPass = page.locator('.import-review-row');
    for (let i = 0; i < 4; i++) {
      await expect(rowsSecondPass.nth(i)).toHaveAttribute('data-status', 'exact_duplicate');
      await expect(rowsSecondPass.nth(i).locator('input[type="checkbox"]')).not.toBeChecked();
    }

    await page.click('#import-confirm-btn');
    await expect(page.locator('#import-summary')).toHaveText(
      'Imported 0 transaction(s); skipped 4.'
    );

    const afterSecondImportCount = await page.locator('#transaction-table-body tr:not(.transaction-detail-row)').count();
    expect(afterSecondImportCount).toBe(afterFirstImportCount);
  });

  test('the column mapping editor is pre-filled with ING defaults', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    await expect(page.locator('input[data-field="date"]')).toHaveValue('DATA CONTABILE');
    await expect(page.locator('input[data-field="outflow"]')).toHaveValue('USCITE');
    await expect(page.locator('input[data-field="inflow"]')).toHaveValue('ENTRATE');
    await expect(page.locator('input[data-field="description"]')).toHaveValue(
      'DESCRIZIONE OPERAZIONE'
    );
  });
});

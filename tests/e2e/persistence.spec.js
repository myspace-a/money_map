// @ts-check
import { test, expect } from '@playwright/test';

/**
 * STATUS: written but not executed in this container — no browser was
 * available to run Playwright here (see Build Chat wrap-up notes). This is
 * the primary Tier 1 test proving the whole point of Phase 1: that a
 * transaction written via WasmSqliteAdapter/OPFS survives a full page
 * reload, not just staying in memory for the current session.
 */
test.describe('persistence across reload', () => {
  test('a transaction inserted before reload is still present after reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const inserted = await page.evaluate(() => window.MoneyMapApp.insertSampleTransaction());
    expect(inserted.amountMinorUnits).toBe(-1250);
    expect(inserted.description).toBe('Demo transaction');

    await page.reload();
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const afterReload = await page.evaluate(() => window.MoneyMapApp.listTransactions());
    expect(afterReload.length).toBeGreaterThanOrEqual(1);

    const match = afterReload.find((t) => t.id === inserted.id);
    expect(match).toBeTruthy();
    expect(match.amountMinorUnits).toBe(-1250);
    expect(match.description).toBe('Demo transaction');

    // Also visible in the rendered table, not just queryable.
    await expect(
      page.locator(`#transaction-table-body tr[data-transaction-id="${inserted.id}"]`)
    ).toBeVisible();
  });

  test('inserted transaction is reflected in the DOM before reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('Database ready.', { timeout: 10_000 });

    const before = await page.locator('#transaction-table-body tr:not(.transaction-detail-row)').count();
    await page.evaluate(() => window.MoneyMapApp.insertSampleTransaction());
    const after = await page.locator('#transaction-table-body tr:not(.transaction-detail-row)').count();

    expect(after).toBe(before + 1);
  });
});

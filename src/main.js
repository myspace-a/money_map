/**
 * main.js — app entry point. Wires together everything built so far: on
 * load, run migrations, seed built-in default categories/rules (Phase 3),
 * and mount the transaction screen (Phase 4), import screen (Phase 2), and
 * rules screen (Phase 3). Also exposes a few operations on
 * `window.MoneyMapApp` so Playwright tests can drive things directly (e.g.
 * inserting a sample transaction, listing transactions after a reload).
 *
 * STATUS: written but not executed in this container (no browser
 * available). Needs a real run before being trusted — see Build Chat
 * wrap-up notes.
 */
import { WasmSqliteAdapter } from './persistence/wasmSqliteAdapter.js';
import { runMigrations } from './persistence/migrationRunner.js';
import { CategoryRepository } from './repositories/categoryRepository.js';
import { TransactionRepository } from './repositories/transactionRepository.js';
import { ImportSettingsRepository } from './repositories/importSettingsRepository.js';
import { RuleRepository } from './repositories/ruleRepository.js';
import { createCategory } from './domain/category.js';
import { createTransaction } from './domain/transaction.js';
import { initImportUI } from './import.js';
import { initRulesUI } from './rules.js';
import { initTransactionsUI } from './transactions.js';
import { seedDefaults } from './categorization/seedDefaults.js';
import { applyManualCategory } from './categorization/manualCorrection.js';

const statusEl = document.getElementById('status');
const transactionsSectionEl = document.getElementById('transactions-section');
const importSectionEl = document.getElementById('import-section');
const rulesSectionEl = document.getElementById('rules-section');

let db;
let categoryRepo;
let transactionRepo;
let importSettingsRepo;
let ruleRepo;
let transactionsUI;

async function init() {
  db = new WasmSqliteAdapter();
  await db.init();
  await runMigrations(db);
  categoryRepo = new CategoryRepository(db);
  transactionRepo = new TransactionRepository(db);
  importSettingsRepo = new ImportSettingsRepository(db);
  ruleRepo = new RuleRepository(db);

  // Built-in default categories/rules (Phase 3). Idempotent — safe to call
  // on every startup, same as runMigrations() above.
  await seedDefaults(categoryRepo, ruleRepo);

  statusEl.textContent = 'Database ready.';

  transactionsUI = initTransactionsUI({
    root: transactionsSectionEl,
    transactionRepo,
    categoryRepo,
  });

  initImportUI({
    root: importSectionEl,
    transactionRepo,
    importSettingsRepo,
    ruleRepo,
    onImportCommitted: () => transactionsUI.refresh(),
  });

  initRulesUI({
    root: rulesSectionEl,
    ruleRepo,
    categoryRepo,
  });
}

/**
 * Inserts one sample transaction, creating a demo category the first time.
 * Exposed on window.MoneyMapApp for the Playwright test to call.
 * @returns {Promise<object>} the inserted transaction
 */
async function insertSampleTransaction() {
  let categories = await categoryRepo.findAll();
  let category = categories[0];
  if (!category) {
    category = createCategory({ name: 'Demo' });
    await categoryRepo.insert(category);
  }

  const transaction = createTransaction({
    date: '2026-03-14',
    amountMinorUnits: -1250,
    description: 'Demo transaction',
    categoryId: category.id,
    categorizationMethod: 'manual',
    fingerprint: `demo-${Date.now()}-${Math.random()}`,
  });
  await transactionRepo.insert(transaction);
  await transactionsUI.refresh();
  return transaction;
}

/**
 * Exposed on window.MoneyMapApp for the Playwright test to call after reload.
 * @returns {Promise<object[]>}
 */
async function listTransactions() {
  return transactionRepo.findAll();
}

/**
 * Exposed on window.MoneyMapApp as a direct, no-UI way to drive a manual
 * correction — kept for existing Playwright tests that exercise
 * categorization behavior (PROJECT_SPEC.md §3.4) without going through the
 * transaction table's UI. The transaction table (transactions.js) also
 * offers the same correction through its own category-editor dropdown now
 * that Phase 4 exists.
 * @param {string} transactionId
 * @param {string} categoryId
 * @returns {Promise<object>}
 */
async function correctTransactionCategory(transactionId, categoryId) {
  const transaction = await transactionRepo.findById(transactionId);
  const updated = await applyManualCategory(transaction, categoryId, transactionRepo);
  await transactionsUI.refresh();
  return updated;
}

/**
 * Dev-only utility exposed on window.MoneyMapApp — NOT part of the app's UI
 * (PROJECT_SPEC.md §4 requires the app itself to never silently delete
 * financial data; this is a deliberate, explicit console action for local
 * testing, not a feature the app exposes to a user).
 *
 * Closes the WasmSqliteAdapter (terminates the worker, which releases the
 * OPFS SyncAccessHandle lock db-worker.js holds on money-map.sqlite3 while
 * the app is running — that lock is exactly what caused the earlier
 * "DOMException: No modification allowed" when trying to delete the file
 * out from under a running page), deletes every file in the app's own OPFS
 * directory (`money-map-opfs` — never touches other origins/paths, e.g.
 * sibling GitHub Pages projects sharing this origin), then reloads.
 *
 * Usage from the browser console:
 *   window.MoneyMapApp.resetDatabase({ confirm: true })
 * The `confirm: true` is required on purpose, so this can't be triggered
 * by an accidental or pasted call with no arguments.
 *
 * @param {{ confirm: boolean }} options
 * @returns {Promise<void>}
 */
async function resetDatabase({ confirm } = {}) {
  if (confirm !== true) {
    throw new Error(
      'resetDatabase requires explicit confirmation: window.MoneyMapApp.resetDatabase({ confirm: true })'
    );
  }

  console.warn('Resetting Money Map local database — this deletes all local transactions, categories, and rules.');

  db.close();

  const root = await navigator.storage.getDirectory();
  const opfsDir = await root.getDirectoryHandle('money-map-opfs');
  for await (const name of opfsDir.keys()) {
    await opfsDir.removeEntry(name);
  }

  console.warn('Database files removed. Reloading…');
  location.reload();
}

window.MoneyMapApp = {
  insertSampleTransaction,
  listTransactions,
  correctTransactionCategory,
  resetDatabase,
};

init().catch((err) => {
  statusEl.textContent = `Failed to initialize database: ${err.message}`;
  console.error(err);
});

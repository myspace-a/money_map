/**
 * categoryOperations.js — the two multi-table category operations Phase 5
 * adds on top of the simple single-row category edits (create/rename/
 * deactivate, which just call CategoryRepository.insert()/update()
 * directly from categories.js and don't need a dedicated function here).
 *
 * Both operations touch more than one table (categories, transactions, and
 * possibly rules) and must never leave the database in a half-changed
 * state — PROJECT_SPEC.md §3.6 requires "historical transactions must
 * remain consistent and category changes must not corrupt data," and §4
 * requires financial data is never silently corrupted. Both functions
 * therefore run everything inside a single `db.transaction()`
 * (ARCHITECTURE.md §4.2): if any step fails, nothing changes.
 *
 * Neither function is exposed to the UI as a raw SQL operation — categories.js
 * calls these, not the repositories directly, for merge/split specifically.
 */

/**
 * Merges one category into another: every transaction and every rule
 * currently pointing at `sourceCategoryId` is reassigned to
 * `targetCategoryId`, then the source category is deactivated.
 *
 * The source category is deactivated, never deleted — categories use
 * stable ids and PROJECT_SPEC.md §3.6/§4 require the app never silently
 * delete financial/structural data. Deactivating (rather than leaving it
 * active with zero transactions) keeps it out of "active category" pickers
 * elsewhere in the app (rules.js, transactions.js filters) so it doesn't
 * look like a live, usable category with nothing in it.
 *
 * Rules are reassigned automatically (not blocked) — a rule left pointing
 * at a deactivated category would keep silently categorizing future
 * imports into a category nobody sees anymore, which is worse than moving
 * it to the category the user just said everything should belong to.
 *
 * @param {import('../persistence/db-port.js').Database} db
 * @param {{
 *   categoryRepoFactory: (db: import('../persistence/db-port.js').Database) => import('../repositories/categoryRepository.js').CategoryRepository,
 *   transactionRepoFactory: (db: import('../persistence/db-port.js').Database) => import('../repositories/transactionRepository.js').TransactionRepository,
 *   ruleRepoFactory: (db: import('../persistence/db-port.js').Database) => import('../repositories/ruleRepository.js').RuleRepository,
 * }} repoFactories - constructs fresh repositories bound to the transaction's
 *   own `db` handle (per ARCHITECTURE.md §4.2, `db.transaction(fn)` passes a
 *   `tx` handle into `fn`; every repository call inside the transaction must
 *   use that handle, not the outer one, so it participates in the same
 *   transaction/rollback).
 * @param {string} sourceCategoryId
 * @param {string} targetCategoryId
 * @returns {Promise<{transactionsMoved: number, rulesMoved: number}>}
 */
export async function mergeCategories(
  db,
  { categoryRepoFactory, transactionRepoFactory, ruleRepoFactory },
  sourceCategoryId,
  targetCategoryId
) {
  if (!sourceCategoryId || !targetCategoryId) {
    throw new TypeError('mergeCategories requires both a sourceCategoryId and a targetCategoryId');
  }
  if (sourceCategoryId === targetCategoryId) {
    throw new TypeError('Cannot merge a category into itself');
  }

  let transactionsMoved = 0;
  let rulesMoved = 0;

  await db.transaction(async (tx) => {
    const categoryRepo = categoryRepoFactory(tx);
    const transactionRepo = transactionRepoFactory(tx);
    const ruleRepo = ruleRepoFactory(tx);

    const [source, target] = await Promise.all([
      categoryRepo.findById(sourceCategoryId),
      categoryRepo.findById(targetCategoryId),
    ]);
    if (!source) throw new Error('Source category not found');
    if (!target) throw new Error('Target category not found');

    transactionsMoved = await transactionRepo.reassignCategory(sourceCategoryId, targetCategoryId, {
      evidence: {
        type: 'manual',
        reason: 'category-merge',
        fromCategoryName: source.name,
        toCategoryName: target.name,
      },
    });

    rulesMoved = await ruleRepo.reassignCategory(sourceCategoryId, targetCategoryId);

    source.active = false;
    source.updatedAt = new Date().toISOString();
    await categoryRepo.update(source);
  });

  return { transactionsMoved, rulesMoved };
}

/**
 * Moves every transaction in `fromCategoryId` whose description, merchant,
 * or original bank text contains `textFilter` into `toCategoryId`. This is
 * the bulk primitive the "split a category" workflow (PROJECT_SPEC.md
 * §3.6) is built from in categories.js: create a new category, then use
 * this to pull a matching subset of an existing category's transactions
 * into it. It's deliberately a plain text filter, not a saved/rule-based
 * split — PROJECT_SPEC.md §2 asks to avoid speculative complexity, and a
 * one-off bulk move doesn't need to become a persistent rule (a user who
 * wants that going forward can already create one via rules.js).
 *
 * @param {import('../persistence/db-port.js').Database} db
 * @param {{
 *   transactionRepoFactory: (db: import('../persistence/db-port.js').Database) => import('../repositories/transactionRepository.js').TransactionRepository,
 *   categoryRepoFactory: (db: import('../persistence/db-port.js').Database) => import('../repositories/categoryRepository.js').CategoryRepository,
 * }} repoFactories
 * @param {string} fromCategoryId
 * @param {string} toCategoryId
 * @param {string} textFilter - non-empty, matched case-insensitively
 * @returns {Promise<{transactionsMoved: number}>}
 */
export async function splitCategoryByText(
  db,
  { transactionRepoFactory, categoryRepoFactory },
  fromCategoryId,
  toCategoryId,
  textFilter
) {
  if (!fromCategoryId || !toCategoryId) {
    throw new TypeError('splitCategoryByText requires both a fromCategoryId and a toCategoryId');
  }
  if (fromCategoryId === toCategoryId) {
    throw new TypeError('Cannot move transactions from a category into itself');
  }
  if (!textFilter || typeof textFilter !== 'string' || textFilter.trim().length === 0) {
    throw new TypeError('splitCategoryByText requires a non-empty text filter');
  }
  const trimmedFilter = textFilter.trim();

  let transactionsMoved = 0;

  await db.transaction(async (tx) => {
    const transactionRepo = transactionRepoFactory(tx);
    const categoryRepo = categoryRepoFactory(tx);

    const [fromCategory, toCategory] = await Promise.all([
      categoryRepo.findById(fromCategoryId),
      categoryRepo.findById(toCategoryId),
    ]);
    if (!fromCategory) throw new Error('Source category not found');
    if (!toCategory) throw new Error('Target category not found');

    transactionsMoved = await transactionRepo.reassignCategoryByText(
      fromCategoryId,
      toCategoryId,
      trimmedFilter,
      {
        evidence: {
          type: 'manual',
          reason: 'category-split',
          matchedText: trimmedFilter,
          fromCategoryName: fromCategory.name,
          toCategoryName: toCategory.name,
        },
      }
    );
  });

  return { transactionsMoved };
}

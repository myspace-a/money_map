import { describe, it, expect, afterEach } from 'vitest';
import { NodeSqliteAdapter } from '../../src/persistence/nodeSqliteAdapter.js';
import { runMigrations } from '../../src/persistence/migrationRunner.js';
import { CategoryRepository } from '../../src/repositories/categoryRepository.js';
import { TransactionRepository } from '../../src/repositories/transactionRepository.js';
import { RuleRepository } from '../../src/repositories/ruleRepository.js';
import { createCategory } from '../../src/domain/category.js';
import { createTransaction } from '../../src/domain/transaction.js';
import { createRule } from '../../src/domain/rule.js';
import { mergeCategories, splitCategoryByText } from '../../src/categories/categoryOperations.js';

/**
 * Covers the reassignment SQL and transactional atomicity behind category
 * merge/split (Phase 5, PROJECT_SPEC.md §3.6) directly against a real
 * SQLite engine (NodeSqliteAdapter), not just via Playwright. Proposed as a
 * small, deliberate addition beyond the four narrow Vitest areas listed in
 * ARCHITECTURE.md §7.2 — flagged at Build Chat wrap-up for the Requirements
 * & Architecture chat, since it's testing repository/transaction behavior
 * (same precedent as tests/unit/repositories.spec.js) rather than one of
 * the four listed areas verbatim.
 */

const repoFactories = {
  categoryRepoFactory: (db) => new CategoryRepository(db),
  transactionRepoFactory: (db) => new TransactionRepository(db),
  ruleRepoFactory: (db) => new RuleRepository(db),
};

function makeTx({ categoryId, description = 'Test transaction', amountMinorUnits = -1000 }) {
  return createTransaction({
    date: '2026-03-14',
    amountMinorUnits,
    description,
    categoryId,
    categorizationMethod: 'manual',
    fingerprint: `fp-${Math.random()}`,
  });
}

describe('categoryOperations (NodeSqliteAdapter)', () => {
  let db;
  let categoryRepo;
  let transactionRepo;
  let ruleRepo;

  afterEach(() => {
    db?.close();
  });

  async function setup() {
    db = new NodeSqliteAdapter();
    await runMigrations(db);
    categoryRepo = new CategoryRepository(db);
    transactionRepo = new TransactionRepository(db);
    ruleRepo = new RuleRepository(db);
  }

  describe('mergeCategories', () => {
    it('reassigns transactions and rules, then deactivates the source category', async () => {
      await setup();

      const source = createCategory({ name: 'Cash Withdrawal' });
      const target = createCategory({ name: 'Card Payment' });
      await categoryRepo.insert(source);
      await categoryRepo.insert(target);

      const t1 = makeTx({ categoryId: source.id, description: 'ATM 1' });
      const t2 = makeTx({ categoryId: source.id, description: 'ATM 2' });
      const untouched = makeTx({ categoryId: target.id, description: 'Bar' });
      await transactionRepo.insert(t1);
      await transactionRepo.insert(t2);
      await transactionRepo.insert(untouched);

      const rule = createRule({ categoryId: source.id, matchType: 'keyword', matchValue: 'BANCOMAT' });
      await ruleRepo.insert(rule);

      const result = await mergeCategories(db, repoFactories, source.id, target.id);

      expect(result.transactionsMoved).toBe(2);
      expect(result.rulesMoved).toBe(1);

      const movedT1 = await transactionRepo.findById(t1.id);
      const movedT2 = await transactionRepo.findById(t2.id);
      expect(movedT1.categoryId).toBe(target.id);
      expect(movedT2.categoryId).toBe(target.id);
      expect(movedT1.categorizationMethod).toBe('manual');
      expect(movedT1.categorizationEvidence).toMatchObject({ type: 'manual', reason: 'category-merge' });

      // A transaction already in the target is untouched.
      const stillInTarget = await transactionRepo.findById(untouched.id);
      expect(stillInTarget.categoryId).toBe(target.id);

      const movedRule = await ruleRepo.findById(rule.id);
      expect(movedRule.categoryId).toBe(target.id);

      const sourceAfter = await categoryRepo.findById(source.id);
      expect(sourceAfter.active).toBe(false);

      // Source category still exists (never deleted) — just inactive.
      const allIncludingInactive = await categoryRepo.findAll({ includeInactive: true });
      expect(allIncludingInactive.map((c) => c.id)).toContain(source.id);
    });

    it('rejects merging a category into itself', async () => {
      await setup();
      const category = createCategory({ name: 'Groceries' });
      await categoryRepo.insert(category);

      await expect(mergeCategories(db, repoFactories, category.id, category.id)).rejects.toThrow();
    });

    it('rolls back entirely if the target category does not exist', async () => {
      await setup();
      const source = createCategory({ name: 'Cash Withdrawal' });
      await categoryRepo.insert(source);
      const t1 = makeTx({ categoryId: source.id });
      await transactionRepo.insert(t1);

      await expect(
        mergeCategories(db, repoFactories, source.id, 'nonexistent-id')
      ).rejects.toThrow();

      // Nothing should have moved or changed.
      const unchanged = await transactionRepo.findById(t1.id);
      expect(unchanged.categoryId).toBe(source.id);
      const sourceAfter = await categoryRepo.findById(source.id);
      expect(sourceAfter.active).toBe(true);
    });
  });

  describe('splitCategoryByText', () => {
    it('moves only transactions whose text matches the filter', async () => {
      await setup();

      const source = createCategory({ name: 'Card Payment' });
      const target = createCategory({ name: 'Bar Expenses' });
      await categoryRepo.insert(source);
      await categoryRepo.insert(target);

      const barTx = makeTx({ categoryId: source.id, description: 'Payment presso BAR CENTRALE' });
      const supermarketTx = makeTx({
        categoryId: source.id,
        description: 'Payment presso SUPERMERCATO GIALLO',
      });
      await transactionRepo.insert(barTx);
      await transactionRepo.insert(supermarketTx);

      const result = await splitCategoryByText(db, repoFactories, source.id, target.id, 'BAR CENTRALE');

      expect(result.transactionsMoved).toBe(1);

      const moved = await transactionRepo.findById(barTx.id);
      expect(moved.categoryId).toBe(target.id);
      expect(moved.categorizationMethod).toBe('manual');
      expect(moved.categorizationEvidence).toMatchObject({ type: 'manual', reason: 'category-split' });

      const notMoved = await transactionRepo.findById(supermarketTx.id);
      expect(notMoved.categoryId).toBe(source.id);
    });

    it('rejects an empty text filter', async () => {
      await setup();
      const source = createCategory({ name: 'Card Payment' });
      const target = createCategory({ name: 'Bar Expenses' });
      await categoryRepo.insert(source);
      await categoryRepo.insert(target);

      await expect(
        splitCategoryByText(db, repoFactories, source.id, target.id, '   ')
      ).rejects.toThrow();
    });
  });
});

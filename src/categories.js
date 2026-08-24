/**
 * categories.js — Phase 5 UI feature module (ARCHITECTURE.md §5: one module
 * per screen/feature area). Owns the category management screen:
 *
 *   - list all categories (active and inactive) — PROJECT_SPEC.md §3.6
 *   - create a category
 *   - rename a category
 *   - deactivate / reactivate a category (never delete — §3.6, §4: stable
 *     ids, categories are never removed, only hidden from "active" pickers
 *     elsewhere in the app)
 *   - merge one category into another (moves its transactions and rules,
 *     then deactivates it) — categories/categoryOperations.js does the
 *     actual multi-table work; this module is just the form/list around it
 *   - split: move transactions matching a text filter out of one category
 *     into another (typically a brand-new one created just above) — the
 *     bulk primitive categoryOperations.splitCategoryByText() provides,
 *     since the transaction table (Phase 4) has no multi-select
 *
 * Deliberately minimal per PROJECT_SPEC.md §2 (MVP, avoid speculative
 * complexity): no drag-and-drop, no undo — merge/split show a preview count
 * before committing, since both are bulk, hard-to-eyeball changes, but once
 * confirmed they run as one atomic transaction (ARCHITECTURE.md §4.2).
 */

import {
  mergeCategories as mergeCategoriesOperation,
  splitCategoryByText as splitCategoryByTextOperation,
} from './categories/categoryOperations.js';
import { createCategory } from './domain/category.js';

/**
 * @param {{
 *   root: HTMLElement,
 *   db: import('./persistence/db-port.js').Database,
 *   categoryRepo: import('./repositories/categoryRepository.js').CategoryRepository,
 *   categoryRepoFactory: (db: import('./persistence/db-port.js').Database) => import('./repositories/categoryRepository.js').CategoryRepository,
 *   transactionRepo: import('./repositories/transactionRepository.js').TransactionRepository,
 *   transactionRepoFactory: (db: import('./persistence/db-port.js').Database) => import('./repositories/transactionRepository.js').TransactionRepository,
 *   ruleRepo: import('./repositories/ruleRepository.js').RuleRepository,
 *   ruleRepoFactory: (db: import('./persistence/db-port.js').Database) => import('./repositories/ruleRepository.js').RuleRepository,
 *   onCategoriesChanged?: () => void,
 * }} options - `db` plus the three `*RepoFactory` functions are needed
 *   (rather than just the three already-constructed repos) because
 *   merge/split run inside `db.transaction()` (ARCHITECTURE.md §4.2), which
 *   requires building fresh repositories bound to the transaction's own
 *   handle — see categories/categoryOperations.js.
 * @returns {{ refresh: () => Promise<void> }} exposes refresh() so other
 *   screens can ask this one to reload (mirrors transactions.js/rules.js)
 */
export function initCategoriesUI({
  root,
  db,
  categoryRepo,
  categoryRepoFactory,
  transactionRepo,
  transactionRepoFactory,
  ruleRepo,
  ruleRepoFactory,
  onCategoriesChanged,
}) {
  const listEl = root.querySelector('#categories-list');
  const createForm = root.querySelector('#category-create-form');
  const createNameInput = createForm.querySelector('#category-create-name');
  const createErrorEl = root.querySelector('#category-create-error');

  const mergeForm = root.querySelector('#category-merge-form');
  const mergeSourceSelect = mergeForm.querySelector('#category-merge-source');
  const mergeTargetSelect = mergeForm.querySelector('#category-merge-target');
  const mergeStatusEl = root.querySelector('#category-merge-status');

  const splitForm = root.querySelector('#category-split-form');
  const splitSourceSelect = splitForm.querySelector('#category-split-source');
  const splitTextInput = splitForm.querySelector('#category-split-text');
  const splitTargetSelect = splitForm.querySelector('#category-split-target');
  const splitPreviewBtn = splitForm.querySelector('#category-split-preview-btn');
  const splitStatusEl = root.querySelector('#category-split-status');

  /** @type {Array} categories, including inactive ones */
  let allCategories = [];

  async function refresh() {
    allCategories = await categoryRepo.findAll({ includeInactive: true });
    renderList(listEl, allCategories);
    populateCategoryOptions(mergeSourceSelect, allCategories, { includeInactive: false });
    populateCategoryOptions(mergeTargetSelect, allCategories, { includeInactive: false });
    populateCategoryOptions(splitSourceSelect, allCategories, { includeInactive: false });
    populateCategoryOptions(splitTargetSelect, allCategories, { includeInactive: false });
  }

  async function notifyChanged() {
    await refresh();
    onCategoriesChanged?.();
  }

  // --- Create ---
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    createErrorEl.textContent = '';
    try {
      const category = createCategory({ name: createNameInput.value });
      await categoryRepo.insert(category);
      createForm.reset();
      await notifyChanged();
    } catch (err) {
      createErrorEl.textContent = err.message;
    }
  });

  // --- Rename / deactivate / reactivate (per-row actions) ---
  listEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('[data-category-id]');
    if (!row) return;
    const categoryId = row.dataset.categoryId;

    if (target.dataset.action === 'rename') {
      const category = await categoryRepo.findById(categoryId);
      if (!category) return;
      const newName = window.prompt('Rename category to:', category.name);
      if (newName === null) return; // cancelled
      const trimmed = newName.trim();
      if (!trimmed) return;
      category.name = trimmed;
      category.updatedAt = new Date().toISOString();
      await categoryRepo.update(category);
      await notifyChanged();
    } else if (target.dataset.action === 'deactivate') {
      const category = await categoryRepo.findById(categoryId);
      if (!category) return;
      category.active = false;
      category.updatedAt = new Date().toISOString();
      await categoryRepo.update(category);
      await notifyChanged();
    } else if (target.dataset.action === 'reactivate') {
      const category = await categoryRepo.findById(categoryId);
      if (!category) return;
      category.active = true;
      category.updatedAt = new Date().toISOString();
      await categoryRepo.update(category);
      await notifyChanged();
    }
  });

  // --- Merge ---
  mergeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    mergeStatusEl.textContent = '';
    const sourceId = mergeSourceSelect.value;
    const targetId = mergeTargetSelect.value;

    if (!sourceId || !targetId) {
      mergeStatusEl.textContent = 'Choose both a source and a target category.';
      return;
    }
    if (sourceId === targetId) {
      mergeStatusEl.textContent = 'Source and target must be different categories.';
      return;
    }

    const [pendingTransactions, pendingRules] = await Promise.all([
      transactionRepo.findByCategoryId(sourceId),
      ruleRepo.findByCategoryId(sourceId),
    ]);
    const sourceName = mergeSourceSelect.options[mergeSourceSelect.selectedIndex]?.textContent;
    const targetName = mergeTargetSelect.options[mergeTargetSelect.selectedIndex]?.textContent;

    const confirmed = window.confirm(
      `Merge "${sourceName}" into "${targetName}"?\n\n` +
        `${pendingTransactions.length} transaction(s) and ${pendingRules.length} rule(s) will move to "${targetName}". ` +
        `"${sourceName}" will then be deactivated. This cannot be undone automatically.`
    );
    if (!confirmed) return;

    try {
      const result = await mergeCategoriesOperation(
        db,
        { categoryRepoFactory, transactionRepoFactory, ruleRepoFactory },
        sourceId,
        targetId
      );
      mergeStatusEl.textContent = `Merged: moved ${result.transactionsMoved} transaction(s) and ${result.rulesMoved} rule(s).`;
      mergeForm.reset();
      await notifyChanged();
    } catch (err) {
      mergeStatusEl.textContent = `Merge failed: ${err.message}`;
    }
  });

  // --- Split (bulk move by text filter) ---
  splitPreviewBtn.addEventListener('click', async () => {
    splitStatusEl.textContent = '';
    const sourceId = splitSourceSelect.value;
    const textFilter = splitTextInput.value.trim();
    if (!sourceId || !textFilter) {
      splitStatusEl.textContent = 'Choose a source category and enter a text filter first.';
      return;
    }
    const matches = await transactionRepo.findByCategoryIdAndText(sourceId, textFilter);
    splitStatusEl.textContent = `${matches.length} transaction(s) match "${textFilter}" in "${
      splitSourceSelect.options[splitSourceSelect.selectedIndex]?.textContent
    }".`;
  });

  splitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    splitStatusEl.textContent = '';
    const sourceId = splitSourceSelect.value;
    const targetId = splitTargetSelect.value;
    const textFilter = splitTextInput.value.trim();

    if (!sourceId || !targetId) {
      splitStatusEl.textContent = 'Choose both a source and a target category.';
      return;
    }
    if (sourceId === targetId) {
      splitStatusEl.textContent = 'Source and target must be different categories.';
      return;
    }
    if (!textFilter) {
      splitStatusEl.textContent = 'Enter a text filter to match transactions.';
      return;
    }

    const matches = await transactionRepo.findByCategoryIdAndText(sourceId, textFilter);
    const sourceName = splitSourceSelect.options[splitSourceSelect.selectedIndex]?.textContent;
    const targetName = splitTargetSelect.options[splitTargetSelect.selectedIndex]?.textContent;

    if (matches.length === 0) {
      splitStatusEl.textContent = `No transactions in "${sourceName}" match "${textFilter}".`;
      return;
    }

    const confirmed = window.confirm(
      `Move ${matches.length} transaction(s) matching "${textFilter}" from "${sourceName}" to "${targetName}"?`
    );
    if (!confirmed) return;

    try {
      const result = await splitCategoryByTextOperation(
        db,
        { transactionRepoFactory, categoryRepoFactory },
        sourceId,
        targetId,
        textFilter
      );
      splitStatusEl.textContent = `Moved ${result.transactionsMoved} transaction(s) to "${targetName}".`;
      splitTextInput.value = '';
      await notifyChanged();
    } catch (err) {
      splitStatusEl.textContent = `Split failed: ${err.message}`;
    }
  });

  refresh().catch((err) => {
    createErrorEl.textContent = `Could not load categories: ${err.message}`;
  });

  return { refresh };
}

function renderList(listEl, categories) {
  listEl.innerHTML = '';

  if (categories.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No categories yet.';
    listEl.appendChild(empty);
    return;
  }

  for (const category of categories) {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.dataset.categoryId = category.id;
    row.dataset.active = String(category.active);

    const label = document.createElement('span');
    label.textContent = `${category.name} (${category.active ? 'active' : 'inactive'})`;
    row.appendChild(label);

    const renameBtn = makeButton('Rename', 'rename');
    row.appendChild(renameBtn);

    if (category.active) {
      row.appendChild(makeButton('Deactivate', 'deactivate'));
    } else {
      row.appendChild(makeButton('Reactivate', 'reactivate'));
    }

    listEl.appendChild(row);
  }
}

function populateCategoryOptions(select, categories, { includeInactive = false } = {}) {
  const previousValue = select.value;
  const options = includeInactive ? categories : categories.filter((c) => c.active);

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— choose a category —';
  select.appendChild(placeholder);
  for (const category of options) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }
  if (previousValue && options.some((c) => c.id === previousValue)) {
    select.value = previousValue;
  }
}

function makeButton(text, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.dataset.action = action;
  return btn;
}

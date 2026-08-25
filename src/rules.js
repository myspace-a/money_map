/**
 * rules.js — Phase 3 UI feature module (ARCHITECTURE.md §5: one module per
 * screen/feature area). Owns the rules management screen: list all rules
 * (user and default), create/edit/enable-disable/delete a **user** rule.
 *
 * Default rules are shown read-only — PROJECT_SPEC.md §3.3 requires default
 * rules to stay "separate from user rules and versionable," which means
 * they're not user-editable from this screen; the categorization method
 * (`default` vs `rule`) that ends up on a transaction already reflects the
 * distinction, so a user always knows which kind categorized something.
 *
 * Deliberately minimal per PROJECT_SPEC.md §2 (MVP, avoid speculative UX):
 * plain form controls, no drag-to-reorder, no rule preview/test-run against
 * existing data — just enough to create, adjust, and remove rules.
 *
 * Category picker uses whatever categories already exist (including the
 * ones created by categorization/seedDefaults.js on first run). Creating a
 * brand-new category from this screen is Phase 5's job (Category
 * Management), not this one.
 */

import { MATCH_TYPES, createRule } from './domain/rule.js';

const SOURCE_LABELS = { user: 'Custom', default: 'Built-in' };

/**
 * @param {{
 *   root: HTMLElement,
 *   ruleRepo: import('./repositories/ruleRepository.js').RuleRepository,
 *   categoryRepo: import('./repositories/categoryRepository.js').CategoryRepository,
 * }} options
 */
export function initRulesUI({ root, ruleRepo, categoryRepo }) {
  const listEl = root.querySelector('#rules-list');
  const form = root.querySelector('#rule-form');
  const matchTypeSelect = form.querySelector('#rule-match-type');
  const matchValueInput = form.querySelector('#rule-match-value');
  const categorySelect = form.querySelector('#rule-category');
  const priorityInput = form.querySelector('#rule-priority');
  const submitBtn = form.querySelector('#rule-submit-btn');
  const cancelEditBtn = form.querySelector('#rule-cancel-edit-btn');
  const errorEl = root.querySelector('#rule-error');

  populateMatchTypeOptions(matchTypeSelect);

  /** @type {string|null} id of the rule currently being edited, or null for "create" */
  let editingRuleId = null;

  async function refresh() {
    const [rules, categories] = await Promise.all([ruleRepo.findAll(), categoryRepo.findAll()]);
    populateCategoryOptions(categorySelect, categories);
    renderList(listEl, rules, categories);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';

    const categoryId = categorySelect.value;
    const matchType = matchTypeSelect.value;
    const matchValue = matchValueInput.value.trim();
    const priority = Number(priorityInput.value) || 0;

    if (!categoryId) {
      errorEl.textContent = 'Choose a category first.';
      return;
    }

    try {
      if (editingRuleId) {
        const existing = await ruleRepo.findById(editingRuleId);
        if (!existing) {
          errorEl.textContent = 'This rule no longer exists.';
        } else {
          existing.categoryId = categoryId;
          existing.matchType = matchType;
          existing.matchValue = matchValue;
          existing.priority = priority;
          existing.updatedAt = new Date().toISOString();
          await ruleRepo.update(existing);
        }
      } else {
        const rule = createRule({ categoryId, matchType, matchValue, priority, source: 'user' });
        await ruleRepo.insert(rule);
      }
      resetForm();
      await refresh();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  cancelEditBtn.addEventListener('click', () => {
    resetForm();
  });

  listEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('[data-rule-id]');
    if (!row) return;
    const ruleId = row.dataset.ruleId;

    if (target.dataset.action === 'edit') {
      const rule = await ruleRepo.findById(ruleId);
      if (rule) startEdit(rule);
    } else if (target.dataset.action === 'toggle-enabled') {
      const rule = await ruleRepo.findById(ruleId);
      if (rule) {
        rule.enabled = !rule.enabled;
        rule.updatedAt = new Date().toISOString();
        await ruleRepo.update(rule);
        await refresh();
      }
    } else if (target.dataset.action === 'delete') {
      await ruleRepo.delete(ruleId);
      if (editingRuleId === ruleId) resetForm();
      await refresh();
    }
  });

  function startEdit(rule) {
    editingRuleId = rule.id;
    categorySelect.value = rule.categoryId;
    matchTypeSelect.value = rule.matchType;
    matchValueInput.value = rule.matchValue;
    priorityInput.value = String(rule.priority);
    submitBtn.textContent = 'Save changes';
    cancelEditBtn.hidden = false;
  }

  function resetForm() {
    editingRuleId = null;
    form.reset();
    submitBtn.textContent = 'Add rule';
    cancelEditBtn.hidden = true;
    errorEl.textContent = '';
  }

  resetForm();
  refresh().catch((err) => {
    errorEl.textContent = `Could not load rules: ${err.message}`;
  });

  return { refresh };
}

function populateMatchTypeOptions(select) {
  select.innerHTML = '';
  for (const type of MATCH_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.appendChild(option);
  }
}

function populateCategoryOptions(select, categories) {
  const previousValue = select.value;
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— choose a category —';
  select.appendChild(placeholder);
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }
  if (previousValue && categories.some((c) => c.id === previousValue)) {
    select.value = previousValue;
  }
}

function renderList(listEl, rules, categories) {
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  listEl.innerHTML = '';

  if (rules.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No rules yet.';
    listEl.appendChild(empty);
    return;
  }

  for (const rule of rules) {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.dataset.ruleId = rule.id;
    row.dataset.source = rule.source;
    row.dataset.enabled = String(rule.enabled);

    const label = document.createElement('span');
    const categoryName = categoryNameById.get(rule.categoryId) ?? '(unknown category)';
    label.textContent = `[${SOURCE_LABELS[rule.source]}] ${rule.matchType}: "${rule.matchValue}" → ${categoryName} (priority ${rule.priority}, ${rule.enabled ? 'enabled' : 'disabled'})`;
    row.appendChild(label);

    if (rule.source === 'user') {
      const editBtn = makeButton('Edit', 'edit');
      const toggleBtn = makeButton(rule.enabled ? 'Disable' : 'Enable', 'toggle-enabled');
      const deleteBtn = makeButton('Delete', 'delete');
      row.appendChild(editBtn);
      row.appendChild(toggleBtn);
      row.appendChild(deleteBtn);
    }

    listEl.appendChild(row);
  }
}

function makeButton(text, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.dataset.action = action;
  return btn;
}

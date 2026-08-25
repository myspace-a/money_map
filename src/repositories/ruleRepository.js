/**
 * RuleRepository — depends only on the Database port (db-port.js).
 */
export class RuleRepository {
  /**
   * @param {import('../persistence/db-port.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {import('../domain/rule.js').Rule} rule
   * @returns {Promise<void>}
   */
  async insert(rule) {
    await this.db.execute(
      `INSERT INTO rules
         (id, category_id, match_type, match_value, priority, enabled, source, rule_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        rule.id,
        rule.categoryId,
        rule.matchType,
        rule.matchValue,
        rule.priority,
        rule.enabled ? 1 : 0,
        rule.source,
        rule.ruleVersion,
        rule.createdAt,
        rule.updatedAt,
      ]
    );
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../domain/rule.js').Rule|null>}
   */
  async findById(id) {
    const rows = await this.db.query('SELECT * FROM rules WHERE id = ?;', [id]);
    return rows.length > 0 ? rowToRule(rows[0]) : null;
  }

  /**
   * Rules ordered for categorization priority resolution: user rules before
   * default rules, then by priority descending (PROJECT_SPEC.md §3.3).
   * @param {{enabledOnly?: boolean}} [options]
   * @returns {Promise<import('../domain/rule.js').Rule[]>}
   */
  async findAllOrderedByPriority({ enabledOnly = true } = {}) {
    const sql = enabledOnly
      ? `SELECT * FROM rules WHERE enabled = 1
         ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END, priority DESC;`
      : `SELECT * FROM rules
         ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END, priority DESC;`;
    const rows = await this.db.query(sql);
    return rows.map(rowToRule);
  }

  /**
   * All rules, both sources, for display (e.g. the rules management screen).
   * Unlike findAllOrderedByPriority(), this is not meant for categorization
   * resolution — just a stable listing order for a UI.
   * @returns {Promise<import('../domain/rule.js').Rule[]>}
   */
  async findAll() {
    const rows = await this.db.query(
      `SELECT * FROM rules ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END, priority DESC, created_at;`
    );
    return rows.map(rowToRule);
  }

  /**
   * Rules from a given source ('user' or 'default'). Used by default
   * categorization seeding (Phase 3) to check idempotently whether default
   * rules already exist before inserting them again.
   * @param {'user'|'default'} source
   * @returns {Promise<import('../domain/rule.js').Rule[]>}
   */
  async findBySource(source) {
    const rows = await this.db.query('SELECT * FROM rules WHERE source = ?;', [source]);
    return rows.map(rowToRule);
  }

  /**
   * Finds every rule (user or default) currently pointing at a category.
   * Used by category merge (Phase 5, PROJECT_SPEC.md §3.6) to know, and
   * warn about, what rules would be affected by merging that category away.
   * @param {string} categoryId
   * @returns {Promise<import('../domain/rule.js').Rule[]>}
   */
  async findByCategoryId(categoryId) {
    const rows = await this.db.query('SELECT * FROM rules WHERE category_id = ?;', [categoryId]);
    return rows.map(rowToRule);
  }

  /**
   * Bulk-reassigns every rule currently pointing at `fromCategoryId` to
   * `toCategoryId`. Used by category merge: without this, a rule left
   * pointing at a merged-away (deactivated) category would keep silently
   * categorizing future imports into a category nobody sees anymore. The
   * caller wraps this in `db.transaction()` alongside the transaction
   * reassignment so a merge is all-or-nothing (ARCHITECTURE.md §4.2).
   * @param {string} fromCategoryId
   * @param {string} toCategoryId
   * @returns {Promise<number>} number of rules reassigned
   */
  async reassignCategory(fromCategoryId, toCategoryId) {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE rules SET category_id = ?, updated_at = ? WHERE category_id = ?;`,
      [toCategoryId, now, fromCategoryId]
    );
    return result.rowsAffected;
  }

  /**
   * @param {import('../domain/rule.js').Rule} rule
   * @returns {Promise<void>}
   */
  async update(rule) {
    await this.db.execute(
      `UPDATE rules SET category_id = ?, match_type = ?, match_value = ?, priority = ?,
         enabled = ?, updated_at = ? WHERE id = ?;`,
      [
        rule.categoryId,
        rule.matchType,
        rule.matchValue,
        rule.priority,
        rule.enabled ? 1 : 0,
        rule.updatedAt,
        rule.id,
      ]
    );
  }

  /**
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.db.execute('DELETE FROM rules WHERE id = ?;', [id]);
  }
}

function rowToRule(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    matchType: row.match_type,
    matchValue: row.match_value,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    source: row.source,
    ruleVersion: row.rule_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

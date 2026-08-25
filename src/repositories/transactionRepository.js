/**
 * TransactionRepository — depends only on the Database port (db-port.js).
 */
export class TransactionRepository {
  /**
   * @param {import('../persistence/db-port.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {import('../domain/transaction.js').Transaction} transaction
   * @returns {Promise<void>}
   */
  async insert(transaction) {
    await this.db.execute(
      `INSERT INTO transactions
         (id, date, value_date, amount_minor_units, currency, description, raw_description,
          merchant, transaction_type, category_id, categorization_method,
          categorization_confidence, categorization_evidence, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        transaction.id,
        transaction.date,
        transaction.valueDate,
        transaction.amountMinorUnits,
        transaction.currency,
        transaction.description,
        transaction.rawDescription,
        transaction.merchant,
        transaction.transactionType,
        transaction.categoryId,
        transaction.categorizationMethod,
        transaction.categorizationConfidence,
        transaction.categorizationEvidence ? JSON.stringify(transaction.categorizationEvidence) : null,
        transaction.fingerprint,
        transaction.createdAt,
        transaction.updatedAt,
      ]
    );
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../domain/transaction.js').Transaction|null>}
   */
  async findById(id) {
    const rows = await this.db.query('SELECT * FROM transactions WHERE id = ?;', [id]);
    return rows.length > 0 ? rowToTransaction(rows[0]) : null;
  }

  /**
   * @param {string} fingerprint
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findByFingerprint(fingerprint) {
    const rows = await this.db.query('SELECT * FROM transactions WHERE fingerprint = ?;', [
      fingerprint,
    ]);
    return rows.map(rowToTransaction);
  }

  /**
   * Finds existing transactions sharing the same date and signed amount as a
   * candidate, regardless of fingerprint. Used for probable-duplicate
   * detection (PROJECT_SPEC.md §3.2): two transactions can be the same
   * underlying payment even if minor text differences (e.g. re-exported
   * description wording) produce a different fingerprint.
   *
   * @param {string} date
   * @param {number} amountMinorUnits
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findByDateAndAmount(date, amountMinorUnits) {
    const rows = await this.db.query(
      'SELECT * FROM transactions WHERE date = ? AND amount_minor_units = ?;',
      [date, amountMinorUnits]
    );
    return rows.map(rowToTransaction);
  }

  /**
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findAll() {
    const rows = await this.db.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC;');
    return rows.map(rowToTransaction);
  }

  /**
   * Finds past transactions manually categorized (categorization_method =
   * 'manual') at a given normalized merchant. Used by the historical
   * learning tier (PROJECT_SPEC.md §3.4) — learning is deliberately scoped
   * to manual corrections only, since that's the strongest, most trustworthy
   * signal of what the user actually wants, rather than learning from the
   * app's own prior guesses.
   *
   * @param {string} normalizedMerchant - already lowercased/trimmed by the caller
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findManualByNormalizedMerchant(normalizedMerchant) {
    const rows = await this.db.query(
      `SELECT * FROM transactions
       WHERE categorization_method = 'manual' AND lower(trim(merchant)) = ?
       ORDER BY updated_at DESC;`,
      [normalizedMerchant]
    );
    return rows.map(rowToTransaction);
  }

  /**
   * Finds every transaction currently assigned to a category. Used by
   * category merge/split (Phase 5, PROJECT_SPEC.md §3.6) to know what's
   * affected before/after a bulk reassignment.
   * @param {string} categoryId
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findByCategoryId(categoryId) {
    const rows = await this.db.query(
      'SELECT * FROM transactions WHERE category_id = ? ORDER BY date DESC, created_at DESC;',
      [categoryId]
    );
    return rows.map(rowToTransaction);
  }

  /**
   * Finds transactions in a category whose description, merchant, or raw
   * bank text contains a (case-insensitive) text filter. Used by the
   * category "split" workflow (Phase 5, PROJECT_SPEC.md §3.6): move a
   * matching subset of one category's transactions into another category,
   * without needing multi-select in the transaction table (Phase 4).
   * @param {string} categoryId
   * @param {string} textFilter - already trimmed by the caller; matched
   *   case-insensitively against description/merchant/raw_description
   * @returns {Promise<import('../domain/transaction.js').Transaction[]>}
   */
  async findByCategoryIdAndText(categoryId, textFilter) {
    const rows = await this.db.query(
      `SELECT * FROM transactions
       WHERE category_id = ?
         AND (
           lower(description) LIKE '%' || lower(?) || '%'
           OR lower(coalesce(merchant, '')) LIKE '%' || lower(?) || '%'
           OR lower(coalesce(raw_description, '')) LIKE '%' || lower(?) || '%'
         )
       ORDER BY date DESC, created_at DESC;`,
      [categoryId, textFilter, textFilter, textFilter]
    );
    return rows.map(rowToTransaction);
  }

  /**
   * Bulk-reassigns transactions in `fromCategoryId` whose description,
   * merchant, or raw bank text contains `textFilter` (case-insensitive) to
   * `toCategoryId`, in a single statement. This is the write counterpart to
   * findByCategoryIdAndText() — used by the category "split" workflow
   * (Phase 5, PROJECT_SPEC.md §3.6) so a split moves matching rows in one
   * round-trip rather than looping `update()` per transaction.
   * @param {string} fromCategoryId
   * @param {string} toCategoryId
   * @param {string} textFilter
   * @param {{evidence: object}} meta
   * @returns {Promise<number>} number of transactions reassigned
   */
  async reassignCategoryByText(fromCategoryId, toCategoryId, textFilter, { evidence }) {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE transactions
       SET category_id = ?, categorization_method = 'manual',
           categorization_confidence = 1, categorization_evidence = ?, updated_at = ?
       WHERE category_id = ?
         AND (
           lower(description) LIKE '%' || lower(?) || '%'
           OR lower(coalesce(merchant, '')) LIKE '%' || lower(?) || '%'
           OR lower(coalesce(raw_description, '')) LIKE '%' || lower(?) || '%'
         );`,
      [toCategoryId, JSON.stringify(evidence), now, fromCategoryId, textFilter, textFilter, textFilter]
    );
    return result.rowsAffected;
  }

  /**
   * Bulk-reassigns every transaction currently in `fromCategoryId` to
   * `toCategoryId`, in a single statement (one round-trip, and avoids the
   * "loop of individual updates" partial-failure risk for what can be
   * hundreds of rows). Used by category merge (Phase 5); the caller is
   * responsible for wrapping this in `db.transaction()` alongside any rule
   * reassignment so the whole merge is atomic (ARCHITECTURE.md §4.2).
   *
   * Sets categorization_method to 'manual' (with the given evidence) on
   * every reassigned row, on the same reasoning as manualCorrection.js: a
   * merge/split is a deliberate user decision about where these
   * transactions belong, not a suggestion, and reusing 'manual' is what
   * makes these transactions count as future learning signal
   * (categorization/learningEngine.js reads exactly this method).
   *
   * @param {string} fromCategoryId
   * @param {string} toCategoryId
   * @param {{evidence: object}} meta
   * @returns {Promise<number>} number of transactions reassigned
   */
  async reassignCategory(fromCategoryId, toCategoryId, { evidence }) {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE transactions
       SET category_id = ?, categorization_method = 'manual',
           categorization_confidence = 1, categorization_evidence = ?, updated_at = ?
       WHERE category_id = ?;`,
      [toCategoryId, JSON.stringify(evidence), now, fromCategoryId]
    );
    return result.rowsAffected;
  }

  /**
   * @param {import('../domain/transaction.js').Transaction} transaction
   * @returns {Promise<void>}
   */
  async update(transaction) {
    await this.db.execute(
      `UPDATE transactions SET category_id = ?, categorization_method = ?,
         categorization_confidence = ?, categorization_evidence = ?, updated_at = ? WHERE id = ?;`,
      [
        transaction.categoryId,
        transaction.categorizationMethod,
        transaction.categorizationConfidence,
        transaction.categorizationEvidence ? JSON.stringify(transaction.categorizationEvidence) : null,
        transaction.updatedAt,
        transaction.id,
      ]
    );
  }
}

function rowToTransaction(row) {
  return {
    id: row.id,
    date: row.date,
    valueDate: row.value_date,
    amountMinorUnits: row.amount_minor_units,
    currency: row.currency,
    description: row.description,
    rawDescription: row.raw_description,
    merchant: row.merchant,
    transactionType: row.transaction_type,
    categoryId: row.category_id,
    categorizationMethod: row.categorization_method,
    categorizationConfidence: row.categorization_confidence,
    categorizationEvidence: row.categorization_evidence ? JSON.parse(row.categorization_evidence) : null,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

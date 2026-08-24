/**
 * ui-utils.js — shared UI utilities (ARCHITECTURE.md §5: "formatting money
 * for display, date formatting, small DOM helpers live in a `ui-utils.js`
 * shared module"). Named there since Phase 1 but not created until now,
 * since Phase 4 (transaction table + filters) is the first feature that
 * needs shared date formatting and small DOM-building helpers across
 * multiple call sites, rather than one screen owning its own copy.
 *
 * Money formatting itself already lives in domain/money.js
 * (formatMinorUnits) — this module does not duplicate it, only re-uses it
 * where convenient, plus the things domain/money.js deliberately does not
 * own (date display, DOM element creation helpers).
 */

/**
 * Formats an ISO date (YYYY-MM-DD) for display. Kept intentionally simple —
 * just reformats to the locale's date style, no relative dates ("today",
 * "3 days ago") since that's not required by PROJECT_SPEC.md and would add
 * UX complexity not needed for the MVP (PROJECT_SPEC.md §2).
 *
 * @param {string|null} isoDate - YYYY-MM-DD, or null
 * @param {{locale?: string}} [options]
 * @returns {string}
 */
export function formatDate(isoDate, { locale = 'it-IT' } = {}) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/**
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {string} YYYY-MM, used as a stable key/value for month filtering
 */
export function toMonthKey(isoDate) {
  return isoDate.slice(0, 7);
}

/**
 * Formats a YYYY-MM key for display in a month picker, e.g. "March 2026".
 * @param {string} monthKey - YYYY-MM
 * @param {{locale?: string}} [options]
 * @returns {string}
 */
export function formatMonthKey(monthKey, { locale = 'it-IT' } = {}) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    date
  );
}

/**
 * Small helper to build a DOM element with attributes/children without
 * pulling in a templating library — kept deliberately tiny (ARCHITECTURE.md
 * §5: "no framework, DOM updates are done directly").
 *
 * @param {string} tag
 * @param {Object} [attrs] - attribute name/value pairs; `dataset` (object),
 *   `text` (textContent), and `on` (object of event listeners) are handled
 *   specially, everything else is set via setAttribute.
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else if (key === 'text') {
      element.textContent = value;
    } else if (key === 'on') {
      for (const [eventName, handler] of Object.entries(value)) {
        element.addEventListener(eventName, handler);
      }
    } else if (key === 'value') {
      element.value = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  for (const child of children) {
    element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

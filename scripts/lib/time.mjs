export function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * @param {string} iso
 * @returns {number}
 */
export function hoursSince(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (Date.now() - then) / 3_600_000);
}

/**
 * @param {number} hours
 * @returns {string}
 */
export function formatHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

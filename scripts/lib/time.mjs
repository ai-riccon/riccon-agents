export const TEAM_TIMEZONE = 'Asia/Shanghai';
export const TEAM_UTC_OFFSET_MINUTES = 8 * 60;

/**
 * 返回带北京时区偏移的 ISO 8601 时间（UTC+08:00）。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function nowIso(date = new Date()) {
  const shifted = new Date(date.getTime() + TEAM_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().replace('Z', '+08:00');
}

/**
 * 用于文件名的时间戳；与 nowIso 一样使用北京时间。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function timestampSlug(date = new Date()) {
  return nowIso(date).replace(/[:.]/g, '-');
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

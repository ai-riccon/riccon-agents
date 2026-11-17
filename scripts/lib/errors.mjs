export class RicconError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, details?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'RicconError';
    this.code = options.code || 'ERR_RICCON';
    this.details = options.details;
  }
}

/**
 * @param {string} message
 * @param {{ code?: string, details?: unknown }} [options]
 * @returns {never}
 */
export function fail(message, options) {
  throw new RicconError(message, options);
}

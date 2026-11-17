import YAML from 'yaml';

/**
 * @param {string} text
 * @returns {any}
 */
export function parseYaml(text) {
  return YAML.parse(text);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyYaml(value) {
  return YAML.stringify(value, { lineWidth: 0 }).trimEnd();
}

/**
 * @param {string} text
 * @returns {{ data: any, body: string, hasFrontmatter: boolean, raw: string | null }}
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized, hasFrontmatter: false, raw: null };
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) {
    return { data: {}, body: normalized, hasFrontmatter: false, raw: null };
  }
  const raw = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  return {
    data: parseYaml(raw) || {},
    body,
    hasFrontmatter: true,
    raw,
  };
}

/**
 * @param {unknown} data
 * @param {string} body
 * @returns {string}
 */
export function stringifyFrontmatter(data, body) {
  return `---\n${stringifyYaml(data)}\n---\n\n${body.replace(/^\n+/, '')}`;
}

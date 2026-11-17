import Ajv from 'ajv';
import { readJson } from './fsx.mjs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from './paths.mjs';
import { fail } from './errors.mjs';

/** @type {Map<string, import('ajv').ValidateFunction>} */
const cache = new Map();

/**
 * @param {string} schemaName
 * @returns {import('ajv').ValidateFunction}
 */
function getValidator(schemaName) {
  if (cache.has(schemaName)) return cache.get(schemaName);
  const file = join(SCHEMAS_DIR, schemaName);
  const schema = readJson(file);
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  const validator = ajv.compile(schema);
  cache.set(schemaName, validator);
  return validator;
}

/**
 * @param {import('ajv').ErrorObject} error
 * @returns {string}
 */
function formatError(error) {
  const path = error.instancePath || '/';
  const params = error.params ? ` ${JSON.stringify(error.params)}` : '';
  return `${path} ${error.message}${params}`;
}

/**
 * @param {string} schemaName
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(schemaName, data) {
  const validator = getValidator(schemaName);
  const valid = validator(data);
  return {
    valid: Boolean(valid),
    errors: (validator.errors || []).map(formatError),
  };
}

/**
 * @param {string} schemaName
 * @param {unknown} data
 * @param {string} [label]
 */
export function assertSchema(schemaName, data, label = 'data') {
  const result = validateSchema(schemaName, data);
  if (!result.valid) {
    fail(`${label} failed ${schemaName}: ${result.errors.join('; ')}`, {
      code: 'ERR_SCHEMA',
      details: result.errors,
    });
  }
}

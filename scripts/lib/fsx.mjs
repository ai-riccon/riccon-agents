import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * @param {string} file
 * @returns {string}
 */
export function readText(file) {
  return readFileSync(file, 'utf8');
}

/**
 * @param {string} file
 * @param {string} text
 */
export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

/**
 * @param {string} file
 * @returns {any}
 */
export function readJson(file) {
  return JSON.parse(readText(file));
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string} dir */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** @param {string} path */
export function exists(path) {
  return existsSync(path);
}

/** @param {string} path */
export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} path */
export function removePath(path) {
  rmSync(path, { recursive: true, force: true });
}

/**
 * @param {string} from
 * @param {string} to
 */
export function copyPath(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} [predicate]
 * @returns {string[]}
 */
export function listDir(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(predicate)
    .sort()
    .map((name) => join(dir, name));
}

/**
 * @param {string} dir
 * @param {(file: string) => boolean} [predicate]
 * @returns {string[]}
 */
export function listFilesRecursive(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function slugify(text, max = 48) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'evidence').slice(0, max);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function resolveFromCwd(value) {
  return resolve(process.cwd(), value);
}

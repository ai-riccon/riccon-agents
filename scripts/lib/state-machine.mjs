import { fail } from './errors.mjs';

export const TASK_TRANSITIONS = {
  planned: ['ready', 'blocked'],
  ready: ['in_progress', 'blocked'],
  in_progress: ['review', 'blocked'],
  review: ['done', 'in_progress', 'blocked'],
  blocked: ['planned', 'ready', 'in_progress'],
  done: [],
};

export const MODULE_TRANSITIONS = {
  planned: ['building', 'blocked'],
  building: ['verifying', 'blocked'],
  verifying: ['review_pending', 'blocked'],
  review_pending: ['done', 'building', 'blocked'],
  blocked: ['planned', 'building', 'verifying'],
  done: [],
};

/**
 * @param {string} kind
 * @param {string} from
 * @param {string} to
 */
export function assertTransition(kind, from, to) {
  const table = kind === 'task' ? TASK_TRANSITIONS : MODULE_TRANSITIONS;
  if (from === to) return;
  const allowed = table[from] || [];
  if (!allowed.includes(to)) {
    fail(`invalid ${kind} transition: ${from} -> ${to} (allowed: ${allowed.join(', ') || 'none'})`, {
      code: 'ERR_TRANSITION',
    });
  }
}

/**
 * @param {string} status
 * @returns {boolean}
 */
export function taskNeedsEvidence(status) {
  return status === 'review' || status === 'done';
}

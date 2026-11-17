import test from 'node:test';
import assert from 'node:assert/strict';
import { runJson } from './helpers.mjs';

test('doctor passes on the team repository', () => {
  const result = runJson(['doctor']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.errors.length, 0);

  const ids = result.json.checks.map((check) => check.id);
  for (const id of ['schemas', 'agents', 'commands', 'skills']) {
    assert.ok(ids.includes(id), `doctor should report ${id}`);
  }
});

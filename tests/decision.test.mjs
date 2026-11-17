import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanup,
  initProject,
  runJson,
  tempDir,
} from './helpers.mjs';

function newRelease(dir) {
  return runJson([
    'release',
    'new',
    '--version',
    '0.1.0',
    '--environment',
    'sandbox',
    '--scope',
    'Decision fixture',
    '--project',
    dir,
  ]);
}

test('decision new binds to a draft release and answer records semantics', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(newRelease(dir).code, 0);

  const created = runJson([
    'decision',
    'new',
    '--title',
    'Approve sandbox',
    '--question',
    'Approve REL-0001 for sandbox?',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(created.json.decision.decision_id, 'DEC-0001');
  assert.equal(created.json.decision.status, 'open');
  assert.equal(created.json.decision.release_id, 'REL-0001');
  assert.equal(created.json.decision.environment, 'sandbox');

  const rebound = runJson([
    'decision',
    'answer',
    'DEC-0001',
    '--answer',
    'yes',
    '--kind',
    'approve',
    '--release',
    'REL-9999',
    '--project',
    dir,
  ]);
  assert.equal(rebound.code, 1);
  assert.match(rebound.stdout, /is bound to REL-0001/);

  const empty = runJson([
    'decision',
    'answer',
    'DEC-0001',
    '--answer',
    '   ',
    '--kind',
    'approve',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(empty.code, 1);
  assert.match(empty.stdout, /non-empty/);

  const answered = runJson([
    'decision',
    'answer',
    'DEC-0001',
    '--answer',
    'yes',
    '--kind',
    'approve',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(answered.code, 0, answered.stderr);
  assert.equal(answered.json.decision.status, 'answered');
  assert.equal(answered.json.decision.answer_kind, 'approve');
  assert.equal(answered.json.decision.release_id, 'REL-0001');
  assert.equal(answered.json.decision.environment, 'sandbox');

  const replay = runJson([
    'decision',
    'answer',
    'DEC-0001',
    '--answer',
    'no',
    '--kind',
    'reject',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(replay.code, 1);
  assert.match(replay.stdout, /answers are immutable/);
});

test('decision new rejects mismatched or non-draft releases', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(newRelease(dir).code, 0);

  const mismatch = runJson([
    'decision',
    'new',
    '--title',
    'Wrong environment',
    '--question',
    'Proceed?',
    '--release',
    'REL-0001',
    '--environment',
    'production',
    '--project',
    dir,
  ]);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stdout, /does not match release/);

  const created = runJson([
    'decision',
    'new',
    '--title',
    'Approve',
    '--question',
    'Proceed?',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(
    runJson([
      'decision',
      'answer',
      'DEC-0001',
      '--answer',
      'yes',
      '--kind',
      'approve',
      '--release',
      'REL-0001',
      '--project',
      dir,
    ]).code,
    0,
  );
  assert.equal(
    runJson([
      'release',
      'approve',
      'REL-0001',
      '--decision',
      'DEC-0001',
      '--project',
      dir,
    ]).code,
    0,
  );

  const afterApproval = runJson([
    'decision',
    'new',
    '--title',
    'Replay',
    '--question',
    'Proceed again?',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(afterApproval.code, 1);
  assert.match(afterApproval.stdout, /only bind to draft releases/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addModuleAndTask,
  cleanup,
  initProject,
  readJson,
  run,
  runJson,
  tempDir,
  writeReview,
} from './helpers.mjs';

test('toy project: init → task → evidence → gate fail → gate pass → handoff', (t) => {
  const dir = tempDir('riccon-toy-');
  t.after(() => cleanup(dir));

  assert.equal(initProject(dir).code, 0);
  assert.equal(
    runJson(['contract', 'validate', '--project', dir]).json.ok,
    true,
  );
  assert.equal(runJson(['state', 'validate', '--project', dir]).json.ok, true);

  const { task } = addModuleAndTask(dir);
  for (const status of ['ready', 'in_progress']) {
    const result = run([
      'task',
      'update',
      task.id,
      '--status',
      status,
      '--project',
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }

  const evidence = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--agent',
    'riccon/builder',
    '--project',
    dir,
    '--',
    'node -e "console.log(\'toy ok\')"',
  ]);
  assert.equal(evidence.code, 0, evidence.stderr);
  assert.equal(evidence.json.evidence.exit_code, 0);

  const evidenceFile = join(dir, evidence.json.evidence.output_path);
  assert.equal(existsSync(evidenceFile), true);
  const digest = createHash('sha256')
    .update(readFileSync(evidenceFile, 'utf8'), 'utf8')
    .digest('hex');
  assert.equal(digest, evidence.json.evidence.output_sha256);

  for (const status of ['review', 'done']) {
    const result = run([
      'task',
      'update',
      task.id,
      '--status',
      status,
      '--project',
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }
  for (const status of ['building', 'verifying', 'review_pending']) {
    const result = run([
      'module',
      'update',
      'M01',
      '--status',
      status,
      '--project',
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }

  const fail = runJson(['gate', 'check', '--module', 'M01', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /no review found/);

  writeReview(dir);
  const pass = runJson(['gate', 'check', '--module', 'M01', '--project', dir]);
  assert.equal(pass.code, 0, pass.json.errors.join('; '));
  assert.equal(pass.json.ok, true);

  assert.equal(
    run([
      'module',
      'update',
      'M01',
      '--product-status',
      'pass',
      '--project',
      dir,
    ]).code,
    0,
  );
  const done = run([
    'module',
    'update',
    'M01',
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(
    run([
      'module',
      'update',
      'M01',
      '--user-status',
      'accepted',
      '--acceptance-decision',
      'DEC-0001',
      '--project',
      dir,
    ]).code,
    0,
  );

  const handoff = runJson([
    'handoff',
    'new',
    '--session',
    'toy-session',
    '--summary',
    'Toy project complete',
    '--next',
    'Review the M0 kernel',
    '--project',
    dir,
  ]);
  assert.equal(handoff.code, 0, handoff.stderr);
  assert.equal(handoff.json.handoff.handoff_id, 'HANDOFF-0001');

  const status = runJson(['status', '--project', dir]);
  assert.equal(status.code, 0);
  assert.equal(status.json.phase, 'release');
  assert.equal(status.json.current_module, null);
  assert.equal(status.json.gate.status, 'pass');
  assert.equal(status.json.tasks.done, 1);
  assert.equal(status.json.last_handoff, 'handoff-0001.md');

  const state = readJson(join(dir, '.riccon', 'state.json'));
  assert.equal(state.phase, 'release');
  assert.equal(state.gate.status, 'pass');

  const validate = runJson(['state', 'validate', '--project', dir]);
  assert.equal(validate.code, 0, validate.stdout + validate.stderr);
  assert.deepEqual(validate.json.errors, []);
});

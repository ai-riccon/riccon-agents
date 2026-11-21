import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  addModuleAndTask,
  cleanup,
  initProject,
  readJson,
  run,
  runJson,
  tempDir,
  writeJson,
} from './helpers.mjs';

test('handoff new writes a valid handoff and updates state', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const result = runJson([
    'handoff',
    'new',
    '--session',
    'session-1',
    '--summary',
    'M0 smoke',
    '--next',
    'Review the kernel',
    '--invariant',
    'No hardcoded stack',
    '--risk',
    'Permission patterns are not a boundary',
    '--first-read',
    '.riccon/state.json',
    '--project',
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.handoff.handoff_id, 'HANDOFF-0001');
  assert.equal(result.json.handoff.session, 'session-1');
  assert.equal(result.json.handoff.invariants.length, 1);
  assert.equal(existsSync(result.json.file), true);

  const state = readJson(join(dir, '.riccon', 'state.json'));
  assert.equal(state.last_handoff, 'handoff-0001.md');
  assert.equal(state.next_action, 'Review the kernel');

  const validate = runJson(['state', 'validate', '--project', dir]);
  assert.equal(validate.code, 0, validate.stdout + validate.stderr);
});

test('handoff refuses active tasks, missing first-read paths and placeholders', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', task.id, '--status', status, '--project', dir]).code,
      0,
    );
  }

  const active = runJson([
    'handoff',
    'new',
    '--next',
    'Continue the task',
    '--first-read',
    '.riccon/state.json',
    '--project',
    dir,
  ]);
  assert.equal(active.code, 1);
  assert.match(active.stdout, /active tasks/);

  assert.equal(
    run(['task', 'update', task.id, '--status', 'blocked', '--project', dir]).code,
    0,
  );
  const missing = runJson([
    'handoff',
    'new',
    '--next',
    'Continue',
    '--first-read',
    'missing.md',
    '--project',
    dir,
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /first_read path does not exist/);

  const placeholder = runJson([
    'handoff',
    'new',
    '--next',
    'TBD',
    '--project',
    dir,
  ]);
  assert.equal(placeholder.code, 1);
  assert.match(placeholder.stdout, /placeholder/);
});

test('handoff requires a gate for the current module and a fresh check', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  assert.equal(
    run(['module', 'update', 'M01', '--status', 'building', '--project', dir]).code,
    0,
  );

  const stateFile = join(dir, '.riccon', 'state.json');
  const state = readJson(stateFile);
  state.gate = {
    status: 'pass',
    module_id: 'M02',
    checked_at: new Date().toISOString(),
    reasons: [],
  };
  writeJson(stateFile, state);

  const wrongModule = runJson([
    'handoff',
    'new',
    '--next',
    'Continue',
    '--project',
    dir,
  ]);
  assert.equal(wrongModule.code, 1);
  assert.match(wrongModule.stdout, /gate is for M02, expected M01/);

  state.gate.module_id = 'M01';
  state.gate.checked_at = '2020-01-01T00:00:00.000Z';
  writeJson(stateFile, state);
  const stale = runJson([
    'handoff',
    'new',
    '--next',
    'Continue',
    '--project',
    dir,
  ]);
  assert.equal(stale.code, 1);
  assert.match(stale.stdout, /gate is stale/);
});

test('handoff gate freshness ignores planned tasks in other modules', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);

  const stateFile = join(dir, '.riccon', 'state.json');
  const state = readJson(stateFile);
  state.gate = {
    status: 'pass',
    module_id: 'M01',
    checked_at: new Date().toISOString(),
    reasons: [],
  };
  writeJson(stateFile, state);

  const nextModule = runJson([
    'module',
    'new',
    '--title',
    'Next',
    '--kind',
    'feature',
    '--project',
    dir,
  ]);
  assert.equal(nextModule.code, 0, nextModule.stderr);
  const nextTask = runJson([
    'task',
    'new',
    '--module',
    nextModule.json.module.id,
    '--title',
    'Later',
    '--owner',
    'riccon/builder-b2',
    '--write-scope',
    'src/**',
    '--acceptance',
    'Later works',
    '--project',
    dir,
  ]);
  assert.equal(nextTask.code, 0, nextTask.stderr);

  const fresh = runJson([
    'handoff',
    'new',
    '--next',
    'Continue',
    '--first-read',
    '.riccon/state.json',
    '--project',
    dir,
  ]);
  assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);

  assert.equal(
    run(['task', 'update', task.id, '--status', 'ready', '--project', dir]).code,
    0,
  );
  const stale = runJson([
    'handoff',
    'new',
    '--next',
    'Continue',
    '--first-read',
    '.riccon/state.json',
    '--project',
    dir,
  ]);
  assert.equal(stale.code, 1);
  assert.match(stale.stdout, /gate is stale/);
});

test('handoff ids increment and can be listed and shown', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  for (const summary of ['first', 'second']) {
    const result = runJson([
      'handoff',
      'new',
      '--summary',
      summary,
      '--project',
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }

  const list = runJson(['handoff', 'list', '--project', dir]);
  assert.equal(list.code, 0);
  assert.equal(list.json.handoffs.length, 2);
  assert.equal(list.json.handoffs[1].data.handoff_id, 'HANDOFF-0002');

  const show = runJson(['handoff', 'show', 'HANDOFF-0001', '--project', dir]);
  assert.equal(show.code, 0);
  assert.equal(show.json.handoff.summary, 'first');

  const state = readJson(join(dir, '.riccon', 'state.json'));
  assert.equal(state.last_handoff, 'handoff-0002.md');
});

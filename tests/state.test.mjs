import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  cleanup,
  initProject,
  readJson,
  run,
  runJson,
  tempDir,
  writeJson,
  writeTaskReview,
} from './helpers.mjs';

function addModuleAndTask(dir) {
  const module = run([
    'module',
    'new',
    '--title',
    'MVC',
    '--kind',
    'mvc',
    '--project',
    dir,
  ]);
  assert.equal(module.code, 0, module.stderr);
  const task = run([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Build the toy',
    '--owner',
    'riccon/builder',
    '--project',
    dir,
  ]);
  assert.equal(task.code, 0, task.stderr);
  const started = run([
    'module',
    'update',
    'M01',
    '--status',
    'building',
    '--project',
    dir,
  ]);
  assert.equal(started.code, 0, started.stderr);
}

test('a fresh project validates cleanly', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
  assert.deepEqual(result.json.errors, []);
});

test('modules and tasks validate', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
});

test('task reviews under reviews/tasks validate cleanly', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, { moduleId: 'M01', taskId: 'TASK-0001' });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
});

test('task reviews must reference an existing task', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, { moduleId: 'M01', taskId: 'TASK-9999' });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(' '), /unknown task TASK-9999/);
});

test('a top-level task review points to reviews/tasks', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    topLevel: true,
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(' '), /reviews\/tasks\//);
});

test('state validation catches done tasks in a planned module', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);

  const moduleFile = join(dir, '.riccon', 'modules', 'M01.json');
  const module = readJson(moduleFile);
  module.status = 'planned';
  writeJson(moduleFile, module);
  const taskFile = join(dir, '.riccon', 'tasks', 'TASK-0001.json');
  const task = readJson(taskFile);
  task.status = 'done';
  writeJson(taskFile, task);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0);
  assert.match(result.json.warnings.join(' '), /is planned but has started\/done tasks/);
});

test('state validation catches a dangling current_module', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const file = join(dir, '.riccon', 'state.json');
  const state = readJson(file);
  state.current_module = 'M99';
  writeJson(file, state);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(' '), /unknown module M99/);
});

test('state validation catches an invalid phase', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const file = join(dir, '.riccon', 'state.json');
  const state = readJson(file);
  state.phase = 'not-a-phase';
  writeJson(file, state);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
});

test('state validation catches an invalid module record', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);

  const source = readJson(join(dir, '.riccon', 'modules', 'M01.json'));
  writeJson(join(dir, '.riccon', 'modules', 'M99.json'), {
    ...source,
    id: 'M99',
    status: 'not-a-status',
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(' '), /module|status/i);
});

test('state validation checks active_tasks ownership and status', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code,
      0,
    );
  }
  const stateFile = join(dir, '.riccon', 'state.json');
  const state = readJson(stateFile);
  assert.equal(state.active_tasks['riccon/builder'], 'TASK-0001');
  assert.equal(runJson(['state', 'validate', '--project', dir]).code, 0);

  state.active_tasks['riccon/builder'] = 'TASK-9999';
  writeJson(stateFile, state);
  const fail = runJson(['state', 'validate', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /unknown task TASK-9999/);
});

test('state validation rejects in_progress task missing from active_tasks', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code,
      0,
    );
  }
  const stateFile = join(dir, '.riccon', 'state.json');
  const state = readJson(stateFile);
  delete state.active_tasks['riccon/builder'];
  writeJson(stateFile, state);

  const fail = runJson(['state', 'validate', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(
    fail.json.errors.join(' '),
    /TASK-0001 is in_progress but not tracked in state.active_tasks/,
  );
});

test('state validation catches a dangling evidence reference', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);

  const file = join(dir, '.riccon', 'tasks', 'TASK-0001.json');
  const task = readJson(file);
  task.evidence = ['EV-9999'];
  writeJson(file, task);

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(' '), /unknown evidence EV-9999/);
});

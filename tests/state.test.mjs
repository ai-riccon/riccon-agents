import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  cleanup,
  initProject,
  mutateContract,
  readJson,
  run,
  runJson,
  tempDir,
  writeJson,
  writeReview,
  writeTaskReview,
  writeText,
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
    '--write-scope',
    'src/**',
    '--acceptance',
    'Toy works',
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

test('new task review with an open P2 fails state validation', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    findings: [
      {
        id: 'F-001',
        severity: 'P2',
        status: 'open',
        title: 'still open',
      },
    ],
    createdAt: '2026-11-23T00:00:00+08:00',
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(
    result.json.errors.join(' '),
    /P2 finding F-001 is open; new pass reviews must fix it or mark it accepted/,
  );
});

test('legacy task review with an open P2 only warns', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    findings: [
      {
        id: 'F-001',
        severity: 'P2',
        status: 'open',
        title: 'legacy open',
      },
    ],
    createdAt: '2026-11-19T00:00:00+08:00',
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.json?.errors?.join('; '));
  assert.match(result.json.warnings.join(' '), /legacy review only warns/);
});

test('legacy task review with an open P1 only warns', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    findings: [
      {
        id: 'F-001',
        severity: 'P1',
        status: 'open',
        title: 'legacy blocking finding',
      },
    ],
    createdAt: '2026-11-19T00:00:00+08:00',
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.json?.errors?.join('; '));
  assert.match(
    result.json.warnings.join(' '),
    /P1 finding F-001 is open; P0\/P1 must be fixed before pass \(legacy review only warns\)/,
  );
});

test('new accepted findings require owner, due and reason', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    findings: [
      {
        id: 'F-001',
        severity: 'P2',
        status: 'accepted',
        title: 'accepted without metadata',
      },
    ],
    createdAt: '2026-11-23T00:00:00+08:00',
  });

  const fail = runJson(['state', 'validate', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /missing owner, due, accepted_reason/);

  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    findings: [
      {
        id: 'F-001',
        severity: 'P2',
        status: 'accepted',
        title: 'accepted with metadata',
        owner: 'riccon/builder',
        due: 'M02 gate',
        accepted_reason: 'bounded risk with follow-up',
      },
    ],
    createdAt: '2026-11-23T00:00:00+08:00',
  });

  const pass = runJson(['state', 'validate', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
});

test('new module review must list latest task reviews', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeTaskReview(dir, {
    moduleId: 'M01',
    taskId: 'TASK-0001',
    reviewId: 'REV-TASK-0001-001',
    createdAt: '2026-11-23T00:00:00+08:00',
  });
  writeReview(dir, {
    moduleId: 'M01',
    createdAt: '2026-11-23T00:00:00+08:00',
    reviewedTaskReviews: [],
  });

  const fail = runJson(['state', 'validate', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(
    fail.json.errors.join(' '),
    /does not list latest task review REV-TASK-0001-001/,
  );

  writeReview(dir, {
    moduleId: 'M01',
    createdAt: '2026-11-23T00:00:00+08:00',
    reviewedTaskReviews: ['REV-TASK-0001-001'],
  });
  const pass = runJson(['state', 'validate', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
});

test('missing previous_review only warns, archived review ids resolve', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  writeReview(dir, {
    moduleId: 'M01',
    previousReview: 'REV-MISSING-001',
    createdAt: '2026-11-23T00:00:00+08:00',
  });

  const warn = runJson(['state', 'validate', '--project', dir]);
  assert.equal(warn.code, 0, warn.json?.errors?.join('; '));
  assert.match(warn.json.warnings.join(' '), /REV-MISSING-001 is not found/);

  writeText(
    join(dir, '.riccon', 'archive', 'reviews', 'M01-review-old.md'),
    '---\nreview_id: REV-OLD-001\n---\n\nold review\n',
  );
  writeReview(dir, {
    moduleId: 'M01',
    previousReview: 'REV-OLD-001',
    createdAt: '2026-11-23T00:00:00+08:00',
  });
  const pass = runJson(['state', 'validate', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
  assert.doesNotMatch(pass.json.warnings.join(' '), /REV-OLD-001 is not found/);
});

test('contract roadmap status drift warns without failing state', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);
  mutateContract(dir, (contract) => {
    contract.product.module_roadmap = [
      { id: 'M01', title: 'MVC', goal: 'toy', status: 'planned' },
    ];
  });

  const result = runJson(['state', 'validate', '--project', dir]);
  assert.equal(result.code, 0, result.json?.errors?.join('; '));
  assert.match(
    result.json.warnings.join(' '),
    /contract roadmap M01 status is planned, but module is building/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanup,
  initProject,
  run,
  runJson,
  setModuleStatus,
  tempDir,
} from './helpers.mjs';

function addTask(dir) {
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  const task = runJson([
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
  return task.json.task;
}

function addEvidence(dir, taskId = 'TASK-0001') {
  return run([
    'evidence',
    'run',
    '--task',
    taskId,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'ok\')"',
  ]);
}

test('task new creates an id and a module link', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const task = addTask(dir);
  assert.equal(task.id, 'TASK-0001');
  assert.equal(task.module_id, 'M01');
  assert.equal(task.status, 'planned');
  assert.deepEqual(task.write_scope, ['src/**']);
});

test('task transitions are enforced', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);

  const skip = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(skip.code, 1);
  assert.match(skip.stderr, /invalid task transition/);

  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'ready', '--project', dir]).code,
    0,
  );
  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'in_progress', '--project', dir])
      .code,
    0,
  );

  const noEvidence = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'review',
    '--project',
    dir,
  ]);
  assert.equal(noEvidence.code, 1);
  assert.match(noEvidence.stderr, /without evidence/);
});

test('a task can reach done with evidence', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);

  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code,
      0,
    );
  }
  assert.equal(addEvidence(dir).code, 0);

  for (const status of ['review', 'done']) {
    const result = run([
      'task',
      'update',
      'TASK-0001',
      '--status',
      status,
      '--project',
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }

  const list = runJson(['task', 'list', '--project', dir]);
  assert.equal(list.code, 0);
  assert.equal(list.json.tasks[0].status, 'done');
  assert.equal(list.json.tasks[0].evidence.length, 1);
});

test('module dependencies gate the start of a module', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  assert.equal(
    run([
      'module',
      'new',
      '--title',
      'Feature',
      '--depends-on',
      'M01',
      '--project',
      dir,
    ]).code,
    0,
  );

  const locked = run([
    'module',
    'update',
    'M02',
    '--status',
    'building',
    '--project',
    dir,
  ]);
  assert.equal(locked.code, 1);
  assert.match(locked.stderr, /cannot start until dependency M01 is done/);

  setModuleStatus(dir, 'M01', 'done');
  assert.equal(
    run([
      'module',
      'update',
      'M01',
      '--product-status',
      'pass',
      '--user-status',
      'accepted',
      '--project',
      dir,
    ]).code,
    0,
  );
  const unlocked = run([
    'module',
    'update',
    'M02',
    '--status',
    'building',
    '--project',
    dir,
  ]);
  assert.equal(unlocked.code, 0, unlocked.stderr);
});

test('task cannot start before its module is building', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  const task = runJson([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Build the toy',
    '--project',
    dir,
  ]);
  assert.equal(task.code, 0, task.stderr);
  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'ready', '--project', dir]).code,
    0,
  );
  const blocked = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'in_progress',
    '--project',
    dir,
  ]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /expected building/);

  assert.equal(
    run(['module', 'update', 'M01', '--status', 'building', '--project', dir]).code,
    0,
  );
  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'in_progress', '--project', dir]).code,
    0,
  );
});

test('product acceptance blocks a feature but allows a linked fix', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  setModuleStatus(dir, 'M01', 'done');
  assert.equal(
    run([
      'module',
      'update',
      'M01',
      '--product-status',
      'changes-requested',
      '--user-status',
      'pending',
      '--project',
      dir,
    ]).code,
    0,
  );
  assert.equal(
    run([
      'module',
      'new',
      '--title',
      'Next feature',
      '--depends-on',
      'M01',
      '--project',
      dir,
    ]).code,
    0,
  );
  const blocked = run([
    'module',
    'update',
    'M02',
    '--status',
    'building',
    '--project',
    dir,
  ]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /acceptance is product=changes-requested/);
  assert.equal(
    run([
      'module',
      'update',
      'M02',
      '--status',
      'building',
      '--force',
      '--project',
      dir,
    ]).code,
    0,
  );

  assert.equal(
    run([
      'module',
      'new',
      '--title',
      'Fix M01 acceptance',
      '--kind',
      'fix',
      '--fixes',
      'M01',
      '--project',
      dir,
    ]).code,
    0,
  );
  const fix = runJson(['module', 'show', 'M03', '--project', dir, '--json']);
  assert.equal(fix.json.fixes_module, 'M01');
  assert.ok(fix.json.depends_on.includes('M01'));
  assert.equal(
    run([
      'module',
      'update',
      'M03',
      '--status',
      'building',
      '--project',
      dir,
    ]).code,
    0,
  );
  const status = runJson(['status', '--project', dir]);
  const open = status.json.acceptance_open.find((item) => item.id === 'M01');
  assert.ok(open);
  assert.equal(open.product_status, 'changes-requested');
  assert.ok(open.fixes.some((fix) => fix.id === 'M03'));
});

test('module review_pending requires all tasks done', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);

  assert.equal(
    run(['module', 'update', 'M01', '--status', 'building', '--project', dir]).code,
    0,
  );
  assert.equal(
    run(['module', 'update', 'M01', '--status', 'verifying', '--project', dir]).code,
    0,
  );

  const blocked = run([
    'module',
    'update',
    'M01',
    '--status',
    'review_pending',
    '--project',
    dir,
  ]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /tasks not done/);
});

test('one owner cannot have two in-progress tasks without force', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  const second = runJson([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Second task',
    '--owner',
    'riccon/builder',
    '--write-scope',
    'src/**',
    '--project',
    dir,
  ]);
  assert.equal(second.code, 0, second.stderr);

  for (const taskId of ['TASK-0001', 'TASK-0002']) {
    assert.equal(
      run(['task', 'update', taskId, '--status', 'ready', '--project', dir]).code,
      0,
    );
  }
  assert.equal(
    run([
      'task',
      'update',
      'TASK-0001',
      '--status',
      'in_progress',
      '--project',
      dir,
    ]).code,
    0,
  );
  const locked = run([
    'task',
    'update',
    'TASK-0002',
    '--status',
    'in_progress',
    '--project',
    dir,
  ]);
  assert.equal(locked.code, 1);
  assert.match(locked.stderr, /already has active task TASK-0001/);

  const forced = run([
    'task',
    'update',
    'TASK-0002',
    '--status',
    'in_progress',
    '--force',
    '--project',
    dir,
  ]);
  assert.equal(forced.code, 0, forced.stderr);
});

test('an active task cannot be reassigned to an occupied owner', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  const second = runJson([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Second task',
    '--owner',
    'riccon/verifier',
    '--write-scope',
    'src/**',
    '--project',
    dir,
  ]);
  assert.equal(second.code, 0, second.stderr);
  for (const taskId of ['TASK-0001', 'TASK-0002']) {
    assert.equal(
      run(['task', 'update', taskId, '--status', 'ready', '--project', dir]).code,
      0,
    );
    assert.equal(
      run([
        'task',
        'update',
        taskId,
        '--status',
        'in_progress',
        '--project',
        dir,
      ]).code,
      0,
    );
  }

  const reassign = run([
    'task',
    'update',
    'TASK-0002',
    '--owner',
    'riccon/builder',
    '--project',
    dir,
  ]);
  assert.equal(reassign.code, 1);
  assert.match(reassign.stderr, /already has active task TASK-0001/);

  const forced = run([
    'task',
    'update',
    'TASK-0002',
    '--owner',
    'riccon/builder',
    '--force',
    '--project',
    dir,
  ]);
  assert.equal(forced.code, 0, forced.stderr);
});

test('task review rejects changes outside write_scope', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');

  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'baseline');

  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code,
      0,
    );
  }
  assert.equal(addEvidence(dir).code, 0);

  writeFileSync(join(dir, 'docs', 'outside.md'), 'outside\n');
  const outside = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'review',
    '--project',
    dir,
  ]);
  assert.equal(outside.code, 1);
  assert.match(outside.stderr, /outside write_scope: docs\/outside\.md/);

  rmSync(join(dir, 'docs', 'outside.md'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'inside.js'), 'console.log("ok");\n');
  const inside = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'review',
    '--project',
    dir,
  ]);
  assert.equal(inside.code, 0, inside.stderr);

  assert.equal(
    run([
      'task',
      'update',
      'TASK-0001',
      '--status',
      'in_progress',
      '--project',
      dir,
    ]).code,
    0,
  );
  writeFileSync(join(dir, 'docs', 'outside-again.md'), 'outside again\n');
  const rework = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'review',
    '--project',
    dir,
  ]);
  assert.equal(rework.code, 1);
  assert.match(rework.stderr, /outside write_scope: docs\/outside-again\.md/);
});

test('task update --end-commit closes at an earlier task commit', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');
  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'baseline');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code, 0);
  }
  assert.equal(addEvidence(dir).code, 0);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'inside.js'), 'console.log("ok");\n');
  git('add', '-A');
  git('commit', '-qm', 'task work');
  const taskWork = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'docs', 'later.md'), 'later\n');
  git('add', '-A');
  git('commit', '-qm', 'later out of scope');

  const review = run([
    'task', 'update', 'TASK-0001', '--status', 'review', '--end-commit', taskWork, '--project', dir,
  ]);
  assert.equal(review.code, 0, review.stderr);
  const done = run([
    'task', 'update', 'TASK-0001', '--status', 'done', '--end-commit', taskWork, '--project', dir,
  ]);
  assert.equal(done.code, 0, done.stderr);
  const data = JSON.parse(readFileSync(join(dir, '.riccon', 'tasks', 'TASK-0001.json'), 'utf8'));
  assert.equal(data.end_commit, taskWork);
});

test('task update --baseline-commit re-baselines an active task', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');
  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'baseline');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code, 0);
  }
  writeFileSync(join(dir, 'docs', 'pre.md'), 'pre\n');
  git('add', '-A');
  git('commit', '-qm', 'pre task work');
  const rebased = git('rev-parse', 'HEAD');
  const update = run([
    'task', 'update', 'TASK-0001', '--baseline-commit', rebased, '--project', dir,
  ]);
  assert.equal(update.code, 0, update.stderr);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'inside.js'), 'console.log("ok");\n');
  git('add', '-A');
  git('commit', '-qm', 'task work');
  assert.equal(addEvidence(dir).code, 0);
  for (const status of ['review', 'done']) {
    assert.equal(run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code, 0);
  }
  const data = JSON.parse(readFileSync(join(dir, '.riccon', 'tasks', 'TASK-0001.json'), 'utf8'));
  assert.equal(data.baseline_commit, rebased);
});

test('task update rejects an end_commit before baseline', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');
  assert.equal(initProject(dir).code, 0);
  addTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'baseline');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', 'TASK-0001', '--status', status, '--project', dir]).code, 0);
  }
  assert.equal(addEvidence(dir).code, 0);
  const before = JSON.parse(readFileSync(join(dir, '.riccon', 'tasks', 'TASK-0001.json'), 'utf8')).baseline_commit;
  writeFileSync(join(dir, 'docs', 'pre.md'), 'pre\n');
  git('add', '-A');
  git('commit', '-qm', 'pre task work');
  const rebased = git('rev-parse', 'HEAD');
  assert.equal(run(['task', 'update', 'TASK-0001', '--baseline-commit', rebased, '--project', dir]).code, 0);
  const bad = run([
    'task', 'update', 'TASK-0001', '--status', 'review', '--end-commit', before, '--project', dir,
  ]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /not an ancestor of end/);
});

test('task list filters by module and status', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addTask(dir);

  const list = runJson([
    'task',
    'list',
    '--module',
    'M01',
    '--status',
    'planned',
    '--project',
    dir,
  ]);
  assert.equal(list.code, 0);
  assert.equal(list.json.tasks.length, 1);
});

test('task new warns when write scope or acceptance suggests splitting', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  const scopes = Array.from({ length: 9 }, (_, index) => [
    '--write-scope',
    `src/p${index}/**`,
  ]).flat();
  const task = runJson([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Too broad',
    '--project',
    dir,
    ...scopes,
  ]);
  assert.equal(task.code, 0, task.stderr);
  assert.equal(task.json.warnings.length, 1);
  assert.match(task.json.warnings[0], /write_scope has 9 entries/);
  assert.match(task.stderr, /split the task/);
});

test('task new warns at six acceptance items', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  const acceptance = Array.from({ length: 6 }, (_, index) => [
    '--acceptance',
    `AC ${index + 1}`,
  ]).flat();
  const task = runJson([
    'task',
    'new',
    '--module',
    'M01',
    '--title',
    'Too many outcomes',
    '--project',
    dir,
    ...acceptance,
  ]);
  assert.equal(task.code, 0, task.stderr);
  assert.equal(task.json.warnings.length, 1);
  assert.match(task.json.warnings[0], /independently verifiable outcomes/);
});

test('module split records relation and alias', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );
  assert.equal(
    run([
      'module',
      'new',
      '--title',
      'Second half',
      '--split-from',
      'M01',
      '--alias',
      'M01b',
      '--project',
      dir,
    ]).code,
    0,
  );
  const module = runJson(['module', 'show', 'M02', '--project', dir, '--json']);
  assert.equal(module.json.split_from, 'M01');
  assert.deepEqual(module.json.aliases, ['M01b']);
  assert.ok(module.json.depends_on.includes('M01'));
});

test('module cost records estimates and rejects zero as free', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  assert.equal(
    run(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]).code,
    0,
  );

  const zero = run([
    'module',
    'cost',
    'M01',
    '--confidence',
    'estimated',
    '--project',
    dir,
  ]);
  assert.equal(zero.code, 1);
  assert.match(zero.stderr, /all budget metrics are zero/);

  const unmeasured = runJson([
    'module',
    'cost',
    'M01',
    '--confidence',
    'unmeasured',
    '--project',
    dir,
  ]);
  assert.equal(unmeasured.code, 0, unmeasured.stderr);
  assert.equal(unmeasured.json.module.budget_usage.confidence, 'unmeasured');

  const contradictory = run([
    'module',
    'cost',
    'M01',
    '--requests',
    '3',
    '--confidence',
    'unmeasured',
    '--project',
    dir,
  ]);
  assert.equal(contradictory.code, 1);
  assert.match(contradictory.stderr, /unmeasured budget cannot include metrics/);

  const recorded = runJson([
    'module',
    'cost',
    'M01',
    '--requests',
    '12',
    '--input-tokens',
    '1000',
    '--output-tokens',
    '500',
    '--wall-clock-minutes',
    '30',
    '--cost-usd',
    '0.42',
    '--confidence',
    'estimated',
    '--source',
    'console',
    '--project',
    dir,
  ]);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal(recorded.json.module.budget_usage.requests, 12);
  assert.equal(recorded.json.module.budget_usage.tokens_input, 1000);
  assert.equal(recorded.json.module.budget_usage.cost_usd, 0.42);
  assert.equal(recorded.json.module.budget_usage.source, 'console');
});

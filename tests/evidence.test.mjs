import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyEvidenceRecord } from '../scripts/lib/evidence.mjs';
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

test('evidence run records a passing command', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);

  const result = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--agent',
    'riccon/builder',
    '--project',
    dir,
    '--',
    'node -e "console.log(\'ok\')"',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.evidence.id, 'EV-0001');
  assert.equal(result.json.evidence.exit_code, 0);
  assert.equal(result.json.evidence.agent, 'riccon/builder');
  assert.equal(result.json.evidence.output_sha256.length, 64);
  assert.equal(
    existsSync(join(dir, result.json.evidence.output_path)),
    true,
    'the evidence log should exist',
  );

  const record = readJson(
    join(dir, '.riccon', 'evidence', task.id, 'EV-0001.json'),
  );
  assert.equal(record.task_id, task.id);
  assert.equal(record.exit_code, 0);
});

test('evidence run records a failing command and preserves the exit code', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);

  const result = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "process.exit(3)"',
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.evidence.exit_code, 3);

  const list = runJson(['evidence', 'list', '--task', task.id, '--project', dir]);
  assert.equal(list.code, 0);
  assert.equal(list.json.evidence.length, 1);
  assert.equal(list.json.evidence[0].exit_code, 3);
});

test('evidence add copies an existing output file', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);

  const output = join(dir, 'manual.log');
  writeFileSync(output, 'manual evidence\n');

  const result = runJson([
    'evidence',
    'add',
    '--task',
    task.id,
    '--command',
    'manual check',
    '--output',
    output,
    '--exit-code',
    '0',
    '--project',
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.evidence.command, 'manual check');
  assert.equal(result.json.evidence.output_bytes > 0, true);
});

test('a task cannot be done with only failing evidence', (t) => {
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
  const failing = run([
    'evidence',
    'run',
    '--task',
    'TASK-0001',
    '--project',
    dir,
    '--',
    'node -e "process.exit(4)"',
  ]);
  assert.equal(failing.code, 1);
  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'review', '--project', dir]).code,
    0,
  );

  const done = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(done.code, 1);
  assert.match(done.stderr, /not passing/);

  assert.equal(
    run([
      'evidence',
      'run',
      '--task',
      'TASK-0001',
      '--project',
      dir,
      '--',
      'node -e "console.log(\'now passing\')"',
    ]).code,
    0,
  );
  assert.equal(
    run(['task', 'update', 'TASK-0001', '--status', 'done', '--project', dir]).code,
    0,
  );
});

test('manual evidence cannot establish done', (t) => {
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
  const output = join(dir, 'manual.log');
  writeFileSync(output, 'manual check\n');
  const manual = runJson([
    'evidence',
    'add',
    '--task',
    task.id,
    '--command',
    'manual check',
    '--output',
    output,
    '--exit-code',
    '0',
    '--project',
    dir,
  ]);
  assert.equal(manual.code, 0, manual.stderr);
  assert.equal(manual.json.evidence.manual, true);

  assert.equal(
    run(['task', 'update', task.id, '--status', 'review', '--project', dir]).code,
    0,
  );
  const done = run([
    'task',
    'update',
    task.id,
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(done.code, 1);
  assert.match(done.stderr, /manual evidence cannot establish done/);

  assert.equal(
    run([
      'evidence',
      'run',
      '--task',
      task.id,
      '--project',
      dir,
      '--',
      'node -e "console.log(\'real pass\')"',
    ]).code,
    0,
  );
  assert.equal(
    run(['task', 'update', task.id, '--status', 'done', '--project', dir]).code,
    0,
  );
});

test('a tampered evidence log cannot be used for done', (t) => {
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
  const passing = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'ok\')"',
  ]);
  assert.equal(passing.code, 0, passing.stderr);
  writeFileSync(join(dir, passing.json.evidence.output_path), 'tampered\n');

  assert.equal(
    run(['task', 'update', task.id, '--status', 'review', '--project', dir]).code,
    0,
  );
  const done = run([
    'task',
    'update',
    task.id,
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(done.code, 1);
  assert.match(done.stderr, /hash mismatch/);
});

test('no-op or failure-masking commands cannot establish done', (t) => {
  for (const command of ['true', 'false || true']) {
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
    const evidence = run([
      'evidence',
      'run',
      '--task',
      task.id,
      '--project',
      dir,
      '--',
      command,
    ]);
    assert.equal(evidence.code, 0, evidence.stderr);
    assert.equal(
      run(['task', 'update', task.id, '--status', 'review', '--project', dir]).code,
      0,
    );
    const done = run([
      'task',
      'update',
      task.id,
      '--status',
      'done',
      '--project',
      dir,
    ]);
    assert.equal(done.code, 1, command);
    assert.match(done.stderr, /no-op or masks failure/);
  }
});

test('a later failing run blocks done even if an earlier run passed', (t) => {
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
  assert.equal(
    run([
      'evidence',
      'run',
      '--task',
      task.id,
      '--project',
      dir,
      '--',
      'node -e "console.log(\'first pass\')"',
    ]).code,
    0,
  );
  assert.equal(
    run([
      'evidence',
      'run',
      '--task',
      task.id,
      '--project',
      dir,
      '--',
      'node -e "process.exit(5)"',
    ]).code,
    1,
  );
  assert.equal(
    run(['task', 'update', task.id, '--status', 'review', '--project', dir]).code,
    0,
  );
  const done = run([
    'task',
    'update',
    task.id,
    '--status',
    'done',
    '--project',
    dir,
  ]);
  assert.equal(done.code, 1);
  assert.match(done.stderr, /latest executed evidence/);
});

test('evidence records git commit and dirty state', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'README.md'), '# test\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');

  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'riccon state');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(
      run(['task', 'update', task.id, '--status', status, '--project', dir]).code,
      0,
    );
  }
  const clean = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'clean\')"',
  ]);
  assert.equal(clean.code, 0, clean.stderr);
  assert.match(clean.json.evidence.commit, /^[a-f0-9]{40}$/);
  assert.equal(clean.json.evidence.dirty, false);

  writeFileSync(join(dir, 'README.md'), '# dirty\n');
  const dirty = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'dirty\')"',
  ]);
  assert.equal(dirty.code, 0, dirty.stderr);
  assert.equal(dirty.json.evidence.dirty, true);

  const dirtyRecord = readJson(
    join(dir, '.riccon', 'evidence', task.id, `${dirty.json.evidence.id}.json`),
  );
  const strict = verifyEvidenceRecord(dir, dirtyRecord, {
    requireClean: true,
    requireAncestor: true,
  });
  assert.equal(strict.ok, false);
  assert.match(strict.errors.join(' '), /dirty working tree/);
});

test('strict evidence checks require commit and dirty attestation', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git('add', '-A');
  git('commit', '-qm', 'riccon state');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', task.id, '--status', status, '--project', dir]).code, 0);
  }
  const runResult = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'strict\')"',
  ]);
  assert.equal(runResult.code, 0, runResult.stderr);
  const record = readJson(
    join(dir, '.riccon', 'evidence', task.id, `${runResult.json.evidence.id}.json`),
  );

  const ok = verifyEvidenceRecord(dir, record, {
    requireCommit: true,
    requireAncestor: true,
  });
  assert.equal(ok.ok, true, ok.errors.join('; '));

  const missingCommit = { ...record, commit: null };
  const commitFail = verifyEvidenceRecord(dir, missingCommit, {
    requireCommit: true,
    requireAncestor: true,
  });
  assert.equal(commitFail.ok, false);
  assert.match(commitFail.errors.join(' '), /no git commit attestation/);

  const missingDirty = { ...record };
  delete missingDirty.dirty;
  const dirtyFail = verifyEvidenceRecord(dir, missingDirty, {
    requireCommit: true,
    requireAncestor: true,
  });
  assert.equal(dirtyFail.ok, false);
  assert.match(dirtyFail.errors.join(' '), /no dirty flag/);
});

test('evidence record command must match the log header', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  const record = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "console.log(\'ok\')"',
  ]);
  assert.equal(record.code, 0, record.stderr);
  const file = join(
    dir,
    '.riccon',
    'evidence',
    task.id,
    `${record.json.evidence.id}.json`,
  );
  const data = readJson(file);
  data.command = 'npm test';
  writeJson(file, data);
  const verify = verifyEvidenceRecord(dir, data);
  assert.equal(verify.ok, false);
  assert.match(verify.errors.join(' '), /command does not match its log header/);
});

test('evidence exit_code and headers must match the log', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  const record = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'node -e "process.exit(3)"',
  ]);
  assert.equal(record.code, 1);
  const data = record.json.evidence;
  const forged = { ...data, exit_code: 0 };
  const verify = verifyEvidenceRecord(dir, forged);
  assert.equal(verify.ok, false);
  assert.match(verify.errors.join(' '), /exit_code does not match its log header/);

  const logPath = join(dir, data.output_path);
  writeFileSync(logPath, readFileSync(logPath, 'utf8').replace(/^# command:.*\n/m, ''));
  const headerless = verifyEvidenceRecord(dir, data);
  assert.equal(headerless.ok, false);
  assert.match(headerless.errors.join(' '), /no # command header/);
});

test('a task cannot move to review without evidence', (t) => {
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
  const result = run([
    'task',
    'update',
    'TASK-0001',
    '--status',
    'review',
    '--project',
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /without evidence/);
});

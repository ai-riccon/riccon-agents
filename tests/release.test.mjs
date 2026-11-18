import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addModuleAndTask,
  answerHash,
  cleanup,
  initProject,
  run,
  runJson,
  tempDir,
  writeDecision,
  writeReview,
  writeText,
} from './helpers.mjs';
import { loadContract, writeContractBlock } from '../scripts/lib/contract.mjs';
import { checkRelease, releaseContentHash, reviewFindingChecks } from '../scripts/lib/release.mjs';

function completeModule(dir) {
  const { task } = addModuleAndTask(dir);
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', task.id, '--status', status, '--project', dir]).code, 0);
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
      'node -e "console.log(\'ok\')"',
    ]).code,
    0,
  );
  for (const status of ['review', 'done']) {
    assert.equal(run(['task', 'update', task.id, '--status', status, '--project', dir]).code, 0);
  }
  for (const status of ['building', 'verifying', 'review_pending']) {
    assert.equal(run(['module', 'update', 'M01', '--status', status, '--project', dir]).code, 0);
  }
  return task;
}

function finishModule(dir, taskId) {
  writeReview(dir);
  const acceptance = run([
    'module',
    'update',
    'M01',
    '--product-status',
    'pass',
    '--user-status',
    'accepted',
    '--acceptance-decision',
    'DEC-0001',
    '--acceptance-ref',
    'docs/ACCEPTANCE.md',
    '--project',
    dir,
  ]);
  assert.equal(acceptance.code, 0, acceptance.stderr);
  const result = run(['module', 'update', 'M01', '--status', 'done', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(taskId);
}

function writeRelease(dir, overrides = {}) {
  const data = {
    schema_version: 1,
    id: 'REL-0001',
    version: '0.1.0',
    environment: 'sandbox',
    scope: 'Sandbox release rehearsal',
    status: 'approved',
    risk_tier: 'T3',
    artifacts: {
      threat_model: '',
      load_test: '',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: 'docs/RUNBOOK.md',
    },
    approval: {
      by: 'user',
      decision_id: 'DEC-0001',
      release_id: 'REL-0001',
      environment: 'sandbox',
      answer_kind: 'approve',
      answer_sha256: answerHash('yes'),
      approved_at: '2026-11-16T00:00:00.000Z',
    },
    evidence: ['EV-0001'],
    created_at: '2026-11-16T00:00:00.000Z',
    updated_at: '2026-11-16T00:00:00.000Z',
    ...overrides,
  };
  writeText(
    join(dir, '.riccon', 'releases', 'REL-0001.md'),
    `---\n${JSON.stringify(data, null, 2)}\n---\n\n# REL-0001\n`,
  );
  return data;
}

function writeReleaseReview(dir, overrides = {}) {
  return writeReview(dir, {
    moduleId: 'RELEASE',
    reviewId: 'REV-RELEASE-001',
    dod: {
      build: true,
      tests: true,
      e2e: true,
      security: true,
      rollback: true,
      approval: true,
    },
    ...overrides,
  });
}

function writeSecondReview(dir, overrides = {}) {
  return writeReview(dir, {
    moduleId: 'RELEASE',
    reviewId: 'REV-RELEASE-SECOND-001',
    fileName: 'RELEASE-second-review.md',
    reviewKind: 'second',
    releaseId: 'REL-0001',
    version: '0.1.0',
    environment: 'production',
    reviewerAgent: 'riccon/verifier-recheck',
    reviewerModel: 'claude-haiku-5-5',
    reviewerSession: 'second-review-session',
    ...overrides,
  });
}

function prepareRelease(dir) {
  const task = completeModule(dir);
  finishModule(dir, task.id);
  writeDecision(dir, {
    status: 'answered',
    releaseId: 'REL-0001',
    environment: 'sandbox',
    answerKind: 'approve',
    createdAt: '2026-11-16T00:00:00.000Z',
    answeredAt: '2026-11-16T00:00:00.000Z',
  });
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback\n\nRestore the database.\n');
  writeText(join(dir, 'docs', 'RUNBOOK.md'), '# Runbook\n\nRun the app.\n');
  writeReleaseReview(dir);
  writeRelease(dir);
  return task;
}

function enableT4Sandbox(dir, taskId, { script } = {}) {
  writeText(
    join(dir, 'scripts', 'sandbox.sh'),
    script ||
      [
        '#!/usr/bin/env bash',
        '# docker run --rm --network none --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges',
        'echo "sandbox: image=test network=none project=ro uid=10001:10001"',
        'echo "sandbox: OK"',
        '',
      ].join('\n'),
  );
  const sandboxRun = runJson([
    'evidence',
    'run',
    '--task',
    taskId,
    '--project',
    dir,
    '--',
    'bash scripts/sandbox.sh',
  ]);
  assert.equal(sandboxRun.code, 0, sandboxRun.stderr);
  const sandboxEvidence = sandboxRun.json.evidence.id;

  const { contract } = loadContract(dir);
  contract.sandbox = {
    required: true,
    runtime: 'docker',
    network: 'none',
    mounts: ['project:ro', 'tmpfs:/tmp'],
    secrets: 'none',
    limits: { cpus: 2, memory: '2g', timeout_minutes: 30 },
    attestation_terms: ['network=none', 'project=ro', 'uid=10001:10001', 'sandbox: OK'],
    evidence: sandboxEvidence,
  };
  contract.commands.sandbox = 'bash scripts/sandbox.sh';
  writeContractBlock(join(dir, 'AGENTS.md'), contract);
  assert.equal(run(['contract', 'sync', '--project', dir]).code, 0);
  writeText(
    join(dir, 'docs', 'SANDBOX.md'),
    [
      '# Sandbox',
      '',
      '- 挂载：项目只读，tmpfs 临时目录。',
      '- 网络：none。',
      '- 密钥：none。',
      '- 清理：容器退出即删除。',
      '- 限制：CPU、内存和超时。',
      '',
    ].join('\n'),
  );
  return sandboxEvidence;
}

test('release gate fails without a release record, then passes with artifacts and approval', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);

  writeRelease(dir, { status: 'draft' });
  const draft = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(draft.code, 1);
  assert.match(draft.json.errors.join(' '), /status is draft/);

  writeRelease(dir);
  const pass = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
  assert.equal(pass.json.ok, true);
  assert.equal(pass.json.release_id, 'REL-0001');
  assert.equal(pass.json.review_path, '.riccon/reviews/RELEASE-review.md');
});

test('release gate requires a user-owned answered approval decision', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  writeDecision(dir, { status: 'open' });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /not answered/);
});

test('release approval environment must match the release environment', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  writeRelease(dir, {
    approval: {
      by: 'user',
      decision_id: 'DEC-0001',
      release_id: 'REL-0001',
      environment: 'production',
      answer_kind: 'approve',
      answer_sha256: answerHash('yes'),
      approved_at: '2026-11-16T00:00:00.000Z',
    },
  });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /approval environment production/);
});

test('T4 release requires threat model and load test artifacts', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const task = prepareRelease(dir);
  const sandboxEvidence = enableT4Sandbox(dir, task.id);
  writeReleaseReview(dir, {
    reviewedEvidence: ['EV-0001', sandboxEvidence],
  });
  writeRelease(dir, {
    risk_tier: 'T4',
    evidence: ['EV-0001', sandboxEvidence],
    artifacts: {
      threat_model: '',
      load_test: '',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: 'docs/RUNBOOK.md',
    },
  });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /threat_model is missing/);
  assert.match(fail.json.errors.join(' '), /load_test is missing/);

  writeText(join(dir, 'docs', 'THREAT-MODEL.md'), '# Threats\n');
  writeText(join(dir, 'docs', 'LOAD-TEST.md'), '# Load\n');
  writeRelease(dir, {
    risk_tier: 'T4',
    evidence: ['EV-0001', sandboxEvidence],
    artifacts: {
      threat_model: 'docs/THREAT-MODEL.md',
      load_test: 'docs/LOAD-TEST.md',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: 'docs/RUNBOOK.md',
    },
  });

  const pass = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
});

test('release new + approve records the user decision', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const task = completeModule(dir);
  finishModule(dir, task.id);

  const created = runJson([
    'release',
    'new',
    '--version',
    '0.1.0',
    '--environment',
    'sandbox',
    '--scope',
    'Rehearsal',
    '--rollback-drill',
    'docs/ROLLBACK.md',
    '--runbook',
    'docs/RUNBOOK.md',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(created.json.release.status, 'draft');

  const decision = runJson([
    'decision',
    'new',
    '--title',
    'Approve sandbox release',
    '--question',
    'Approve REL-0001 for sandbox?',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(decision.code, 0, decision.stderr);
  assert.equal(decision.json.decision.release_id, 'REL-0001');
  assert.equal(decision.json.decision.environment, 'sandbox');

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
  assert.equal(answered.json.decision.answer_kind, 'approve');

  const approved = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--project',
    dir,
  ]);
  assert.equal(approved.code, 0, approved.stderr);
  assert.equal(approved.json.release.status, 'approved');
  assert.equal(approved.json.release.approval.by, 'user');
  assert.equal(approved.json.release.approval.release_id, 'REL-0001');
  assert.equal(approved.json.release.approval.answer_kind, 'approve');
  assert.equal(
    approved.json.release.approval.answer_sha256,
    answerHash('yes'),
  );
});

test('release check rejects a decision answer changed after approval', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);

  writeDecision(dir, {
    status: 'answered',
    releaseId: 'REL-0001',
    environment: 'sandbox',
    answerKind: 'approve',
    answer: 'no',
    createdAt: '2026-11-16T00:00:00.000Z',
    answeredAt: '2026-11-16T00:00:00.000Z',
  });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /answer_sha256/);
});

test('release check rejects content changed after approval', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const task = completeModule(dir);
  finishModule(dir, task.id);
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback\n');
  writeText(join(dir, 'docs', 'RUNBOOK.md'), '# Runbook\n');
  writeReleaseReview(dir);

  const created = runJson([
    'release',
    'new',
    '--version',
    '0.1.0',
    '--environment',
    'sandbox',
    '--scope',
    'Rehearsal',
    '--rollback-drill',
    'docs/ROLLBACK.md',
    '--runbook',
    'docs/RUNBOOK.md',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(
    runJson([
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
    ]).code,
    0,
  );
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
  const approved = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--project',
    dir,
  ]);
  assert.equal(approved.code, 0, approved.stderr);
  assert.equal(typeof approved.json.release.approval.release_sha256, 'string');

  const file = join(dir, '.riccon', 'releases', 'REL-0001.md');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('scope: Rehearsal', 'scope: Changed after approval'),
  );
  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /release content changed after approval/);
});

test('release content hash includes artifact bytes', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback v1\n');
  const release = {
    id: 'REL-0001',
    version: '0.1.0',
    environment: 'sandbox',
    scope: 'test',
    risk_tier: 'T3',
    artifacts: {
      threat_model: '',
      load_test: '',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: '',
    },
    evidence: ['EV-0001'],
  };
  const before = releaseContentHash(release, dir);
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback v2\n');
  const after = releaseContentHash(release, dir);
  assert.notEqual(before, after);
});

test('release content hash covers evidence record and log bytes', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const task = prepareRelease(dir);
  const release = {
    id: 'REL-0001',
    version: '0.1.0',
    environment: 'sandbox',
    scope: 'Sandbox release rehearsal',
    risk_tier: 'T3',
    artifacts: {
      threat_model: '',
      load_test: '',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: 'docs/RUNBOOK.md',
    },
    evidence: ['EV-0001'],
  };
  const before = releaseContentHash(release, dir);
  const evidenceDir = join(dir, '.riccon', 'evidence', task.id);
  const logName = readdirSync(evidenceDir).find((name) => name.endsWith('.log'));
  assert.ok(logName, 'expected an evidence log fixture');
  writeFileSync(join(evidenceDir, logName), 'tampered output\n', { flag: 'a' });
  const afterLog = releaseContentHash(release, dir);
  assert.notEqual(before, afterLog);

  const recordFile = join(evidenceDir, 'EV-0001.json');
  const record = JSON.parse(readFileSync(recordFile, 'utf8'));
  record.note = 'tampered note';
  writeFileSync(recordFile, JSON.stringify(record, null, 2));
  const afterRecord = releaseContentHash(release, dir);
  assert.notEqual(afterLog, afterRecord);
});

test('release content hash covers release review bytes', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  const release = {
    id: 'REL-0001',
    version: '0.1.0',
    environment: 'sandbox',
    scope: 'Sandbox release rehearsal',
    risk_tier: 'T3',
    artifacts: {
      threat_model: '',
      load_test: '',
      rollback_drill: 'docs/ROLLBACK.md',
      runbook: 'docs/RUNBOOK.md',
    },
    evidence: ['EV-0001'],
  };
  const before = releaseContentHash(release, dir);
  const reviewFile = join(dir, '.riccon', 'reviews', 'RELEASE-review.md');
  writeFileSync(reviewFile, `${readFileSync(reviewFile, 'utf8')}\nTampered after approval.\n`);
  const after = releaseContentHash(release, dir);
  assert.notEqual(before, after);
});

test('release check binds the release review to release/version/environment', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  writeReleaseReview(dir, { releaseId: 'REL-9999' });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /bound to REL-9999/);
});

test('release check requires the release review to cover release evidence', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  writeReleaseReview(dir, { reviewedEvidence: [] });

  const fail = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(
    fail.json.errors.join(' '),
    /release review does not list reviewed_evidence/,
  );
});

test('release approve rejects non-affirmative and replayed decisions', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const task = completeModule(dir);
  finishModule(dir, task.id);
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback\n');
  writeText(join(dir, 'docs', 'RUNBOOK.md'), '# Runbook\n');
  writeReleaseReview(dir);

  const created = runJson([
    'release',
    'new',
    '--version',
    '0.1.0',
    '--environment',
    'sandbox',
    '--scope',
    'Rehearsal',
    '--rollback-drill',
    'docs/ROLLBACK.md',
    '--runbook',
    'docs/RUNBOOK.md',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);

  writeDecision(dir, {
    status: 'answered',
    releaseId: 'REL-0001',
    environment: 'sandbox',
    answerKind: 'reject',
    answer: 'no',
  });
  const nonAffirmative = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--project',
    dir,
  ]);
  assert.equal(nonAffirmative.code, 1);
  assert.match(
    `${nonAffirmative.stdout}${nonAffirmative.stderr}`,
    /expected approve/,
  );

  const decision = runJson([
    'decision',
    'new',
    '--title',
    'Approve release',
    '--question',
    'Proceed?',
    '--release',
    'REL-0001',
    '--project',
    dir,
  ]);
  assert.equal(decision.code, 0, decision.stderr);
  const answered = runJson([
    'decision',
    'answer',
    'DEC-0002',
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

  const approved = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0002',
    '--project',
    dir,
  ]);
  assert.equal(approved.code, 0, approved.stderr);

  const replay = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0002',
    '--project',
    dir,
  ]);
  assert.equal(replay.code, 1);
  assert.match(
    `${replay.stdout}${replay.stderr}`,
    /only draft releases can be approved/,
  );
});

test('T4 production approval requires a bound second review file', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const task = completeModule(dir);
  finishModule(dir, task.id);
  const sandboxEvidence = enableT4Sandbox(dir, task.id);
  writeText(join(dir, 'docs', 'THREAT-MODEL.md'), '# Threats\n');
  writeText(join(dir, 'docs', 'LOAD-TEST.md'), '# Load\n');
  writeText(join(dir, 'docs', 'ROLLBACK.md'), '# Rollback\n');
  writeText(join(dir, 'docs', 'RUNBOOK.md'), '# Runbook\n');
  writeReleaseReview(dir, {
    releaseId: 'REL-0001',
    version: '0.1.0',
    environment: 'production',
  });

  const created = runJson([
    'release',
    'new',
    '--version',
    '0.1.0',
    '--environment',
    'production',
    '--scope',
    'Production rehearsal',
    '--threat-model',
    'docs/THREAT-MODEL.md',
    '--load-test',
    'docs/LOAD-TEST.md',
    '--rollback-drill',
    'docs/ROLLBACK.md',
    '--runbook',
    'docs/RUNBOOK.md',
    '--evidence',
    'EV-0001',
    '--evidence',
    sandboxEvidence,
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);

  assert.equal(
    runJson([
      'decision',
      'new',
      '--title',
      'Approve production',
      '--question',
      'Proceed?',
      '--release',
      'REL-0001',
      '--project',
      dir,
    ]).code,
    0,
  );
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

  const missing = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--second-review-model',
    'claude-haiku-5-5',
    '--project',
    dir,
  ]);
  assert.equal(missing.code, 1);
  assert.match(`${missing.stdout}${missing.stderr}`, /second-review-path/);

  const reuse = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--second-review-model',
    'claude-haiku-5-5',
    '--second-review-path',
    '.riccon/reviews/RELEASE-review.md',
    '--project',
    dir,
  ]);
  assert.equal(reuse.code, 1);
  assert.match(`${reuse.stdout}${reuse.stderr}`, /review_kind: second/);

  writeSecondReview(dir);
  const approved = runJson([
    'release',
    'approve',
    'REL-0001',
    '--decision',
    'DEC-0001',
    '--second-review-model',
    'claude-haiku-5-5',
    '--second-review-path',
    '.riccon/reviews/RELEASE-second-review.md',
    '--project',
    dir,
  ]);
  assert.equal(
    approved.code,
    0,
    `${approved.stdout}\n${approved.stderr}\n${approved.json?.error || ''}`,
  );
  assert.equal(
    approved.json.release.approval.second_review.review_id,
    'REV-RELEASE-SECOND-001',
  );

  const check = checkRelease(dir, { requireScope: false });
  assert.equal(
    check.ok,
    true,
    check.errors.join('; '),
  );
  assert.match(check.checks.map((item) => item.message).join(' '), /second review/);
});

test('second review findings block release on open P0/P1', () => {
  const checks = reviewFindingChecks(
    [
      { id: 'F-001', severity: 'P1', title: 'open p1', status: 'open' },
      { id: 'F-002', severity: 'P1', title: 'fixed p1', status: 'fixed' },
      { id: 'F-003', severity: 'P0', title: 'accepted p0', status: 'accepted' },
      { id: 'F-004', severity: 'P2', title: 'open p2', status: 'open' },
    ],
    'release_second_review_finding',
  );
  const fails = checks.filter((check) => check.status === 'fail');
  const warns = checks.filter((check) => check.status === 'warn');
  assert.equal(fails.length, 2);
  assert.equal(warns.length, 1);
  assert.ok(fails.some((check) => check.id.endsWith(':F-001')));
  assert.ok(fails.some((check) => check.id.endsWith(':F-003')));
  assert.ok(warns.some((check) => check.id.endsWith(':F-004')));
});

test('release check defaults to strict scope and --legacy-scope allows sandbox fixtures', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);

  const strictDefault = runJson(['release', 'check', '--project', dir]);
  assert.equal(strictDefault.code, 1);
  assert.match(
    `${strictDefault.stdout}\n${strictDefault.stderr}\n${strictDefault.json?.errors?.join(' ') || ''}`,
    /module M01 gate failed/,
  );

  const legacy = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(legacy.code, 0, legacy.json?.errors?.join('; '));
  assert.ok(
    legacy.json.warnings.some((warning) => /legacy sandbox release/.test(warning)),
  );
});

test('release check rejects --legacy-scope for non-sandbox releases', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareRelease(dir);
  writeRelease(dir, { environment: 'production' });

  const check = runJson(['release', 'check', '--legacy-scope', '--project', dir]);
  assert.equal(check.code, 1);
  assert.match(
    `${check.stdout}\n${check.stderr}\n${check.json?.errors?.join(' ') || ''}`,
    /--legacy-scope is only allowed for sandbox/,
  );
});

test('sandbox check rejects an echo-only script without isolation flags on T4', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const task = prepareRelease(dir);
  enableT4Sandbox(dir, task.id, {
    script: [
      '#!/usr/bin/env bash',
      'echo "sandbox: image=test network=none project=ro uid=10001:10001"',
      'echo "sandbox: OK"',
      '',
    ].join('\n'),
  });

  const check = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(check.code, 1);
  assert.match(
    check.json.errors.join(' '),
    /sandbox script .* is missing (container run|--network none|--read-only|--cap-drop ALL|--user)/,
  );
});

test('sandbox check requires declaration, docs and a passing EV on T4', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const { task } = addModuleAndTask(dir);
  const sandboxEvidence = enableT4Sandbox(dir, task.id);

  rmSync(join(dir, 'docs', 'SANDBOX.md'));
  const missingDoc = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(missingDoc.code, 1);
  assert.match(missingDoc.json.errors.join(' '), /docs\/SANDBOX\.md/);

  writeText(
    join(dir, 'docs', 'SANDBOX.md'),
    [
      '# Sandbox',
      '',
      '- 挂载：项目只读。',
      '- 网络：none。',
      '- 密钥：none。',
      '- 清理：容器退出即删除。',
      '- 限制：CPU、内存和超时。',
      '',
    ].join('\n'),
  );

  const pass = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join('; '));
  assert.equal(pass.json.ok, true);
  assert.equal(sandboxEvidence.startsWith('EV-'), true);
});

test('sandbox check rejects a no-op command without attestation terms', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const { task } = addModuleAndTask(dir);
  enableT4Sandbox(dir, task.id);

  writeText(join(dir, 'scripts', 'sandbox.sh'), '#!/usr/bin/env bash\nexit 0\n');
  const runResult = runJson([
    'evidence',
    'run',
    '--task',
    task.id,
    '--project',
    dir,
    '--',
    'bash scripts/sandbox.sh',
  ]);
  assert.equal(runResult.code, 0, runResult.stderr);

  const { contract } = loadContract(dir);
  contract.sandbox.evidence = runResult.json.evidence.id;
  writeContractBlock(join(dir, 'AGENTS.md'), contract);
  assert.equal(run(['contract', 'sync', '--project', dir]).code, 0);

  const fail = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /misses attestation terms/);
});

test('sandbox check rejects empty allowlist and unsafe mounts on T4', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const { task } = addModuleAndTask(dir);
  enableT4Sandbox(dir, task.id);

  const { contract } = loadContract(dir);
  contract.sandbox.network = 'allowlist';
  contract.sandbox.allowlist = [];
  contract.sandbox.mounts = ['host-root:rw'];
  writeContractBlock(join(dir, 'AGENTS.md'), contract);
  assert.equal(run(['contract', 'sync', '--project', dir]).code, 0);

  const fail = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /allowlist is empty/);
  assert.match(fail.json.errors.join(' '), /unsafe: host-root:rw/);
});

test('sandbox check rejects an open network policy on T4', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir, ['--risk-tier', 'T4']).code, 0);
  const { task } = addModuleAndTask(dir);
  enableT4Sandbox(dir, task.id);

  const { contract } = loadContract(dir);
  contract.sandbox.network = 'open';
  writeContractBlock(join(dir, 'AGENTS.md'), contract);
  assert.equal(run(['contract', 'sync', '--project', dir]).code, 0);

  const fail = runJson(['sandbox', 'check', '--project', dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(' '), /network policy must be none or allowlist/);
});

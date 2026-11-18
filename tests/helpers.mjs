import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { loadContract, writeContractBlock } from '../scripts/lib/contract.mjs';

export const CLI = join(import.meta.dirname, '..', 'scripts', 'riccon.mjs');
export const INSTALL = join(import.meta.dirname, '..', 'scripts', 'install.mjs');

export function tempDir(prefix = 'riccon-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function run(args, { cwd, env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function runJson(args, options) {
  const separator = args.indexOf('--');
  const finalArgs =
    separator === -1
      ? [...args, '--json']
      : [...args.slice(0, separator), '--json', ...args.slice(separator)];
  const result = run(finalArgs, options);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // 留空；断言会显示原始输出。
  }
  return { ...result, json };
}

export function runInstall(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [INSTALL, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function initProject(dir, extra = []) {
  const binding = extra.some((item) =>
    String(item).startsWith('--evidence-binding'),
  )
    ? []
    : ['--evidence-binding', 'legacy'];
  return run(
    [
      'init',
      '--name',
      'toy',
      '--type',
      'web-app',
      '--risk-tier',
      'T3',
      '--project',
      dir,
      ...binding,
      ...extra,
    ],
    { cwd: dir },
  );
}

/**
 * 修改测试项目的合同并同步哈希；用于 strict binding/命令占位等场景。
 *
 * @param {string} dir
 * @param {(contract: any) => void} mutate
 * @returns {any}
 */
export function mutateContract(dir, mutate) {
  const { contract } = loadContract(dir);
  mutate(contract);
  writeContractBlock(join(dir, 'AGENTS.md'), contract);
  const synced = run(['contract', 'sync', '--project', dir]);
  if (synced.code !== 0) {
    throw new Error(synced.stderr || synced.stdout);
  }
  return contract;
}

export function addModuleAndTask(
  dir,
  { moduleTitle = 'MVC', taskTitle = 'Build the toy' } = {},
) {
  const module = runJson([
    'module',
    'new',
    '--title',
    moduleTitle,
    '--kind',
    'mvc',
    '--project',
    dir,
  ]);
  if (module.code !== 0) throw new Error(module.stderr || module.stdout);
  const task = runJson([
    'task',
    'new',
    '--module',
    module.json.module.id,
    '--title',
    taskTitle,
    '--owner',
    'riccon/builder',
    '--write-scope',
    'src/**',
    '--acceptance',
    'Toy works',
    '--project',
    dir,
  ]);
  if (task.code !== 0) throw new Error(task.stderr || task.stdout);
  const started = run([
    'module',
    'update',
    module.json.module.id,
    '--status',
    'building',
    '--project',
    dir,
  ]);
  if (started.code !== 0) throw new Error(started.stderr || started.stdout);
  return { module: module.json.module, task: task.json.task };
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function writeReview(
  dir,
  {
    moduleId = 'M01',
    dataModuleId = moduleId,
    verdict = 'pass',
    dod = {},
    dodEvidence,
    findings = [],
    reviewId = `REV-${moduleId}-001`,
    reviewedEvidence,
    createdAt,
    reviewerAgent = 'riccon/verifier',
    reviewerModel = 'test-model',
    reviewerSession = 'test-session',
    independent = true,
    releaseId,
    version,
    environment,
    fileName = `${moduleId}-review.md`,
    reviewKind,
  } = {},
) {
  const evidence = reviewedEvidence || evidenceIds(dir);
  const data = {
    review_id: reviewId,
    module_id: dataModuleId,
    ...(reviewKind ? { review_kind: reviewKind } : {}),
    ...(dataModuleId === 'RELEASE'
      ? {
          release_id: releaseId || 'REL-0001',
          version: version || '0.1.0',
          environment: environment || 'sandbox',
        }
      : {}),
    verifier: 'riccon/verifier',
    reviewer: {
      agent: reviewerAgent,
      session: reviewerSession,
      model: reviewerModel,
      independent,
    },
    verdict,
    dod: {
      acceptance: true,
      build: true,
      tests: true,
      coverage: true,
      e2e: true,
      review: true,
      docs: true,
      evidence: true,
      ...dod,
    },
    ...(dodEvidence ? { dod_evidence: dodEvidence } : {}),
    findings,
    evidence,
    reviewed_evidence: evidence,
    created_at: createdAt || new Date().toISOString(),
  };
  const file = join(dir, '.riccon', 'reviews', fileName);
  writeText(file, `---\n${YAML.stringify(data)}---\n\n# ${reviewId}\n\nReview fixture.\n`);
  return file;
}

export function writeTaskReview(
  dir,
  {
    moduleId = 'M01',
    taskId = 'TASK-0001',
    verdict = 'pass',
    findings = [],
    evidence = [],
    reviewedCommits = [],
    headCommit = '',
    reviewId = `REV-${taskId}`,
    reviewerAgent = 'riccon/verifier',
    reviewerModel = 'test-model',
    reviewerSession = 'test-session',
    independent = true,
    createdAt,
    fileName = `${taskId}-review.md`,
    topLevel = false,
  } = {},
) {
  const data = {
    review_id: reviewId,
    module_id: moduleId,
    task_id: taskId,
    reviewer: {
      agent: reviewerAgent,
      session: reviewerSession,
      model: reviewerModel,
      independent,
    },
    verdict,
    reviewed_commits: reviewedCommits,
    head_commit: headCommit,
    findings,
    evidence,
    created_at: createdAt || new Date().toISOString(),
  };
  const reviewDir = topLevel
    ? join(dir, '.riccon', 'reviews')
    : join(dir, '.riccon', 'reviews', 'tasks');
  const file = join(reviewDir, fileName);
  writeText(
    file,
    `---\n${YAML.stringify(data)}---\n\n# ${reviewId}\n\nTask review fixture.\n`,
  );
  return file;
}

export function writeDecision(
  dir,
  {
    decisionId = 'DEC-0001',
    moduleId = null,
    blocking = true,
    status = 'open',
    releaseId = null,
    environment = null,
    answerKind = 'choose',
    answer = 'yes',
    createdAt = '2026-11-15T00:00:00.000Z',
    answeredAt = '2026-11-15T00:00:00.000Z',
  } = {},
) {
  const data = {
    decision_id: decisionId,
    title: 'Fixture decision',
    status,
    owner: 'user',
    module_id: moduleId,
    blocking,
    question: 'Proceed?',
    options: ['yes', 'no'],
    recommendation: 'yes',
    consequences: 'Fixture.',
    deadline: null,
    default: 'yes',
    answer: status === 'answered' ? answer : null,
    answer_kind: status === 'answered' ? answerKind : null,
    release_id: releaseId,
    environment,
    created_at: createdAt,
    answered_at: status === 'answered' ? answeredAt : null,
  };
  const file = join(dir, '.riccon', 'decisions', `${decisionId}.md`);
  writeText(file, `---\n${YAML.stringify(data)}---\n\n# ${decisionId}\n`);
  return file;
}

export function evidenceIds(dir) {
  const directory = join(dir, '.riccon', 'evidence');
  if (!existsSync(directory)) return [];
  const ids = [];
  for (const taskDir of readdirSync(directory)) {
    const taskPath = join(directory, taskDir);
    if (!statSync(taskPath).isDirectory()) continue;
    for (const file of readdirSync(taskPath)) {
      const match = file.match(/^(EV-[0-9]+)\.json$/);
      if (match) ids.push(match[1]);
    }
  }
  return ids.sort();
}

export function answerHash(answer) {
  return createHash('sha256').update(answer).digest('hex');
}

export function setModuleStatus(dir, moduleId, status) {
  const file = join(dir, '.riccon', 'modules', `${moduleId}.json`);
  const module = readJson(file);
  module.status = status;
  module.updated_at = new Date().toISOString();
  writeJson(file, module);
}

export function setModuleStartedHoursAgo(dir, moduleId, hours) {
  const file = join(dir, '.riccon', 'modules', `${moduleId}.json`);
  const module = readJson(file);
  module.started_at = new Date(Date.now() - hours * 3_600_000).toISOString();
  module.updated_at = new Date().toISOString();
  writeJson(file, module);
}

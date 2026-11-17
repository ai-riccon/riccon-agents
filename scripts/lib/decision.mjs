import { join } from 'node:path';
import { writeText } from './fsx.mjs';
import { stringifyFrontmatter } from './yamlx.mjs';
import { assertSchema } from './schema.mjs';
import { nowIso } from './time.mjs';
import { fail } from './errors.mjs';
import {
  loadProject,
  nextId,
  readDecisions,
  readReleases,
} from './project.mjs';

const ANSWER_KINDS = ['approve', 'reject', 'choose', 'defer'];
const ENVIRONMENTS = ['sandbox', 'staging', 'production'];

/**
 * @param {string} projectDir
 * @param {string} releaseId
 * @returns {any}
 */
function getReleaseOrFail(projectDir, releaseId) {
  const record = readReleases(projectDir).find(
    (item) => item.data?.id === releaseId,
  );
  if (!record || !record.data) {
    fail(`release ${releaseId} not found`, { code: 'ERR_RELEASE_NOT_FOUND' });
  }
  if (record.error) {
    fail(`release ${releaseId} is invalid: ${record.error}`, {
      code: 'ERR_RELEASE_INVALID',
    });
  }
  return record.data;
}

/**
 * @param {string} projectDir
 * @param {{
 *   title: string,
 *   question: string,
 *   moduleId?: string | null,
 *   blocking?: boolean,
 *   options?: string[],
 *   recommendation?: string,
 *   consequences?: string,
 *   deadline?: string | null,
 *   defaultAnswer?: string,
 *   releaseId?: string | null,
 *   environment?: string | null
 * }} input
 * @returns {{ file: string, data: any }}
 */
export function createDecision(projectDir, input) {
  const { paths } = loadProject(projectDir);
  const existing = readDecisions(projectDir);
  const decisionId = nextId(
    'DEC',
    existing.map((record) => record.data?.decision_id).filter(Boolean),
  );

  let releaseId = input.releaseId || null;
  let environment = input.environment || null;
  if (releaseId) {
    const release = getReleaseOrFail(projectDir, releaseId);
    if (release.status !== 'draft') {
      fail(
        `release ${releaseId} is ${release.status}; decisions can only bind to draft releases`,
        { code: 'ERR_RELEASE_STATE' },
      );
    }
    if (environment && environment !== release.environment) {
      fail(
        `decision environment ${environment} does not match release ${releaseId} environment ${release.environment}`,
        { code: 'ERR_DECISION_ENVIRONMENT' },
      );
    }
    environment = release.environment;
  }
  if (environment && !ENVIRONMENTS.includes(environment)) {
    fail('decision environment must be sandbox, staging or production', {
      code: 'ERR_DECISION_ENVIRONMENT',
    });
  }

  const createdAt = nowIso();
  const data = {
    decision_id: decisionId,
    title: input.title,
    status: 'open',
    owner: 'user',
    module_id: input.moduleId || null,
    blocking: input.blocking === true,
    question: input.question,
    options: input.options || [],
    recommendation: input.recommendation || '',
    consequences: input.consequences || '',
    deadline: input.deadline || null,
    default: input.defaultAnswer || '',
    answer: null,
    answer_kind: null,
    release_id: releaseId,
    environment,
    created_at: createdAt,
    answered_at: null,
  };
  assertSchema('decision.schema.json', data, `decision ${decisionId}`);

  const body = [
    `# ${decisionId}：${data.title}`,
    '',
    '## 问题',
    '',
    data.question,
    '',
    '## 选项',
    '',
    ...(data.options.length ? data.options.map((item) => `- ${item}`) : ['- （未列出）']),
    '',
    '## 建议',
    '',
    data.recommendation || '（无）',
    '',
    '## 后果',
    '',
    data.consequences || '（未填写）',
    '',
    '## 默认',
    '',
    data.default || '（无）',
    '',
    '## 回答',
    '',
    '尚未回答。用户运行 `riccon decision answer` 后写入结构化回答。',
    '',
  ].join('\n');

  const file = join(paths.decisions, `${decisionId}.md`);
  writeText(file, stringifyFrontmatter(data, body));
  return { file, data };
}

/**
 * @param {string} projectDir
 * @param {string} decisionId
 * @param {{
 *   answer: string,
 *   kind: string,
 *   releaseId?: string | null,
 *   environment?: string | null
 * }} input
 * @returns {{ file: string, data: any }}
 */
export function answerDecision(projectDir, decisionId, input) {
  const record = readDecisions(projectDir).find(
    (item) => item.data?.decision_id === decisionId,
  );
  if (!record || !record.data) {
    fail(`decision ${decisionId} not found`, { code: 'ERR_DECISION_NOT_FOUND' });
  }
  if (record.error) {
    fail(`decision ${decisionId} is invalid: ${record.error}`, {
      code: 'ERR_DECISION_INVALID',
    });
  }
  if (record.data.status !== 'open') {
    fail(
      `decision ${decisionId} is ${record.data.status}; answers are immutable`,
      { code: 'ERR_DECISION_STATE' },
    );
  }

  const answer = String(input.answer || '').trim();
  if (!answer) {
    fail('decision answer must be non-empty', { code: 'ERR_DECISION_ANSWER' });
  }
  const kind = String(input.kind || '').trim();
  if (!ANSWER_KINDS.includes(kind)) {
    fail(`decision answer kind must be one of: ${ANSWER_KINDS.join(', ')}`, {
      code: 'ERR_DECISION_KIND',
    });
  }

  if (
    record.data.release_id &&
    input.releaseId &&
    input.releaseId !== record.data.release_id
  ) {
    fail(
      `decision ${decisionId} is bound to ${record.data.release_id}, not ${input.releaseId}`,
      { code: 'ERR_DECISION_RELEASE' },
    );
  }
  if (
    record.data.environment &&
    input.environment &&
    input.environment !== record.data.environment
  ) {
    fail(
      `decision ${decisionId} is bound to ${record.data.environment}, not ${input.environment}`,
      { code: 'ERR_DECISION_ENVIRONMENT' },
    );
  }

  let releaseId = input.releaseId || record.data.release_id || null;
  let environment = input.environment || record.data.environment || null;

  if (kind === 'approve') {
    if (!releaseId) {
      fail('approve decisions must bind to a release with --release', {
        code: 'ERR_DECISION_RELEASE',
      });
    }
    const release = getReleaseOrFail(projectDir, releaseId);
    if (release.status !== 'draft') {
      fail(
        `release ${releaseId} is ${release.status}; only draft releases can be approved`,
        { code: 'ERR_RELEASE_STATE' },
      );
    }
    if (environment && environment !== release.environment) {
      fail(
        `decision environment ${environment} does not match release ${releaseId} environment ${release.environment}`,
        { code: 'ERR_DECISION_ENVIRONMENT' },
      );
    }
    environment = release.environment;
  } else if (releaseId) {
    const release = getReleaseOrFail(projectDir, releaseId);
    if (environment && environment !== release.environment) {
      fail(
        `decision environment ${environment} does not match release ${releaseId} environment ${release.environment}`,
        { code: 'ERR_DECISION_ENVIRONMENT' },
      );
    }
    environment = release.environment;
  }

  if (environment && !ENVIRONMENTS.includes(environment)) {
    fail('decision environment must be sandbox, staging or production', {
      code: 'ERR_DECISION_ENVIRONMENT',
    });
  }

  const answeredAt = nowIso();
  const data = {
    ...record.data,
    status: 'answered',
    answer,
    answer_kind: kind,
    release_id: releaseId,
    environment,
    answered_at: answeredAt,
  };
  assertSchema('decision.schema.json', data, `decision ${decisionId}`);

  const marker = '## 回答';
  const baseBody = record.body.includes(marker)
    ? record.body.slice(0, record.body.indexOf(marker)).trimEnd()
    : record.body.trimEnd();
  const body = [
    baseBody,
    '',
    marker,
    '',
    `- 回答人：user`,
    `- 时间：${answeredAt}`,
    `- 类型：${kind}`,
    `- Release：${releaseId || '（无）'}`,
    `- 环境：${environment || '（无）'}`,
    '',
    answer,
    '',
  ].join('\n');

  writeText(record.file, stringifyFrontmatter(data, body));
  return { file: record.file, data };
}

/**
 * @param {string} projectDir
 * @returns {{ file: string, data: any, error: string | null }[]}
 */
export function listDecisions(projectDir) {
  return readDecisions(projectDir).map((record) => ({
    file: record.file,
    data: record.data,
    error: record.error,
  }));
}

/**
 * @param {string} projectDir
 * @param {string} decisionId
 * @returns {{ file: string, data: any }}
 */
export function showDecision(projectDir, decisionId) {
  const record = readDecisions(projectDir).find(
    (item) => item.data?.decision_id === decisionId,
  );
  if (!record || !record.data) {
    fail(`decision ${decisionId} not found`, { code: 'ERR_DECISION_NOT_FOUND' });
  }
  return { file: record.file, data: record.data };
}

import { join } from 'node:path';
import { exists, writeText } from './fsx.mjs';
import { stringifyFrontmatter } from './yamlx.mjs';
import { assertSchema } from './schema.mjs';
import { nowIso } from './time.mjs';
import { fail } from './errors.mjs';
import { isAcceptanceOpen } from './acceptance.mjs';
import {
  loadProject,
  nextId,
  projectPaths,
  readHandoffs,
  readModules,
  readReviews,
  readTasks,
  saveState,
} from './project.mjs';

/**
 * @param {{
 *   projectDir: string,
 *   session?: string,
 *   summary?: string,
 *   next?: string,
 *   invariants?: string[],
 *   risks?: string[],
 *   firstRead?: string[]
 * }} input
 * @returns {{ file: string, data: any }}
 */
export function createHandoff(input) {
  const { state, paths } = loadProject(input.projectDir);
  const existing = readHandoffs(input.projectDir);
  const existingIds = existing
    .map((record) => record.data?.handoff_id)
    .filter(Boolean);
  const handoffId = nextId('HANDOFF', existingIds, 4);
  const suffix = handoffId.replace('HANDOFF-', '');
  const createdAt = nowIso();
  const errors = [];

  const tasks = readTasks(input.projectDir);
  const modules = readModules(input.projectDir);
  const activeTasks = tasks.filter((task) =>
    ['in_progress', 'review'].includes(task.status),
  );
  if (activeTasks.length) {
    errors.push(
      `handoff requires no active tasks; ${activeTasks
        .map((task) => `${task.id}=${task.status}`)
        .join(', ')}`,
    );
  }
  const doneWithoutEvidence = tasks.filter(
    (task) => task.status === 'done' && !(task.evidence || []).length,
  );
  if (doneWithoutEvidence.length) {
    errors.push(
      `done task(s) without evidence: ${doneWithoutEvidence
        .map((task) => task.id)
        .join(', ')}`,
    );
  }

  if (
    ['modules', 'release', 'operate'].includes(state.phase) &&
    state.gate?.status !== 'pass'
  ) {
    errors.push(
      `handoff in phase ${state.phase} requires a passing module gate, got ${state.gate?.status || 'none'}`,
    );
  } else if (state.gate?.status === 'pass') {
    const current = modules.find((module) => module.id === state.current_module);
    const lastDone = modules
      .filter((module) => module.status === 'done')
      .sort(
        (a, b) =>
          Date.parse(a.finished_at || '') - Date.parse(b.finished_at || ''),
      )
      .at(-1)?.id;
    const expectedModule =
      current && current.status !== 'planned' ? current.id : lastDone;
    if (expectedModule && state.gate.module_id !== expectedModule) {
      errors.push(
        `handoff gate is for ${state.gate.module_id || '(none)'}, expected ${expectedModule}`,
      );
    }
    const gateTime = Date.parse(state.gate.checked_at || '');
    const latestTaskTime = Math.max(
      0,
      ...tasks.map((task) => Date.parse(task.updated_at || '')),
    );
    const reviews = readReviews(input.projectDir);
    const latestReviewTime = Math.max(
      0,
      ...reviews
        .filter((review) => review.data?.module_id === expectedModule)
        .map((review) => Date.parse(review.data?.created_at || '')),
    );
    if (
      Number.isNaN(gateTime) ||
      gateTime < latestTaskTime ||
      gateTime < latestReviewTime
    ) {
      errors.push(
        `handoff gate is stale: checked_at ${state.gate.checked_at || '(none)'} predates task/review state`,
      );
    }
  }
  if (
    state.release_gate?.status === 'fail' ||
    (state.phase === 'operate' && state.release_gate?.status !== 'pass')
  ) {
    errors.push(
      `handoff requires a passing release gate, got ${state.release_gate?.status || 'none'}`,
    );
  }

  const next = String(input.next || state.next_action || '').trim();
  if (!next) {
    errors.push('handoff requires a non-empty next action');
  } else if (/^(none|tbd|todo|n\/a)$/i.test(next)) {
    errors.push(`handoff next action is a placeholder: ${next}`);
  }

  const defaultFirstRead = [
    '.riccon/state.json',
    'AGENTS.md#project-contract',
    ...(exists(join(input.projectDir, 'docs', 'COLLABORATION.md'))
      ? ['docs/COLLABORATION.md']
      : []),
    `.riccon/handoffs/handoff-${suffix}.md`,
  ];
  const requestedFirstRead = (input.firstRead || []).filter(
    (item) => String(item).trim().length > 0,
  );
  const firstRead = requestedFirstRead.length
    ? requestedFirstRead
    : defaultFirstRead;
  const selfHandoffPath = `.riccon/handoffs/handoff-${suffix}.md`;
  for (const item of firstRead) {
    const path = String(item).split('#')[0];
    if (path === selfHandoffPath) continue;
    if (!exists(join(input.projectDir, path))) {
      errors.push(`first_read path does not exist: ${item}`);
    }
  }

  if (errors.length) {
    fail(`handoff preconditions failed: ${errors.join('; ')}`, {
      code: 'ERR_HANDOFF_PRECONDITION',
      details: errors,
    });
  }

  const openAcceptance = modules
    .filter((module) => module.status !== 'planned' && isAcceptanceOpen(module))
    .map((module) => ({
      id: module.id,
      product_status: module.product_acceptance.product_status,
      user_status: module.product_acceptance.user_status,
      fixes: modules
        .filter((item) => item.fixes_module === module.id)
        .map((item) => ({ id: item.id, status: item.status })),
    }));
  const data = {
    handoff_id: handoffId,
    session: input.session || null,
    summary: input.summary || `Handoff at phase ${state.phase}.`,
    next,
    invariants: input.invariants || [],
    risks: input.risks || [],
    first_read: firstRead,
    quality_gate: {
      status: 'pass',
      gate_status: state.gate?.status || 'none',
      gate_module_id: state.gate?.module_id || null,
      gate_checked_at: state.gate?.checked_at || null,
      release_gate_status: state.release_gate?.status || 'none',
      product_acceptance_open: openAcceptance,
      active_tasks: 0,
      checked_at: createdAt,
    },
    created_at: createdAt,
  };
  assertSchema('handoff.schema.json', data, `handoff ${handoffId}`);

  const body = [
    `# ${handoffId}`,
    '',
    '## Summary',
    '',
    data.summary,
    '',
    '## Next',
    '',
    data.next,
    '',
    '## Invariants',
    '',
    ...(data.invariants.length ? data.invariants.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## Risks',
    '',
    ...(data.risks.length ? data.risks.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## 上下文',
    '',
    '- 触发原因：模块 gate / phase 切换 / 上下文预算 / 会话结束。',
    `- 质量门槛：已检查 gate=${data.quality_gate.gate_status}、release_gate=${data.quality_gate.release_gate_status}、active tasks=0、done task 证据完整、first_read 路径存在。`,
    '- 未验证项：本 handoff 不替代 gate、review 或用户批准；新会话必须重新读取状态和证据。',
    `- 产品验收：${
      openAcceptance.length
        ? openAcceptance
            .map(
              (item) =>
                `${item.id} product=${item.product_status} user=${item.user_status}${
                  item.fixes.length
                    ? ` (fix ${item.fixes.map((fix) => `${fix.id} ${fix.status}`).join(', ')})`
                    : ''
                }`,
            )
            .join('; ')
        : '无未完成项'
    }`,
    '- 新会话：运行 `/riccon-resume`，从 `.riccon/` 和本文件恢复；不要重读旧聊天。',
    '',
    '## First read',
    '',
    ...data.first_read.map((item, index) => `${index + 1}. \`${item}\``),
    '',
  ].join('\n');

  const fileName = `handoff-${suffix}.md`;
  const file = join(paths.handoffs, fileName);
  writeText(file, stringifyFrontmatter(data, body));

  state.last_handoff = fileName;
  state.next_action = data.next;
  state.updated_at = nowIso();
  saveState(input.projectDir, state);

  return { file, data };
}

/**
 * @param {string} projectDir
 * @returns {any[]}
 */
export function listHandoffs(projectDir) {
  return readHandoffs(projectDir).map((record) => ({
    file: record.file,
    data: record.data,
    error: record.error,
  }));
}

/**
 * @param {string} projectDir
 * @returns {{ file: string, data: any } | null}
 */
export function latestHandoff(projectDir) {
  const records = readHandoffs(projectDir)
    .filter((record) => record.data)
    .sort((a, b) => String(a.data.handoff_id).localeCompare(String(b.data.handoff_id)));
  const latest = records[records.length - 1];
  return latest ? { file: latest.file, data: latest.data } : null;
}

/**
 * @param {string} projectDir
 * @param {string} handoffId
 * @returns {{ file: string, data: any }}
 */
export function showHandoff(projectDir, handoffId) {
  const record = readHandoffs(projectDir).find(
    (item) => item.data?.handoff_id === handoffId,
  );
  if (!record || !record.data) {
    fail(`handoff ${handoffId} not found`, { code: 'ERR_HANDOFF_NOT_FOUND' });
  }
  return { file: record.file, data: record.data };
}

/**
 * @param {string} projectDir
 * @returns {boolean}
 */
export function hasHandoffDir(projectDir) {
  return exists(projectPaths(projectDir).handoffs);
}

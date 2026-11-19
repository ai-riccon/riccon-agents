import { join, relative, resolve } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { hoursSince, formatHours, nowIso } from './time.mjs';
import {
  loadProject,
  readDecisions,
  readEvidence,
  readModules,
  readReviews,
  readTasks,
  projectPaths,
  saveState,
} from './project.mjs';
import { evidenceBinding, loadContract, moduleDod } from './contract.mjs';
import { parseFrontmatter } from './yamlx.mjs';
import { validateSchema } from './schema.mjs';
import {
  gitSnapshot,
  latestRun,
  runRecords,
  verifyEvidenceRecord,
} from './evidence.mjs';
import { unclaimedScopeErrors, writeScopeErrors } from './scope.mjs';
import { isMaskingShellCommand } from './shell.mjs';

/** DoD 项到合同命令字段的映射；acceptance/docs 没有唯一命令。 */
const DOD_COMMANDS = {
  build: 'build',
  tests: 'test',
  e2e: 'test_e2e',
  coverage: 'coverage',
};

/** builder 实例 owner 的前缀；用于识别实现角色，防止实例 owner 绕过独立性检查。 */
function isBuilderRole(agent) {
  return agent === 'riccon/builder' || String(agent || '').startsWith('riccon/builder-');
}

/** 真实 OpenCode 会话 ID；旧 review 的合成标签只产生 warning。 */
function isRealSessionId(session) {
  return /^ses_[A-Za-z0-9]+$/.test(String(session || ''));
}

/**
 * 归一化命令，用于判断证据命令是否覆盖合同命令：
 * 去掉 bash -lc 包装、外层引号和括号，合并空白并转小写。
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCommand(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^bash\s+-lc\s+/, '')
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断命令是否是空、占位或 no-op。占位命令不能支撑 DoD。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlaceholderCommand(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const command = normalizeCommand(raw);
  if (
    /^(not[- ]?implemented|todo|tbd|stub|placeholder|none|n\/a)$/i.test(command)
  ) {
    return true;
  }
  return (
    /^(true|:|exit\s+0|echo\b|sleep\b|cat\b)/.test(command) ||
    isMaskingShellCommand(raw)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function dodEvidenceIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

/**
 * 证据命令是否覆盖合同命令；合同命令为空时不做匹配。
 *
 * @param {unknown} actual
 * @param {unknown} required
 * @returns {boolean}
 */
function commandCovers(actual, required) {
  const expected = normalizeCommand(required);
  if (!expected) return true;
  const command = normalizeCommand(actual);
  const index = command.indexOf(expected);
  if (index === -1) return false;
  const before = index === 0 ? '' : command[index - 1];
  const after = command[index + expected.length] || '';
  return (!before || /[\s&|;(]/.test(before)) && (!after || /[\s&|;)]/.test(after));
}

/**
 * @param {string} projectDir
 * @param {string} moduleId
 * @param {any} module
 * @param {any[]} reviews
 * @returns {{ file: string, data: any | null, error: string | null } | null}
 */
function findReview(projectDir, moduleId, module, reviews) {
  const paths = projectPaths(projectDir);
  const candidates = [];
  if (module.review) {
    candidates.push(
      module.review.startsWith('/') ? module.review : join(projectDir, module.review),
    );
  }
  candidates.push(join(paths.reviews, `${moduleId}-review.md`));

  for (const file of candidates) {
    if (!exists(file)) continue;
    const parsed = parseFrontmatter(readText(file));
    if (!parsed.hasFrontmatter) {
      return { file, data: null, error: `${relative(projectDir, file)} is missing front matter` };
    }
    if (parsed.data?.task_id) {
      return {
        file,
        data: null,
        error: `${relative(projectDir, file)} is a task review; task-level reviews belong in .riccon/reviews/tasks/`,
      };
    }
    const check = validateSchema('review.schema.json', parsed.data);
    return {
      file,
      data: parsed.data,
      error: check.valid ? null : check.errors.join('; '),
    };
  }

  const match = reviews.find(
    (record) => record.data?.module_id === moduleId && !record.data?.task_id,
  );
  return match ? { file: match.file, data: match.data, error: match.error } : null;
}

/**
 * @param {{ projectDir: string, moduleId: string, allowOverrun?: boolean }} input
 * @returns {any}
 */
export function checkGate({ projectDir, moduleId, allowOverrun = false, requireScope = false }) {
  /** @type {{ id: string, status: 'pass'|'warn'|'fail', message: string }[]} */
  const checks = [];
  const errors = [];
  const warnings = [];

  /**
   * @param {string} id
   * @param {'pass'|'warn'|'fail'} status
   * @param {string} message
   */
  function add(id, status, message) {
    checks.push({ id, status, message });
    if (status === 'fail') errors.push(message);
    if (status === 'warn') warnings.push(message);
  }

  const { state } = loadProject(projectDir);
  const contractResult = loadContract(projectDir);
  if (contractResult.errors.length) {
    add('contract', 'fail', `project contract is invalid: ${contractResult.errors.join('; ')}`);
  } else {
    add('contract', 'pass', 'project contract is valid');
  }
  const contract = contractResult.contract || {};
  const binding = evidenceBinding(contract);

  const modules = readModules(projectDir);
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    add('module_exists', 'fail', `module ${moduleId} not found`);
    return {
      ok: false,
      module_id: moduleId,
      checked_at: nowIso(),
      review_path: null,
      dod: [],
      checks,
      errors,
      warnings,
    };
  }
  add('module_exists', 'pass', `module ${moduleId} exists`);

  if (module.status === 'planned') {
    add('module_status', 'fail', `module ${moduleId} is still planned; start building first`);
  } else if (module.status === 'blocked') {
    add(
      'module_status',
      'fail',
      `module ${moduleId} is blocked${module.blocker ? `: ${module.blocker}` : ''}`,
    );
  } else {
    add('module_status', 'pass', `module status is ${module.status}`);
  }

  if (!module.acceptance?.length) {
    add('module_acceptance', 'warn', `module ${moduleId} has no explicit acceptance criteria`);
  }

  const tasks = readTasks(projectDir).filter((task) => task.module_id === moduleId);
  if (!tasks.length) {
    add('tasks_present', 'fail', `module ${moduleId} has no tasks`);
  } else {
    add('tasks_present', 'pass', `module ${moduleId} has ${tasks.length} task(s)`);
  }

  for (const task of tasks) {
    if (task.status !== 'done') {
      add(`task:${task.id}`, 'fail', `task ${task.id} is ${task.status}, not done`);
    } else {
      add(`task:${task.id}`, 'pass', `task ${task.id} is done`);
    }
    if (task.blocker) {
      add(`task-blocker:${task.id}`, 'fail', `task ${task.id} has a blocker: ${task.blocker}`);
    }
    if (task.status === 'done' && !task.evidence?.length) {
      add(`task-evidence:${task.id}`, 'fail', `task ${task.id} is done without evidence`);
    }
    for (const message of writeScopeErrors(projectDir, task)) {
      add(`task-scope:${task.id}`, 'fail', message);
    }
  }

  const evidence = readEvidence(projectDir);
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const allTasks = readTasks(projectDir);
  const taskById = new Map(allTasks.map((task) => [task.id, task]));
  for (const record of evidence) {
    if (!taskById.has(record.task_id)) {
      add(
        `evidence-task:${record.id}`,
        'fail',
        `evidence ${record.id} references unknown task ${record.task_id}`,
      );
    }
    if (record.manual === true) {
      add(
        `evidence-manual:${record.id}`,
        'warn',
        `evidence ${record.id} is manual; it cannot establish a pass`,
      );
    }
  }

  for (const task of tasks) {
    for (const evidenceId of task.evidence || []) {
      const record = evidenceById.get(evidenceId);
      if (!record) {
        add(
          `evidence-missing:${task.id}:${evidenceId}`,
          'fail',
          `task ${task.id} references missing evidence ${evidenceId}`,
        );
        continue;
      }
      const verification = verifyEvidenceRecord(projectDir, record, {
        taskId: task.id,
        requireAncestor: true,
        requireCommit: requireScope,
      });
      if (!verification.ok) {
        add(
          `evidence-invalid:${task.id}:${evidenceId}`,
          'fail',
          verification.errors.join('; '),
        );
      } else {
        add(
          `evidence-valid:${task.id}:${evidenceId}`,
          'pass',
          `evidence ${evidenceId} output matches its hash and belongs to ${task.id}`,
        );
      }
    }

    if (task.status === 'done') {
      const records = (task.evidence || [])
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter(Boolean);
      const runs = runRecords(records);
      if (!runs.length) {
        add(
          `task-passing-evidence:${task.id}`,
          'fail',
          `task ${task.id} has no executed evidence; manual evidence cannot establish done`,
        );
      } else {
        const latest = latestRun(records);
        if (!latest || latest.exit_code !== 0) {
          add(
            `task-passing-evidence:${task.id}`,
            'fail',
            `task ${task.id} latest executed evidence ${
              latest?.id || '(none)'
            } is not passing (exit ${latest?.exit_code ?? 'n/a'})`,
          );
        } else {
          add(
            `task-passing-evidence:${task.id}`,
            'pass',
            `task ${task.id} latest executed evidence ${latest.id} passes`,
          );
        }
      }
    }
  }

  if (requireScope && gitSnapshot(projectDir).dirty) {
    add(
      'working_tree',
      'fail',
      'working tree has uncommitted changes that cannot be attributed to a task',
    );
  }

  const unverifiedScope = tasks.filter(
    (task) => !task.baseline_commit || (task.status === 'done' && !task.end_commit),
  );
  if (unverifiedScope.length) {
    add(
      'task-scope-unverified',
      requireScope ? 'fail' : 'warn',
      `${unverifiedScope.length}/${tasks.length} task(s) have no baseline_commit or done task without end_commit; write_scope was not verified`,
    );
  }

  if (requireScope) {
    const unclaimed = unclaimedScopeErrors(projectDir, readTasks(projectDir));
    if (unclaimed.length) {
      add('module-scope-unclaimed', 'fail', unclaimed.join('; '));
    } else {
      add(
        'module-scope-unclaimed',
        'pass',
        'all committed changes after task end_commits are covered by a task write_scope',
      );
    }
  }

  const moduleEvidence = tasks.flatMap((task) =>
    (task.evidence || [])
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter(Boolean),
  );
  const unbound = moduleEvidence.filter((record) => !record.commit);
  const dirty = moduleEvidence.filter((record) => record.dirty === true);
  if (unbound.length) {
    add(
      'evidence_attestation',
      'warn',
      `${unbound.length} evidence record(s) have no git commit attestation (legacy)`,
    );
  } else {
    add('evidence_attestation', 'pass', 'all module evidence is bound to a commit');
  }
  if (dirty.length) {
    add(
      'evidence_attestation',
      binding === 'strict' ? 'fail' : 'warn',
      `${dirty.length} evidence record(s) were recorded from a dirty working tree: ${dirty
        .map((record) => record.id)
        .join(', ')}; commit before recording evidence`,
    );
  }

  const reviews = readReviews(projectDir);
  const review = findReview(projectDir, moduleId, module, reviews);
  const requiredDod = moduleDod(contract);
  const tier = contract.project?.risk_tier || 'T3';

  if (binding === 'strict') {
    add(
      'evidence_binding',
      'pass',
      'quality.evidence_binding is strict; DoD claims require bound evidence',
    );
  } else {
    add(
      'evidence_binding',
      'warn',
      'quality.evidence_binding is legacy; DoD acceptance can still be self-reported; set strict for new projects',
    );
  }

  for (const [dodKey, commandKey] of Object.entries(DOD_COMMANDS)) {
    if (!requiredDod.includes(dodKey)) continue;
    const command = contract.commands?.[commandKey];
    if (isPlaceholderCommand(command)) {
      add(
        `dod-command:${dodKey}`,
        binding === 'strict' ? 'fail' : 'warn',
        `DoD ${dodKey} requires a real commands.${commandKey}; got ${
          String(command || '').trim()
            ? `placeholder "${String(command).trim()}"`
            : 'an empty command'
        }`,
      );
    } else {
      add(
        `dod-command:${dodKey}`,
        'pass',
        `DoD ${dodKey} has commands.${commandKey}`,
      );
    }
  }

  if (!review) {
    add('review_present', 'fail', `no review found for module ${moduleId}`);
  } else if (review.error) {
    add('review_schema', 'fail', `review is invalid: ${review.error}`);
  } else {
    add('review_present', 'pass', `review found: ${relative(projectDir, review.file)}`);
    if (review.data.module_id !== moduleId) {
      add(
        'review_module',
        'fail',
        `review module_id ${review.data.module_id} does not match ${moduleId}`,
      );
    } else {
      add('review_module', 'pass', `review is bound to module ${moduleId}`);
    }

    const moduleEvidenceIds = new Set(
      tasks.flatMap((task) => task.evidence || []),
    );
    const reviewedEvidence = review.data.reviewed_evidence || [];
    if (!reviewedEvidence.length) {
      add(
        'review_evidence',
        'fail',
        `review ${review.data.review_id} does not list reviewed_evidence`,
      );
    } else {
      const unknown = reviewedEvidence.filter(
        (evidenceId) => !evidenceById.has(evidenceId),
      );
      if (unknown.length) {
        add(
          'review_evidence',
          'fail',
          `review references unknown evidence: ${unknown.join(', ')}`,
        );
      }
      const foreign = reviewedEvidence.filter(
        (evidenceId) =>
          evidenceById.has(evidenceId) &&
          !moduleEvidenceIds.has(evidenceId),
      );
      if (foreign.length) {
        add(
          'review_evidence',
          'fail',
          `review references evidence outside ${moduleId}: ${foreign.join(', ')}`,
        );
      }

      const latestByTask = tasks
        .map((task) => {
          const records = (task.evidence || [])
            .map((evidenceId) => evidenceById.get(evidenceId))
            .filter(Boolean)
            .sort(
              (a, b) =>
                Date.parse(a.finished_at) - Date.parse(b.finished_at),
            );
          return records[records.length - 1] || null;
        })
        .filter(Boolean);
      const uncovered = latestByTask.filter(
        (record) => !reviewedEvidence.includes(record.id),
      );
      if (uncovered.length) {
        add(
          'review_evidence',
          'fail',
          `review does not cover latest evidence: ${uncovered
            .map((record) => record.id)
            .join(', ')}`,
        );
      } else {
        add(
          'review_evidence',
          'pass',
          `review covers ${reviewedEvidence.length} evidence record(s)`,
        );
      }

      const reviewTime = Date.parse(review.data.created_at || '');
      const stale = reviewedEvidence
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter(Boolean)
        .filter((record) => {
          const finished = Date.parse(record.finished_at || '');
          return (
            Number.isNaN(reviewTime) ||
            (!Number.isNaN(finished) && reviewTime < finished)
          );
        });
      if (Number.isNaN(reviewTime)) {
        add('review_fresh', 'fail', 'review has no valid created_at');
      } else if (stale.length) {
        add(
          'review_fresh',
          'fail',
          `review predates evidence: ${stale
            .map((record) => record.id)
            .join(', ')}`,
        );
      } else {
        add('review_fresh', 'pass', 'review is newer than its evidence');
      }
    }

    if (
      !review.data.reviewer ||
      review.data.reviewer.independent !== true ||
      !review.data.reviewer.agent ||
      !review.data.reviewer.session ||
      !review.data.reviewer.model
    ) {
      add(
        'review_independence',
        tier === 'T3' || tier === 'T4' ? 'fail' : 'warn',
        `review has incomplete independent reviewer metadata; ${tier} requires reviewer.agent/session/model and independent: true`,
      );
    } else if (
      review.data.reviewer.agent &&
      review.data.reviewer.agent !== 'riccon/verifier' &&
      (isBuilderRole(review.data.reviewer.agent) ||
        review.data.reviewer.agent === 'riccon/lead' ||
        tasks.some((task) => task.owner === review.data.reviewer.agent))
    ) {
      add(
        'review_independence',
        'fail',
        `reviewer ${review.data.reviewer.agent} owns a task or is an implementation role in ${moduleId}`,
      );
    } else {
      add(
        'review_independence',
        'pass',
        `reviewer ${review.data.reviewer.agent || review.data.verifier} is marked independent`,
      );
      if (!isRealSessionId(review.data.reviewer.session)) {
        add(
          'review_session_format',
          'warn',
          `reviewer.session ${review.data.reviewer.session} is not a real ses_ session id; new reviews must use the actual OpenCode session id`,
        );
      }
    }

    if (review.data.verdict !== 'pass') {
      add(
        'review_verdict',
        'fail',
        `review verdict is ${review.data.verdict}, expected pass`,
      );
    } else {
      add('review_verdict', 'pass', 'review verdict is pass');
    }

    for (const key of requiredDod) {
      if (review.data.dod?.[key] === true) {
        add(`dod:${key}`, 'pass', `DoD ${key} passed`);
      } else {
        add(`dod:${key}`, 'fail', `DoD ${key} is not marked true in the review`);
      }
    }

    const dodEvidence = review.data.dod_evidence || {};
    const legacyUnbound = [];
    for (const key of requiredDod) {
      if (review.data.dod?.[key] !== true) continue;
      if (key === 'review' || key === 'evidence') continue;
      const ids = dodEvidenceIds(dodEvidence[key]);
      if (!ids.length) {
        if (binding === 'legacy') {
          legacyUnbound.push(key);
        } else {
          add(
            `dod-evidence:${key}`,
            'fail',
            `DoD ${key} is true but review has no dod_evidence.${key}; strict binding requires a real executed evidence`,
          );
        }
        continue;
      }

      const reasons = [];
      for (const evidenceId of ids) {
        const record = evidenceById.get(evidenceId);
        if (!record) {
          reasons.push(`${evidenceId} does not exist`);
          continue;
        }
        if (!moduleEvidenceIds.has(evidenceId)) {
          reasons.push(`${evidenceId} belongs outside ${moduleId}`);
        }
        if (!reviewedEvidence.includes(evidenceId)) {
          reasons.push(`${evidenceId} is not in reviewed_evidence`);
        }
        if (record.manual === true) {
          reasons.push(`${evidenceId} is manual`);
        }
        if (record.exit_code !== 0) {
          reasons.push(`${evidenceId} exited ${record.exit_code}`);
        }
        const verification = verifyEvidenceRecord(projectDir, record, {
          taskId: record.task_id,
          requireAncestor: true,
        });
        if (!verification.ok) {
          reasons.push(`${evidenceId}: ${verification.errors.join('; ')}`);
        }
        if (DOD_COMMANDS[key]) {
          const required = contract.commands?.[DOD_COMMANDS[key]];
          if (!commandCovers(record.command, required)) {
            reasons.push(
              `${evidenceId} command does not match commands.${DOD_COMMANDS[key]}`,
            );
          }
        }
        if (isPlaceholderCommand(record.command)) {
          reasons.push(`${evidenceId} command is a placeholder or no-op`);
        }
      }
      if (reasons.length) {
        add(
          `dod-evidence:${key}`,
          'fail',
          `DoD ${key} evidence is invalid: ${reasons.join('; ')}`,
        );
      } else {
        add(
          `dod-evidence:${key}`,
          'pass',
          `DoD ${key} is bound to ${ids.join(', ')}`,
        );
      }
    }
    if (legacyUnbound.length) {
      add(
        'dod-evidence',
        'warn',
        `legacy binding: DoD ${legacyUnbound.join(', ')} are self-reported without dod_evidence`,
      );
    }

    for (const finding of review.data.findings || []) {
      const blockingSeverity = finding.severity === 'P0' || finding.severity === 'P1';
      if (blockingSeverity && finding.status !== 'fixed') {
        add(
          `finding:${finding.id}`,
          'fail',
          `${finding.severity} finding ${finding.id} is ${finding.status}: ${finding.title}`,
        );
      } else if (!blockingSeverity && finding.status === 'open') {
        add(
          `finding:${finding.id}`,
          'warn',
          `${finding.severity} finding ${finding.id} is open: ${finding.title}`,
        );
      }
    }
  }

  const decisions = readDecisions(projectDir);
  const openBlocking = decisions.filter((record) => {
    if (record.error || !record.data) return false;
    const matchesModule =
      record.data.module_id === null || record.data.module_id === moduleId;
    return (
      record.data.status === 'open' &&
      record.data.blocking === true &&
      matchesModule
    );
  });
  if (openBlocking.length) {
    add(
      'decisions',
      'fail',
      `${openBlocking.length} blocking decision(s) are still open: ${openBlocking
        .map((record) => record.data.decision_id)
        .join(', ')}`,
    );
  } else {
    add('decisions', 'pass', 'no blocking decisions are open');
  }

  if (module.started_at && module.status !== 'done') {
    const elapsed = hoursSince(module.started_at);
    const limit = module.wall_clock_limit_hours || 8;
    if (elapsed > limit) {
      const message = `module wall-clock ${formatHours(elapsed)} exceeds ${formatHours(limit)}`;
      if (allowOverrun) {
        add('wall_clock', 'warn', `${message}; overrun explicitly allowed`);
      } else {
        add('wall_clock', 'fail', `${message}; raise the limit or record a decision`);
      }
    } else {
      add(
        'wall_clock',
        'pass',
        `module wall-clock ${formatHours(elapsed)} within ${formatHours(limit)}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    module_id: moduleId,
    checked_at: nowIso(),
    review_path: review ? relative(projectDir, review.file) : null,
    dod: requiredDod,
    checks,
    errors,
    warnings,
    state_phase: state.phase,
  };
}

/**
 * @param {string} projectDir
 * @param {any} result
 */
export function recordGateResult(projectDir, result) {
  const { state } = loadProject(projectDir);
  state.gate = {
    status: result.ok ? 'pass' : 'fail',
    module_id: result.module_id,
    checked_at: result.checked_at,
    reasons: result.errors,
  };
  state.updated_at = nowIso();
  saveState(projectDir, state);
}

/**
 * @param {any} result
 * @returns {string}
 */
export function renderGateReport(result) {
  const lines = [];
  lines.push(
    `Gate ${result.module_id}: ${result.ok ? 'PASS' : 'FAIL'} (${result.checked_at})`,
  );
  for (const check of result.checks) {
    const mark =
      check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    lines.push(`  ${mark} ${check.message}`);
  }
  if (result.warnings.length) {
    lines.push(`Warnings: ${result.warnings.length}`);
  }
  if (result.errors.length) {
    lines.push(`Errors: ${result.errors.length}`);
  }
  return lines.join('\n');
}

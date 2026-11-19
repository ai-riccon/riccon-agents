import { join } from 'node:path';
import { writeJson } from './fsx.mjs';
import { assertSchema } from './schema.mjs';
import { nowIso } from './time.mjs';
import { assertTransition, taskNeedsEvidence } from './state-machine.mjs';
import { fail } from './errors.mjs';
import {
  getModuleOrFail,
  getTaskOrFail,
  loadProject,
  nextId,
  readEvidence,
  readModules,
  readTasks,
  saveState,
} from './project.mjs';
import { checkGate } from './gate.mjs';
import {
  FINAL_USER_STATUSES,
  PRODUCT_STATUSES,
  USER_STATUSES,
  hasProductPass,
  isAcceptanceOpen,
} from './acceptance.mjs';
import {
  gitCommitExists,
  gitSnapshot,
  isAncestor,
  isAncestorOf,
  latestRun,
  runRecords,
  verifyEvidenceRecord,
} from './evidence.mjs';
import { enforceWriteScope } from './scope.mjs';

/**
 * @param {any[]} modules
 * @returns {string}
 */
function nextModuleId(modules) {
  let max = 0;
  for (const module of modules) {
    const match = String(module.id).match(/^M([0-9]+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `M${String(max + 1).padStart(2, '0')}`;
}

/**
 * @param {any[]} modules
 * @returns {any | null}
 */
function nextOpenModule(modules) {
  return (
    modules
      .filter((module) => module.status !== 'done' && module.status !== 'blocked')
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null
  );
}

/**
 * @param {any} state
 * @param {any | null} module
 */
function applyModuleToState(state, module) {
  if (!module) {
    state.current_module = null;
    state.phase = 'release';
    state.next_action = 'All modules are done. Run the release gate.';
    return;
  }
  state.current_module = module.id;
  state.phase = module.kind === 'mvc' ? 'mvc' : 'modules';
  state.next_action = `Continue ${module.id}: ${module.title}.`;
}

/**
 * 任务粒度提示：范围或验收项过多时建议拆分，避免 Builder 长时间只读或一次改太多。
 *
 * @param {any} task
 * @returns {string[]}
 */
export function taskSizeWarnings(task) {
  const warnings = [];
  if ((task.write_scope || []).length > 8) {
    warnings.push(
      `write_scope has ${task.write_scope.length} entries; split the task before starting`,
    );
  }
  if ((task.acceptance || []).length >= 6) {
    warnings.push(
      `acceptance has ${task.acceptance.length} items; split by independently verifiable outcomes before starting`,
    );
  }
  return warnings;
}

/**
 * @param {string} projectDir
 * @param {{ id?: string, title: string, goal?: string, kind?: string, dependsOn?: string[], acceptance?: string[], wallClockLimitHours?: number, fixesModule?: string, splitFrom?: string, aliases?: string[] }} input
 * @returns {any}
 */
export function createModule(projectDir, input) {
  const { state, paths } = loadProject(projectDir);
  const modules = readModules(projectDir);
  const id = input.id || nextModuleId(modules);
  const kind = input.kind || 'feature';

  if (!/^M[0-9]{2,}$/.test(id)) {
    fail(`invalid module id "${id}"; expected M01, M02, ...`, {
      code: 'ERR_MODULE_ID',
    });
  }
  if (modules.some((module) => module.id === id)) {
    fail(`module ${id} already exists`, { code: 'ERR_MODULE_EXISTS' });
  }

  const dependsOn = [...(input.dependsOn || [])];
  for (const dependency of dependsOn) {
    if (!modules.some((module) => module.id === dependency)) {
      fail(`module ${id} depends on unknown module ${dependency}`, {
        code: 'ERR_MODULE_DEPENDENCY',
      });
    }
  }

  const fixesModule = input.fixesModule || null;
  if (fixesModule) {
    if (!modules.some((module) => module.id === fixesModule)) {
      fail(`module ${id} fixes unknown module ${fixesModule}`, {
        code: 'ERR_MODULE_DEPENDENCY',
      });
    }
    if (kind !== 'fix') {
      fail(`module ${id} declares fixes_module ${fixesModule}; kind must be fix`, {
        code: 'ERR_MODULE_RELATION',
      });
    }
    if (!dependsOn.includes(fixesModule)) dependsOn.push(fixesModule);
  }

  const splitFrom = input.splitFrom || null;
  if (splitFrom) {
    if (!modules.some((module) => module.id === splitFrom)) {
      fail(`module ${id} splits from unknown module ${splitFrom}`, {
        code: 'ERR_MODULE_DEPENDENCY',
      });
    }
    if (splitFrom === id) {
      fail(`module ${id} cannot split from itself`, {
        code: 'ERR_MODULE_RELATION',
      });
    }
    if (!dependsOn.includes(splitFrom)) dependsOn.push(splitFrom);
  }

  const aliases = [
    ...new Set(
      (input.aliases || []).map((item) => String(item).trim()).filter(Boolean),
    ),
  ];

  const createdAt = nowIso();
  const module = {
    schema_version: 1,
    id,
    title: input.title,
    goal: input.goal || '',
    kind,
    status: 'planned',
    blocker: null,
    depends_on: dependsOn,
    acceptance: input.acceptance || [],
    tasks: [],
    review: null,
    fixes_module: fixesModule,
    split_from: splitFrom,
    aliases,
    product_acceptance: {
      product_status: 'pending',
      user_status: 'pending',
      decision_id: null,
      ref: null,
      note: '',
      accepted_at: null,
      updated_at: null,
    },
    wall_clock_limit_hours: input.wallClockLimitHours || 8,
    started_at: null,
    finished_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  assertSchema('module.schema.json', module, `module ${id}`);
  writeJson(join(paths.modules, `${id}.json`), module);

  if (!state.current_module) {
    applyModuleToState(state, module);
  } else {
    state.next_action = `Module ${id} created. It unlocks after earlier modules are done.`;
  }
  state.updated_at = nowIso();
  saveState(projectDir, state);

  return module;
}

/**
 * @param {string} projectDir
 * @param {string} moduleId
 * @param {{ status?: string, blocker?: string | null, clearBlocker?: boolean, wallClockLimitHours?: number, review?: string, fixesModule?: string | null, splitFrom?: string | null, aliases?: string[], force?: boolean, productAcceptance?: { productStatus?: string, userStatus?: string, decisionId?: string | null, ref?: string | null, note?: string } }} input
 * @returns {any}
 */
export function updateModule(projectDir, moduleId, input) {
  const { state, paths } = loadProject(projectDir);
  const modules = readModules(projectDir);
  const module = getModuleOrFail(moduleId, modules);

  if (input.fixesModule !== undefined) {
    const fixesModule = input.fixesModule || null;
    if (fixesModule) {
      if (!modules.some((item) => item.id === fixesModule)) {
        fail(`module ${moduleId} fixes unknown module ${fixesModule}`, {
          code: 'ERR_MODULE_DEPENDENCY',
        });
      }
      if ((module.kind || 'feature') !== 'fix') {
        fail(`module ${moduleId} declares fixes_module ${fixesModule}; kind must be fix`, {
          code: 'ERR_MODULE_RELATION',
        });
      }
      if (!(module.depends_on || []).includes(fixesModule)) {
        module.depends_on = [...(module.depends_on || []), fixesModule];
      }
    }
    module.fixes_module = fixesModule;
  }

  if (input.splitFrom !== undefined) {
    const splitFrom = input.splitFrom || null;
    if (splitFrom) {
      if (splitFrom === moduleId) {
        fail(`module ${moduleId} cannot split from itself`, {
          code: 'ERR_MODULE_RELATION',
        });
      }
      if (!modules.some((item) => item.id === splitFrom)) {
        fail(`module ${moduleId} splits from unknown module ${splitFrom}`, {
          code: 'ERR_MODULE_DEPENDENCY',
        });
      }
      if (!(module.depends_on || []).includes(splitFrom)) {
        module.depends_on = [...(module.depends_on || []), splitFrom];
      }
    }
    module.split_from = splitFrom;
  }

  if (input.aliases !== undefined) {
    module.aliases = [
      ...new Set(
        (input.aliases || []).map((item) => String(item).trim()).filter(Boolean),
      ),
    ];
  }

  if (input.productAcceptance !== undefined) {
    const productStatus = input.productAcceptance.productStatus;
    const userStatus = input.productAcceptance.userStatus;
    if (
      productStatus !== undefined &&
      !PRODUCT_STATUSES.includes(productStatus)
    ) {
      fail(`invalid product acceptance status "${productStatus}"`, {
        code: 'ERR_PRODUCT_ACCEPTANCE',
      });
    }
    if (userStatus !== undefined && !USER_STATUSES.includes(userStatus)) {
      fail(`invalid user acceptance status "${userStatus}"`, {
        code: 'ERR_PRODUCT_ACCEPTANCE',
      });
    }

    const current = module.product_acceptance || {};
    const nextProductStatus =
      productStatus !== undefined
        ? productStatus
        : current.product_status || 'not-recorded';
    const nextUserStatus =
      userStatus !== undefined
        ? userStatus
        : current.user_status || 'not-recorded';

    // Product 预验收只能在 gate 之后、done 之前或 done 的复查中记录。
    if (
      productStatus === 'pass' &&
      !['review_pending', 'done'].includes(module.status)
    ) {
      fail(
        `module ${moduleId} cannot record Product pass while ${module.status}; move it to review_pending after gate and before done`,
        { code: 'ERR_PRODUCT_ACCEPTANCE' },
      );
    }

    // 用户最终验收是 done 之后的独立步骤，不能提前写入。
    if (
      FINAL_USER_STATUSES.includes(userStatus) &&
      module.status !== 'done'
    ) {
      fail(
        `module ${moduleId} cannot record user acceptance "${userStatus}" before done; finish the module first, then get user acceptance`,
        { code: 'ERR_PRODUCT_ACCEPTANCE' },
      );
    }
    if (userStatus === 'accepted' && nextProductStatus !== 'pass') {
      fail(
        `module ${moduleId} cannot record user acceptance before Product pre-acceptance passes`,
        { code: 'ERR_PRODUCT_ACCEPTANCE' },
      );
    }

    module.product_acceptance = {
      ...current,
      product_status: nextProductStatus,
      user_status: nextUserStatus,
      decision_id:
        input.productAcceptance.decisionId !== undefined
          ? input.productAcceptance.decisionId
          : current.decision_id || null,
      ref:
        input.productAcceptance.ref !== undefined
          ? input.productAcceptance.ref
          : current.ref || null,
      note:
        input.productAcceptance.note !== undefined
          ? input.productAcceptance.note
          : current.note || '',
      accepted_at:
        userStatus !== undefined
          ? nextUserStatus === 'accepted'
            ? current.accepted_at || nowIso()
            : null
          : current.accepted_at || null,
      updated_at: nowIso(),
    };
  }

  if (input.status && input.status !== module.status) {
    assertTransition('module', module.status, input.status);

    if (input.status === 'review_pending') {
      const moduleTasks = readTasks(projectDir).filter(
        (task) => task.module_id === moduleId,
      );
      const pendingTasks = moduleTasks.filter((task) => task.status !== 'done');
      if (moduleTasks.length === 0) {
        fail(`module ${moduleId} cannot move to review_pending without tasks`, {
          code: 'ERR_TASKS_PENDING',
        });
      }
      if (pendingTasks.length > 0) {
        fail(
          `module ${moduleId} cannot move to review_pending; tasks not done: ${pendingTasks
            .map((task) => `${task.id}(${task.status})`)
            .join(', ')}`,
          { code: 'ERR_TASKS_PENDING' },
        );
      }
    }

    if (input.status === 'building') {
      for (const dependency of module.depends_on || []) {
        const dep = modules.find((item) => item.id === dependency);
        if (!dep || dep.status !== 'done') {
          fail(
            `module ${moduleId} cannot start until dependency ${dependency} is done`,
            { code: 'ERR_MODULE_LOCKED' },
          );
        }
      }
      const openAcceptance = (module.depends_on || [])
        .map((dependency) => modules.find((item) => item.id === dependency))
        .filter((dependency) => dependency && isAcceptanceOpen(dependency));
      const unaccepted = openAcceptance.find(
        (dependency) =>
          !(
            (module.kind || 'feature') === 'fix' &&
            module.fixes_module === dependency.id
          ),
      );
      if (unaccepted && !input.force) {
        const acceptance = unaccepted.product_acceptance || {};
        fail(
          `module ${moduleId} cannot start; dependency ${unaccepted.id} acceptance is product=${acceptance.product_status || 'unknown'}, user=${acceptance.user_status || 'unknown'}; fix it with kind=fix and fixes_module=${unaccepted.id}, or wait for user acceptance (use --force only to normalize legacy state)`,
          { code: 'ERR_PRODUCT_ACCEPTANCE' },
        );
      }
      // 从 review_pending/blocked 退回构建时，旧的 Product pass 或用户验收已失效。
      if (
        hasProductPass(module) ||
        FINAL_USER_STATUSES.includes(module.product_acceptance?.user_status)
      ) {
        module.product_acceptance = {
          ...(module.product_acceptance || {}),
          product_status: 'pending',
          user_status: 'pending',
          decision_id: null,
          accepted_at: null,
          updated_at: nowIso(),
        };
      }
      if (!module.started_at) module.started_at = nowIso();
      applyModuleToState(state, module);
    }

    if (input.status === 'done') {
      const gate = checkGate({ projectDir, moduleId });
      if (!gate.ok) {
        fail(
          `module ${moduleId} cannot be marked done; gate failed: ${gate.errors.join('; ')}`,
          { code: 'ERR_GATE', details: gate },
        );
      }
      const productStatus = module.product_acceptance?.product_status;
      if (productStatus && !['not-recorded', 'pass'].includes(productStatus)) {
        fail(
          `module ${moduleId} cannot be marked done; Product pre-acceptance is ${productStatus}; record product_status=pass before done, then get user acceptance separately`,
          { code: 'ERR_PRODUCT_ACCEPTANCE' },
        );
      }
      module.status = 'done';
      module.finished_at = nowIso();
      module.review = gate.review_path || module.review;
      state.gate = {
        status: 'pass',
        module_id: moduleId,
        checked_at: gate.checked_at,
        reasons: [],
      };
      const next = nextOpenModule(modules);
      applyModuleToState(state, next);
    } else {
      module.status = input.status;
    }
  }

  if (input.blocker !== undefined) module.blocker = input.blocker;
  if (input.clearBlocker) module.blocker = null;
  if (input.wallClockLimitHours) {
    module.wall_clock_limit_hours = input.wallClockLimitHours;
  }
  if (input.review !== undefined) module.review = input.review;

  module.updated_at = nowIso();
  assertSchema('module.schema.json', module, `module ${moduleId}`);
  writeJson(join(paths.modules, `${moduleId}.json`), module);
  state.updated_at = nowIso();
  saveState(projectDir, state);

  return module;
}

/**
 * @param {string} projectDir
 * @param {{ moduleId: string, title: string, owner: string, writeScope?: string[], acceptance?: string[] }} input
 * @returns {any}
 */
export function createTask(projectDir, input) {
  const { state, paths } = loadProject(projectDir);
  const modules = readModules(projectDir);
  const module = getModuleOrFail(input.moduleId, modules);
  if (module.status === 'done') {
    fail(
      `module ${module.id} is done; create a fix module or a new task in an active module`,
      { code: 'ERR_MODULE_DONE' },
    );
  }
  const tasks = readTasks(projectDir);
  const id = nextId('TASK', tasks.map((task) => task.id), 4);

  const createdAt = nowIso();
  const task = {
    schema_version: 1,
    id,
    module_id: input.moduleId,
    title: input.title,
    owner: input.owner,
    status: 'planned',
    write_scope: input.writeScope || [],
    acceptance: input.acceptance || [],
    evidence: [],
    tools_used: [],
    blocker: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  assertSchema('task.schema.json', task, `task ${id}`);
  writeJson(join(paths.tasks, `${id}.json`), task);

  module.tasks = [...new Set([...(module.tasks || []), id])];
  module.updated_at = nowIso();
  assertSchema('module.schema.json', module, `module ${input.moduleId}`);
  writeJson(join(paths.modules, `${module.id}.json`), module);

  state.next_action = `Move ${id} to ready when its brief is complete.`;
  state.updated_at = nowIso();
  saveState(projectDir, state);

  return task;
}

/**
 * 校验显式 commit 引用存在且是 HEAD 祖先。
 *
 * @param {string} projectDir
 * @param {string} label
 * @param {string} commit
 */
function validateCommitRef(projectDir, label, commit) {
  if (!gitCommitExists(projectDir, commit)) {
    fail(`${label} ${commit} does not exist; cannot verify write_scope`, {
      code: 'ERR_BAD_COMMIT',
    });
  }
  if (!isAncestor(projectDir, commit)) {
    fail(`${label} ${commit} is not an ancestor of HEAD`, {
      code: 'ERR_BAD_COMMIT',
    });
  }
}

/**
 * @param {string} projectDir
 * @param {string} baseline
 * @param {string} end
 */
function validateCommitOrder(projectDir, baseline, end) {
  if (!isAncestorOf(projectDir, baseline, end)) {
    fail(`baseline ${baseline} is not an ancestor of end ${end}`, {
      code: 'ERR_COMMIT_ORDER',
    });
  }
}

/**
 * 记录模块级成本估算。`confidence: unmeasured` 表示尚未测量，
 * 不能把全零字段当成“零成本”。所有数值必须是非负有限数。
 *
 * @param {string} projectDir
 * @param {string} moduleId
 * @param {{ requests?: number|string, tokensInput?: number|string, tokensOutput?: number|string, wallClockMinutes?: number|string, costUsd?: number|string, confidence?: string, source?: string, note?: string }} input
 * @returns {any}
 */
export function recordModuleCost(projectDir, moduleId, input) {
  const { paths } = loadProject(projectDir);
  const modules = readModules(projectDir);
  const module = getModuleOrFail(moduleId, modules);
  const confidence = input.confidence || 'estimated';
  if (!['unmeasured', 'estimated', 'measured'].includes(confidence)) {
    fail('budget confidence must be unmeasured, estimated or measured', {
      code: 'ERR_BAD_COST',
    });
  }
  const number = (value, label) => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      fail(`budget ${label} must be a non-negative number`, {
        code: 'ERR_BAD_COST',
      });
    }
    return parsed;
  };
  const budget = {
    requests: number(input.requests, 'requests'),
    tokens_input: number(input.tokensInput, 'tokens-input'),
    tokens_output: number(input.tokensOutput, 'tokens-output'),
    wall_clock_minutes: number(input.wallClockMinutes, 'wall-clock-minutes'),
    cost_usd: number(input.costUsd, 'cost-usd'),
    confidence,
    source: String(input.source || '').trim(),
    note: String(input.note || '').trim(),
    recorded_at: nowIso(),
  };
  const total =
    budget.requests +
    budget.tokens_input +
    budget.tokens_output +
    budget.wall_clock_minutes +
    budget.cost_usd;
  if (total === 0 && confidence !== 'unmeasured') {
    fail(
      'all budget metrics are zero; use --confidence unmeasured or record real estimates',
      { code: 'ERR_BAD_COST' },
    );
  }
  if (total !== 0 && confidence === 'unmeasured') {
    fail('unmeasured budget cannot include metrics; use estimated or measured', {
      code: 'ERR_BAD_COST',
    });
  }
  if (confidence !== 'unmeasured' && !budget.source) {
    fail('budget source is required for estimated/measured costs', {
      code: 'ERR_BAD_COST',
    });
  }
  module.budget_usage = budget;
  module.updated_at = nowIso();
  writeJson(join(paths.modules, `${module.id}.json`), module);
  return module;
}

/**
 * @param {string} projectDir
 * @param {string} taskId
 * @param {{ status?: string, owner?: string, blocker?: string | null, clearBlocker?: boolean, tool?: string, force?: boolean, baselineCommit?: string, endCommit?: string }} input
 * @returns {any}
 */
export function updateTask(projectDir, taskId, input) {
  const { state, paths } = loadProject(projectDir);
  const tasks = readTasks(projectDir);
  const task = getTaskOrFail(taskId, tasks);
  const modules = readModules(projectDir);
  const module = getModuleOrFail(task.module_id, modules);
  const previousOwner = task.owner;

  if (input.endCommit) {
    if (!['review', 'done'].includes(input.status || task.status)) {
      fail('--end-commit is only valid for review/done tasks', {
        code: 'ERR_BAD_COMMIT',
      });
    }
    validateCommitRef(projectDir, 'end_commit', input.endCommit);
    task.end_commit = input.endCommit;
  }
  if (input.baselineCommit) {
    validateCommitRef(projectDir, 'baseline_commit', input.baselineCommit);
    task.baseline_commit = input.baselineCommit;
  }
  if (task.baseline_commit && task.end_commit) {
    validateCommitOrder(projectDir, task.baseline_commit, task.end_commit);
  }

  if (
    input.owner &&
    input.owner !== task.owner &&
    task.status === 'in_progress'
  ) {
    const occupied = state.active_tasks?.[input.owner];
    if (occupied && occupied !== taskId && !input.force) {
      fail(
        `owner ${input.owner} already has active task ${occupied}; finish it or pass --force`,
        { code: 'ERR_ACTIVE_TASK' },
      );
    }
  }

  if (input.status && input.status !== task.status) {
    assertTransition('task', task.status, input.status);

    if (input.status === 'in_progress') {
      if (module.status !== 'building') {
        fail(
          `task ${taskId} cannot start; module ${module.id} is ${module.status}, expected building`,
          { code: 'ERR_MODULE_NOT_BUILDING' },
        );
      }
      for (const dependency of module.depends_on || []) {
        const dep = modules.find((item) => item.id === dependency);
        if (!dep || dep.status !== 'done') {
          fail(
            `task ${taskId} cannot start; module ${module.id} dependency ${dependency} is ${dep?.status || 'missing'}, expected done`,
            { code: 'ERR_MODULE_LOCKED' },
          );
        }
      }
      const owner = input.owner || task.owner;
      const occupied = state.active_tasks?.[owner];
      if (occupied && occupied !== taskId && !input.force) {
        fail(
          `owner ${owner} already has active task ${occupied}; finish it or pass --force`,
          { code: 'ERR_ACTIVE_TASK' },
        );
      }
      if (!task.baseline_commit) {
        task.baseline_commit = gitSnapshot(projectDir).commit;
      }
    }

    if (['review', 'done'].includes(input.status)) {
      const scopeTask =
        task.end_commit
          ? { ...task, status: 'done', end_commit: task.end_commit }
          : task;
      enforceWriteScope(projectDir, scopeTask);
    }

    if (taskNeedsEvidence(input.status) && task.evidence.length === 0) {
      fail(
        `task ${taskId} cannot move to ${input.status} without evidence; run \`riccon evidence run\` or \`riccon evidence add\``,
        { code: 'ERR_EVIDENCE_REQUIRED' },
      );
    }
    if (input.status === 'done' && task.blocker) {
      fail(`task ${taskId} has a blocker; clear it before marking done`, {
        code: 'ERR_BLOCKED',
      });
    }
    if (input.status === 'done') {
      const records = readEvidence(projectDir).filter((record) =>
        task.evidence.includes(record.id),
      );
      for (const record of records) {
        const verification = verifyEvidenceRecord(projectDir, record, {
          taskId,
          requireAncestor: true,
        });
        if (!verification.ok) {
          fail(
            `task ${taskId} has invalid evidence ${record.id}: ${verification.errors.join('; ')}`,
            { code: 'ERR_EVIDENCE_INVALID' },
          );
        }
      }
      const runs = runRecords(records);
      if (!runs.length) {
        fail(
          `task ${taskId} has no executed evidence; manual evidence cannot establish done`,
          { code: 'ERR_EVIDENCE_MANUAL_ONLY' },
        );
      }
      const latest = latestRun(records);
      if (!latest || latest.exit_code !== 0) {
        fail(
          `task ${taskId} latest executed evidence ${latest?.id || '(none)'} is not passing (exit ${latest?.exit_code ?? 'n/a'})`,
          { code: 'ERR_EVIDENCE_NOT_PASSING' },
        );
      }
      const command = String(latest.command || '').trim();
      if (
        /^(true|:|exit\s+0|echo\b|sleep\b)/.test(command) ||
        /\|\|\s*(true|:)\s*$/.test(command)
      ) {
        fail(
          `task ${taskId} latest evidence ${latest.id} is a no-op or masks failure: ${command}`,
          { code: 'ERR_EVIDENCE_TRIVIAL' },
        );
      }
    }
    task.status = input.status;
    if (task.status === 'done' && !task.end_commit) {
      task.end_commit = gitSnapshot(projectDir).commit;
    }
  }

  if (input.owner) task.owner = input.owner;
  if (input.blocker !== undefined) task.blocker = input.blocker;
  if (input.clearBlocker) task.blocker = null;
  if (input.tool && !task.tools_used.includes(input.tool)) {
    task.tools_used.push(input.tool);
  }

  const activeTasks = { ...(state.active_tasks || {}) };
  if (previousOwner !== task.owner && activeTasks[previousOwner] === taskId) {
    delete activeTasks[previousOwner];
  }
  if (task.status === 'in_progress') {
    activeTasks[task.owner] = taskId;
  } else if (activeTasks[task.owner] === taskId) {
    delete activeTasks[task.owner];
  }
  state.active_tasks = activeTasks;

  task.updated_at = nowIso();
  assertSchema('task.schema.json', task, `task ${taskId}`);
  writeJson(join(paths.tasks, `${taskId}.json`), task);

  state.next_action =
    task.status === 'done'
      ? `Task ${taskId} is done. Check whether module ${task.module_id} is ready for verification.`
      : `Continue task ${taskId} (${task.status}).`;
  state.updated_at = nowIso();
  saveState(projectDir, state);

  return task;
}

/**
 * @param {string} projectDir
 * @param {{ moduleId?: string, status?: string }} [filter]
 * @returns {any[]}
 */
export function listTasks(projectDir, filter = {}) {
  return readTasks(projectDir).filter((task) => {
    if (filter.moduleId && task.module_id !== filter.moduleId) return false;
    if (filter.status && task.status !== filter.status) return false;
    return true;
  });
}

/**
 * @param {string} projectDir
 * @param {string} moduleId
 * @returns {any}
 */
export function showModule(projectDir, moduleId) {
  return getModuleOrFail(moduleId, readModules(projectDir));
}

/**
 * @param {string} projectDir
 * @param {string} taskId
 * @returns {any}
 */
export function showTask(projectDir, taskId) {
  return getTaskOrFail(taskId, readTasks(projectDir));
}

/**
 * @param {string} projectDir
 * @param {string} moduleId
 * @returns {{ module: any, taskCount: number, doneCount: number }}
 */
export function moduleSummary(projectDir, moduleId) {
  const module = getModuleOrFail(moduleId, readModules(projectDir));
  const tasks = readTasks(projectDir).filter((task) => task.module_id === moduleId);
  return {
    module,
    taskCount: tasks.length,
    doneCount: tasks.filter((task) => task.status === 'done').length,
  };
}


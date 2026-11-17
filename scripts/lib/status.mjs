import { hoursSince, formatHours } from './time.mjs';
import {
  loadProject,
  readDecisions,
  readHandoffs,
  readModules,
  readTasks,
} from './project.mjs';
import { loadContract } from './contract.mjs';

/**
 * @param {string} projectDir
 * @returns {any}
 */
export function getStatus(projectDir) {
  const { project, state } = loadProject(projectDir);
  const contract = loadContract(projectDir);
  const modules = readModules(projectDir);
  const tasks = readTasks(projectDir);
  const decisions = readDecisions(projectDir);
  const handoffs = readHandoffs(projectDir);

  const current =
    modules.find((module) => module.id === state.current_module) || null;
  const currentTasks = current
    ? tasks.filter((task) => task.module_id === current.id)
    : [];

  /** @type {Record<string, number>} */
  const taskCounts = {
    planned: 0,
    ready: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  for (const task of tasks) {
    taskCounts[task.status] = (taskCounts[task.status] || 0) + 1;
  }

  const openDecisions = decisions.filter(
    (record) => record.data?.status === 'open',
  );
  const blockingDecisions = openDecisions.filter(
    (record) => record.data?.blocking === true,
  );

  const latestHandoff =
    handoffs
      .filter((record) => record.data)
      .sort((a, b) =>
        String(a.data.handoff_id).localeCompare(String(b.data.handoff_id)),
      )
      .at(-1) || null;

  return {
    project: {
      name: project.name,
      type: project.type,
      risk_tier: project.risk_tier,
      status: project.status,
    },
    phase: state.phase,
    current_module: current
      ? {
          id: current.id,
          title: current.title,
          kind: current.kind,
          status: current.status,
          tasks_done: currentTasks.filter((task) => task.status === 'done').length,
          tasks_total: currentTasks.length,
          wall_clock_hours: current.started_at
            ? Number(hoursSince(current.started_at).toFixed(2))
            : 0,
          wall_clock_limit_hours: current.wall_clock_limit_hours || 8,
          budget_usage: current.budget_usage || null,
        }
      : null,
    gate: state.gate,
    release_gate: state.release_gate || null,
    tasks: taskCounts,
    decisions: {
      open: openDecisions.length,
      blocking: blockingDecisions.length,
      ids: openDecisions.map((record) => record.data?.decision_id).filter(Boolean),
    },
    contract: contract.errors.length
      ? { ok: false, errors: contract.errors, warnings: contract.warnings }
      : { ok: true, warnings: contract.warnings },
    last_handoff: state.last_handoff,
    latest_handoff: latestHandoff?.data || null,
    next_action: state.next_action,
    budget_usage: state.budget_usage,
  };
}

/**
 * @param {any} status
 * @returns {string}
 */
export function renderStatus(status) {
  const lines = [];
  lines.push(
    `riccon · ${status.project.name} (${status.project.type}, ${status.project.risk_tier}, ${status.project.status})`,
  );
  lines.push(`phase: ${status.phase}`);
  if (status.current_module) {
    const module = status.current_module;
    lines.push(
      `current: ${module.id} ${module.kind || 'feature'} — ${module.status} · ${module.tasks_done}/${module.tasks_total} tasks · ${formatHours(module.wall_clock_hours)} / ${formatHours(module.wall_clock_limit_hours)}`,
    );
    if (module.budget_usage) {
      const budget = module.budget_usage;
      lines.push(
        `budget: ${budget.confidence} · ${budget.requests} req · ${budget.tokens_input + budget.tokens_output} tokens · $${budget.cost_usd}${
          budget.source ? ` · ${budget.source}` : ''
        }`,
      );
    }
  } else {
    lines.push('current: none');
  }
  lines.push(
    `gate: ${status.gate.status}${status.gate.module_id ? ` (${status.gate.module_id})` : ''}`,
  );
  if (status.release_gate) {
    lines.push(
      `release gate: ${status.release_gate.status}${
        status.release_gate.release_id ? ` (${status.release_gate.release_id})` : ''
      }`,
    );
  }
  lines.push(
    `tasks: ${status.tasks.done} done, ${status.tasks.in_progress} in progress, ${status.tasks.blocked} blocked, ${status.tasks.planned + status.tasks.ready} pending`,
  );
  lines.push(
    `decisions: ${status.decisions.open} open (${status.decisions.blocking} blocking)`,
  );
  lines.push(
    `contract: ${status.contract.ok ? 'ok' : 'invalid'}${status.contract.warnings?.length ? ` (${status.contract.warnings.length} warnings)` : ''}`,
  );
  lines.push(`last handoff: ${status.last_handoff || 'none'}`);
  lines.push(`next: ${status.next_action}`);
  return lines.join('\n');
}

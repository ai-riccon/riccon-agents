import { parseArgs } from 'node:util';
import { renameSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  exists,
  readJson,
  readText,
  writeText,
} from './fsx.mjs';
import { nowIso, timestampSlug } from './time.mjs';
import {
  contractHash,
  defaultContract,
  loadContract,
  readContract,
  writeContractBlock,
} from './contract.mjs';
import {
  ensureProjectDirs,
  loadProject,
  projectPaths,
  readDecisions,
  readEvidence,
  readHandoffs,
  readModules,
  readReviews,
  readTasks,
  readTaskReviews,
  saveProject,
  saveState,
} from './project.mjs';
import {
  createModule,
  createTask,
  listTasks,
  recordModuleCost,
  taskSizeWarnings,
  showModule,
  showTask,
  updateModule,
  updateTask,
} from './task.mjs';
import { addEvidence, listEvidence, runEvidence } from './evidence.mjs';
import {
  answerDecision,
  createDecision,
  listDecisions,
  showDecision,
} from './decision.mjs';
import { checkGate, recordGateResult, renderGateReport } from './gate.mjs';
import {
  approveRelease,
  checkRelease,
  createRelease,
  listReleases,
  recordReleaseResult,
  renderReleaseReport,
  showRelease,
} from './release.mjs';
import { checkSandbox, renderSandboxReport } from './sandbox.mjs';
import { createHandoff, listHandoffs, showHandoff } from './handoff.mjs';
import { getStatus, renderStatus } from './status.mjs';
import { runDoctor } from './doctor.mjs';
import { upgradeProject } from './upgrade.mjs';
import { adoptProject } from './adopt.mjs';
import { TEAM_ROOT, TEMPLATES_DIR } from './paths.mjs';
import { TEAM_VERSION } from './version.mjs';
import { RicconError, fail } from './errors.mjs';
import { stringifyYaml } from './yamlx.mjs';
import { assertSchema } from './schema.mjs';

/**
 * @param {string[]} args
 * @param {Record<string, any>} [extra]
 * @returns {{ values: any, positionals: string[] }}
 */
function parse(args, extra = {}) {
  return parseArgs({
    args,
    options: {
      project: { type: 'string', default: '.' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      ...extra,
    },
    allowPositionals: true,
    strict: true,
  });
}

/**
 * @param {boolean} json
 * @param {unknown} value
 */
function printJson(json, value) {
  if (json) console.log(JSON.stringify(value, null, 2));
}

/**
 * @param {boolean} json
 * @param {string} message
 */
function printHuman(json, message) {
  if (!json) console.log(message);
}

function printHelp() {
  console.log(`riccon ${TEAM_VERSION} — project state kernel for the Riccon agent team

Usage:
  riccon init [--name NAME] [--type web-app|api|cli|static|automation|other]
              [--risk-tier T1|T2|T3|T4] [--status greenfield|existing]
              [--evidence-binding strict|legacy] [--force] [--project DIR] [--json]
  riccon adopt [--write] [--project DIR] [--json]
  riccon upgrade [--write] [--adopt-legacy] [--project DIR] [--json]
  riccon contract validate [--strict] [--project DIR] [--json]
  riccon contract show [--project DIR] [--json]
  riccon contract sync [--project DIR] [--json]
  riccon state validate [--project DIR] [--json]
  riccon state show [--project DIR] [--json]
  riccon module new --title TITLE [--id M01] [--kind mvc|feature|fix]
              [--goal TEXT] [--depends-on M01] [--acceptance TEXT]
              [--fixes M03] [--split-from M03] [--alias M03b]
              [--wall-clock-limit 8] [--project DIR] [--json]
  riccon module update M01 --status planned|building|verifying|review_pending|done|blocked
              [--blocker TEXT] [--clear-blocker] [--wall-clock-limit 8]
              [--fixes M03] [--split-from M03] [--alias M03b]
              [--product-status pending|pass|changes-requested|blocked]
              [--user-status pending|accepted|rejected|conditional]
              [--acceptance-decision DEC-0001] [--acceptance-ref PATH]
              [--acceptance-note TEXT] [--force] [--project DIR] [--json]
  riccon module cost M01 [--requests N] [--input-tokens N] [--output-tokens N]
              [--wall-clock-minutes N] [--cost-usd N]
              [--confidence unmeasured|estimated|measured]
              [--source TEXT] [--note TEXT] [--project DIR] [--json]
  riccon module list|show [M01] [--project DIR] [--json]
  riccon task new --module M01 --title TITLE [--owner riccon/builder]
              [--write-scope PATH] [--acceptance TEXT] [--project DIR] [--json]
  riccon task update TASK-0001 --status planned|ready|in_progress|review|done|blocked
              [--owner NAME] [--blocker TEXT] [--clear-blocker] [--tool ID]
              [--baseline-commit SHA] [--end-commit SHA]
              [--force] [--project DIR] [--json]
  riccon task list [--module M01] [--status STATUS] [--project DIR] [--json]
  riccon task show TASK-0001 [--project DIR] [--json]
  riccon evidence run --task TASK-0001 [--agent NAME] [--note TEXT] -- "COMMAND"
  riccon evidence add --task TASK-0001 --command TEXT --output FILE
              [--exit-code 0] [--agent NAME] [--note TEXT] [--project DIR] [--json]
  riccon evidence list [--task TASK-0001] [--project DIR] [--json]
  riccon decision new --title TITLE --question TEXT [--module M01] [--blocking]
              [--option TEXT] [--recommendation TEXT] [--consequences TEXT]
              [--default TEXT] [--release REL-0001] [--environment ENV]
              [--project DIR] [--json]
  riccon decision answer DEC-0001 --answer TEXT --kind approve|reject|choose|defer
              [--release REL-0001] [--environment ENV] [--project DIR] [--json]
  riccon decision list|show [DEC-0001] [--project DIR] [--json]
  riccon gate check --module M01 [--allow-overrun] [--require-scope] [--project DIR] [--json]
  riccon release check [REL-0001] [--environment sandbox|staging|production] [--require-scope|--legacy-scope]
              [--project DIR] [--json]
  riccon release new --version VERSION --environment ENV --scope TEXT
              [--threat-model PATH] [--load-test PATH] [--rollback-drill PATH]
              [--runbook PATH] [--evidence TEXT] [--project DIR] [--json]
  riccon release approve REL-0001 --decision DEC-0001
              [--second-review-model MODEL] [--second-review-path FILE]
              [--project DIR] [--json]
  riccon release list|show [REL-0001] [--project DIR] [--json]
  riccon sandbox check [--project DIR] [--json]
  riccon handoff new [--session ID] [--summary TEXT] [--next TEXT]
              [--invariant TEXT] [--risk TEXT] [--first-read PATH]
              [--project DIR] [--json]
  riccon handoff list|show [HANDOFF-0001] [--project DIR] [--json]
  riccon status [--project DIR] [--json]
  riccon doctor [--json]

Global options:
  --project DIR   Project directory (default: current directory)
  --json          Machine-readable output
  --help          Show this help
  --version       Show the team version
`);
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdInit(args) {
  const { values } = parse(args, {
    name: { type: 'string' },
    type: { type: 'string', default: 'web-app' },
    'risk-tier': { type: 'string', default: 'T3' },
    status: { type: 'string', default: 'greenfield' },
    'evidence-binding': { type: 'string', default: 'strict' },
    force: { type: 'boolean', default: false },
  });
  if (!['strict', 'legacy'].includes(values['evidence-binding'])) {
    fail('--evidence-binding must be strict or legacy');
  }
  const projectDir = resolve(values.project);
  const name = values.name || basename(projectDir);
  const paths = projectPaths(projectDir);
  const archived = [];

  if (exists(paths.riccon)) {
    let alreadyInitialized = false;
    if (exists(paths.projectJson)) {
      try {
        alreadyInitialized = readJson(paths.projectJson)?.schema_version === 1;
      } catch {
        alreadyInitialized = false;
      }
    }
    if (alreadyInitialized && !values.force) {
      fail(
        `${projectDir} is already initialized; use --force to archive the existing .riccon/ and reinitialize`,
        { code: 'ERR_ALREADY_INITIALIZED' },
      );
    }
    const archive = uniqueArchivePath(projectDir);
    renameSync(paths.riccon, archive);
    archived.push(archive);
  }

  ensureProjectDirs(paths);
  for (const dir of [
    paths.modules,
    paths.tasks,
    paths.decisions,
    paths.evidence,
    paths.reviews,
    paths.taskReviews,
    paths.releases,
    paths.handoffs,
    paths.runs,
    paths.archive,
  ]) {
    const keep = join(dir, '.gitkeep');
    if (!exists(keep)) writeText(keep, '');
  }

  const contractProbe = exists(paths.agentsMd)
    ? loadContract(projectDir)
    : null;
  const hasExistingBlock = Boolean(contractProbe?.block);
  const preserveExisting =
    Boolean(contractProbe?.contract) && contractProbe.errors.length === 0;

  if (hasExistingBlock && !preserveExisting && !values.force) {
    fail(
      `existing Project Contract is invalid: ${contractProbe.errors.join('; ')}; fix it or use --force`,
      { code: 'ERR_CONTRACT' },
    );
  }

  const contract =
    preserveExisting && contractProbe?.contract
      ? contractProbe.contract
      : defaultContract({
          name,
          type: values.type,
          riskTier: values['risk-tier'],
          status: values.status,
          evidenceBinding: values['evidence-binding'],
        });
  assertSchema('contract.schema.json', contract, 'default contract');

  if (!preserveExisting) {
    if (exists(paths.agentsMd)) {
      writeContractBlock(paths.agentsMd, contract);
    } else {
      const template = readText(join(TEMPLATES_DIR, 'project', 'AGENTS.md')).replaceAll(
        '{{PROJECT_NAME}}',
        name,
      );
      writeText(paths.agentsMd, template);
      writeContractBlock(paths.agentsMd, contract);
    }
  }

  const contractProject = contract.project || {};
  const finalName = contractProject.name || name;
  const finalType = contractProject.type || values.type;
  const finalRiskTier = contractProject.risk_tier || values['risk-tier'];
  const finalStatus = contractProject.status || values.status;

  for (const [source, destination] of [
    ['project/docs/PRODUCT.md', 'docs/PRODUCT.md'],
    ['project/docs/ARCHITECTURE.md', 'docs/ARCHITECTURE.md'],
    ['project/docs/COLLABORATION.md', 'docs/COLLABORATION.md'],
    ['project/docs/ACCEPTANCE.md', 'docs/ACCEPTANCE.md'],
    ['project/docs/RUNBOOK.md', 'docs/RUNBOOK.md'],
    ['project/docs/SANDBOX.md', 'docs/SANDBOX.md'],
    ['project/docs/adr/README.md', 'docs/adr/README.md'],
  ]) {
    const file = join(projectDir, destination);
    if (!exists(file)) writeText(file, readText(join(TEMPLATES_DIR, source)));
  }

  const createdAt = nowIso();
  const project = {
    schema_version: 1,
    team_version: TEAM_VERSION,
    name: finalName,
    type: finalType,
    risk_tier: finalRiskTier,
    status: finalStatus,
    contract: {
      path: 'AGENTS.md',
      sha256: contractHash(contract),
    },
    created_at: createdAt,
    updated_at: createdAt,
  };
  const state = {
    schema_version: 1,
    phase: 'init',
    current_module: null,
    gate: {
      status: 'none',
      module_id: null,
      checked_at: null,
      reasons: [],
    },
    health: 'unknown',
    last_handoff: null,
    next_action:
      'Edit the Project Contract in AGENTS.md, then run `riccon contract validate`.',
    budget_usage: {
      tokens_input: 0,
      tokens_output: 0,
      wall_clock_minutes: 0,
      cost_usd: 0,
    },
    created_at: createdAt,
    updated_at: createdAt,
  };

  saveProject(projectDir, project);
  saveState(projectDir, state);

  printJson(values.json, {
    ok: true,
    project_dir: projectDir,
    name: finalName,
    archived,
    contract: 'AGENTS.md',
    state: '.riccon/state.json',
  });
  printHuman(
    values.json,
    `initialized ${finalName} in ${projectDir}\n` +
      (archived.length ? `archived previous .riccon/ to ${archived.join(', ')}\n` : '') +
      'next: run `riccon contract validate`, then create the MVC module.',
  );
  return 0;
}

/**
 * @param {string} projectDir
 * @returns {string}
 */
function uniqueArchivePath(projectDir) {
  const base = join(projectDir, `.riccon-old-${timestampSlug()}`);
  if (!exists(base)) return base;
  let index = 2;
  while (exists(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/**
 * @param {string[]} args
 * @returns {number}
 */
/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdAdopt(args) {
  const { values } = parse(args, {
    write: { type: 'boolean', default: false },
  });
  const projectDir = resolve(values.project);
  const result = adoptProject(projectDir, { write: values.write });

  printJson(values.json, {
    ok: true,
    wrote: result.wrote,
    project_dir: projectDir,
    detected: result.detected,
    contract: result.contract,
    manifest: result.manifest,
    files: result.files,
  });

  if (!values.json) {
    console.log(
      `adopt ${result.wrote ? 'written' : 'dry-run'} · ${result.detected.type} · ${
        result.detected.languages.join(', ') || 'unknown'
      }`,
    );
    console.log(
      `source: ${result.detected.source.join(', ') || 'unknown'} · tests: ${
        result.detected.tests.join(', ') || 'unknown'
      }`,
    );
    console.log(`test: ${result.detected.commands.test || '（未识别）'}`);
    console.log(`baseline: ${result.manifest.files} files · ${result.manifest.sha256}`);
    if (!result.wrote) {
      console.log('next: review the detection, then rerun with --write to create .riccon/AGENTS.md/docs/ADOPTION.md.');
    } else {
      console.log('next: review docs/ADOPTION.md and AGENTS.md; run `riccon contract validate`.');
    }
  }
  return 0;
}

/**
 * 同步团队管理的 AGENTS 区块和模板文档；默认 dry-run。
 *
 * @param {string[]} args
 * @returns {number}
 */
function cmdUpgrade(args) {
  const { values } = parse(args, {
    write: { type: 'boolean', default: false },
    'adopt-legacy': { type: 'boolean', default: false },
  });
  const projectDir = resolve(values.project);
  const result = upgradeProject(projectDir, {
    write: values.write,
    adoptLegacy: values['adopt-legacy'],
  });
  printJson(values.json, result);
  if (!values.json) {
    if (!result.ok) {
      console.log(`upgrade ${result.mode}: ${result.message}`);
      console.log(
        'next: review templates/project/AGENTS.md and add the managed team block manually, or rerun with --adopt-legacy after reviewing the diff.',
      );
      return 1;
    }
    console.log(
      `upgrade ${result.mode}${result.dry_run ? ' (dry-run)' : ''} · team ${result.version.from || 'unknown'} → ${result.version.to}`,
    );
    for (const doc of result.docs) {
      console.log(`  ${doc.action} ${doc.path}`);
    }
    if (result.dry_run) {
      console.log('next: review the diff, then rerun with --write.');
    } else {
      console.log(
        'next: review AGENTS.md and docs/COLLABORATION.md, then run `riccon contract validate` and `riccon state validate`.',
      );
    }
  }
  return result.ok ? 0 : 1;
}

function cmdContract(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'validate') {
    const { values } = parse(rest, {
      strict: { type: 'boolean', default: false },
    });
    const projectDir = resolve(values.project);
    const result = loadContract(projectDir);
    const warnings = [...result.warnings];
    const errors = [...result.errors];
    if (values.strict) {
      errors.push(...warnings.splice(0));
    }
    const ok = errors.length === 0;
    printJson(values.json, {
      ok,
      errors,
      warnings,
      contract: result.contract,
    });
    if (!values.json) {
      console.log(
        `Project contract: ${ok ? 'OK' : 'INVALID'} (${errors.length} errors, ${warnings.length} warnings)`,
      );
      for (const error of errors) console.log(`  ✗ ${error}`);
      for (const warning of warnings) console.log(`  ! ${warning}`);
    }
    return ok ? 0 : 1;
  }

  if (sub === 'show') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const contract = readContract(projectDir);
    printJson(values.json, contract);
    if (!values.json) console.log(stringifyYaml(contract));
    return 0;
  }

  if (sub === 'sync') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const contract = readContract(projectDir, { skipHash: true });
    const { project } = loadProject(projectDir);
    project.name = contract.project.name;
    project.type = contract.project.type;
    project.risk_tier = contract.project.risk_tier;
    project.status = contract.project.status;
    project.contract = {
      path: 'AGENTS.md',
      sha256: contractHash(contract),
    };
    project.updated_at = nowIso();
    saveProject(projectDir, project);
    printJson(values.json, {
      ok: true,
      project: {
        name: project.name,
        type: project.type,
        risk_tier: project.risk_tier,
        status: project.status,
      },
      contract: project.contract,
    });
    printHuman(
      values.json,
      'project metadata and contract hash synced to .riccon/project.json',
    );
    return 0;
  }

  fail('usage: riccon contract validate|show|sync');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdState(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'show') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const { state } = loadProject(projectDir);
    printJson(values.json, state);
    if (!values.json) console.log(stringifyYaml(state));
    return 0;
  }

  if (sub !== 'validate') fail('usage: riccon state validate|show');
  const { values } = parse(rest);
  const projectDir = resolve(values.project);
  const errors = [];
  const warnings = [];

  let state = null;
  let modules = [];
  let tasks = [];
  let evidence = [];
  let taskReviews = [];
  try {
    const loaded = loadProject(projectDir);
    state = loaded.state;
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const contractResult = loadContract(projectDir);
    errors.push(...contractResult.errors);
  } catch (error) {
    errors.push(`contract: ${error.message}`);
  }
  try {
    modules = readModules(projectDir);
  } catch (error) {
    errors.push(`modules: ${error.message}`);
  }
  try {
    tasks = readTasks(projectDir);
  } catch (error) {
    errors.push(`tasks: ${error.message}`);
  }
  try {
    evidence = readEvidence(projectDir);
  } catch (error) {
    errors.push(`evidence: ${error.message}`);
  }
  try {
    taskReviews = readTaskReviews(projectDir);
  } catch (error) {
    errors.push(`task reviews: ${error.message}`);
  }

  const moduleIds = new Set(modules.map((module) => module.id));
  const taskIds = new Set(tasks.map((task) => task.id));
  const evidenceIds = new Set(evidence.map((record) => record.id));

  if (state?.current_module && !moduleIds.has(state.current_module)) {
    errors.push(`state.current_module references unknown module ${state.current_module}`);
  }
  for (const [owner, taskId] of Object.entries(state?.active_tasks || {})) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      errors.push(`state.active_tasks.${owner} references unknown task ${taskId}`);
    } else if (task.status !== 'in_progress') {
      errors.push(
        `state.active_tasks.${owner} references ${taskId} with status ${task.status}`,
      );
    } else if (task.owner !== owner) {
      errors.push(
        `state.active_tasks.${owner} references ${taskId}, owned by ${task.owner}`,
      );
    }
  }

  for (const module of modules) {
    for (const taskId of module.tasks || []) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        errors.push(`module ${module.id} references unknown task ${taskId}`);
      } else if (task.module_id !== module.id) {
        errors.push(`task ${taskId} belongs to ${task.module_id}, not ${module.id}`);
      }
    }
    const moduleTasks = tasks.filter((task) => task.module_id === module.id);
    if (['planned', 'blocked'].includes(module.status)) {
      const startedTasks = moduleTasks.filter((task) =>
        ['in_progress', 'review', 'done'].includes(task.status),
      );
      if (startedTasks.length) {
        warnings.push(
          `module ${module.id} is ${module.status} but has started/done tasks: ${startedTasks
            .map((task) => `${task.id}=${task.status}`)
            .join(', ')}; legacy state must be normalized before new work`,
        );
      }
    }
    if (module.status === 'done') {
      const unfinishedTasks = moduleTasks.filter(
        (task) => task.status !== 'done',
      );
      if (unfinishedTasks.length) {
        errors.push(
          `module ${module.id} is done but has unfinished tasks: ${unfinishedTasks
            .map((task) => `${task.id}=${task.status}`)
            .join(', ')}`,
        );
      }
    }
    const acceptance = module.product_acceptance;
    if (acceptance) {
      if (
        acceptance.product_status === 'pass' &&
        !['review_pending', 'done'].includes(module.status)
      ) {
        warnings.push(
          `module ${module.id} has Product pass while ${module.status}; Product pre-acceptance must follow a passing gate and precede done`,
        );
      }
      if (
        ['accepted', 'rejected', 'conditional'].includes(
          acceptance.user_status,
        ) &&
        module.status !== 'done'
      ) {
        warnings.push(
          `module ${module.id} has user acceptance ${acceptance.user_status} before done; legacy state must be reviewed`,
        );
      }
      if (
        acceptance.user_status === 'accepted' &&
        acceptance.product_status !== 'pass'
      ) {
        warnings.push(
          `module ${module.id} has user accepted without Product pass; record the Product re-review before user acceptance`,
        );
      }
      if (
        acceptance.user_status === 'accepted' &&
        acceptance.accepted_at &&
        module.finished_at &&
        Date.parse(acceptance.accepted_at) < Date.parse(module.finished_at)
      ) {
        warnings.push(
          `module ${module.id} user acceptance was recorded before module finish; verify the timeline`,
        );
      }
    }
    if (module.review) {
      const reviewPath = resolve(projectDir, module.review);
      if (!exists(reviewPath)) {
        errors.push(`module ${module.id} review file is missing: ${module.review}`);
      }
    }
    if (
      (module.status === 'done' || module.status === 'review_pending') &&
      !module.review
    ) {
      warnings.push(
        `module ${module.id} is ${module.status} but module.review is not set; the gate will look for reviews/${module.id}-review.md`,
      );
    }
  }

  for (const task of tasks) {
    if (!moduleIds.has(task.module_id)) {
      errors.push(`task ${task.id} references unknown module ${task.module_id}`);
    }
    for (const evidenceId of task.evidence || []) {
      const record = evidence.find((item) => item.id === evidenceId);
      if (!record) {
        errors.push(`task ${task.id} references unknown evidence ${evidenceId}`);
      } else if (record.task_id !== task.id) {
        errors.push(`evidence ${evidenceId} belongs to ${record.task_id}, not ${task.id}`);
      }
    }
  }

  for (const record of evidence) {
    if (!taskIds.has(record.task_id)) {
      errors.push(`evidence ${record.id} references unknown task ${record.task_id}`);
    }
  }

  for (const record of taskReviews) {
    if (record.error) {
      errors.push(record.error);
      continue;
    }
    const data = record.data;
    const task = tasks.find((item) => item.id === data.task_id);
    if (!task) {
      errors.push(
        `task review ${basename(record.file)} references unknown task ${data.task_id}`,
      );
      continue;
    }
    if (task.module_id !== data.module_id) {
      errors.push(
        `task review ${basename(record.file)} binds task ${data.task_id} to ${data.module_id}, but the task belongs to ${task.module_id}`,
      );
    }
    for (const evidenceId of [
      ...(data.evidence || []),
      ...(data.reviewed_evidence || []),
    ]) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(
          `task review ${basename(record.file)} references unknown evidence ${evidenceId}`,
        );
      }
    }
  }

  for (const records of [
    readDecisions(projectDir),
    readReviews(projectDir),
    readHandoffs(projectDir),
  ]) {
    for (const record of records) {
      if (record.error) errors.push(record.error);
    }
  }

  const ok = errors.length === 0;
  printJson(values.json, { ok, errors, warnings });
  if (!values.json) {
    console.log(`State: ${ok ? 'OK' : 'INVALID'} (${errors.length} errors, ${warnings.length} warnings)`);
    for (const error of errors) console.log(`  ✗ ${error}`);
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  return ok ? 0 : 1;
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdModule(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'new') {
    const { values } = parse(rest, {
      id: { type: 'string' },
      title: { type: 'string' },
      goal: { type: 'string' },
      kind: { type: 'string', default: 'feature' },
      'depends-on': { type: 'string', multiple: true, default: [] },
      acceptance: { type: 'string', multiple: true, default: [] },
      'wall-clock-limit': { type: 'string' },
      fixes: { type: 'string' },
      'split-from': { type: 'string' },
      alias: { type: 'string', multiple: true, default: [] },
    });
    if (!values.title) fail('module new requires --title');
    const projectDir = resolve(values.project);
    const module = createModule(projectDir, {
      id: values.id,
      title: values.title,
      goal: values.goal,
      kind: values.kind,
      dependsOn: values['depends-on'],
      acceptance: values.acceptance,
      wallClockLimitHours: values['wall-clock-limit']
        ? Number(values['wall-clock-limit'])
        : undefined,
      fixesModule: values.fixes,
      splitFrom: values['split-from'],
      aliases: values.alias,
    });
    printJson(values.json, { ok: true, module });
    printHuman(values.json, `created module ${module.id}: ${module.title}`);
    return 0;
  }

  if (sub === 'update') {
    const { values, positionals } = parse(rest, {
      status: { type: 'string' },
      blocker: { type: 'string' },
      'clear-blocker': { type: 'boolean', default: false },
      'wall-clock-limit': { type: 'string' },
      review: { type: 'string' },
      fixes: { type: 'string' },
      'split-from': { type: 'string' },
      alias: { type: 'string', multiple: true, default: [] },
      'product-status': { type: 'string' },
      'user-status': { type: 'string' },
      'acceptance-decision': { type: 'string' },
      'acceptance-ref': { type: 'string' },
      'acceptance-note': { type: 'string' },
      force: { type: 'boolean', default: false },
    });
    const moduleId = positionals[0];
    if (!moduleId) fail('module update requires a module id');
    const projectDir = resolve(values.project);
    const productAcceptance =
      values['product-status'] !== undefined ||
      values['user-status'] !== undefined ||
      values['acceptance-decision'] !== undefined ||
      values['acceptance-ref'] !== undefined ||
      values['acceptance-note'] !== undefined
        ? {
            productStatus: values['product-status'],
            userStatus: values['user-status'],
            decisionId: values['acceptance-decision'],
            ref: values['acceptance-ref'],
            note: values['acceptance-note'],
          }
        : undefined;
    const module = updateModule(projectDir, moduleId, {
      status: values.status,
      blocker: values.blocker,
      clearBlocker: values['clear-blocker'],
      wallClockLimitHours: values['wall-clock-limit']
        ? Number(values['wall-clock-limit'])
        : undefined,
      review: values.review,
      fixesModule: values.fixes,
      splitFrom: values['split-from'],
      aliases: values.alias,
      force: values.force,
      productAcceptance,
    });
    printJson(values.json, { ok: true, module });
    printHuman(values.json, `updated module ${module.id}: ${module.status}`);
    return 0;
  }

  if (sub === 'cost') {
    const { values, positionals } = parse(rest, {
      requests: { type: 'string' },
      'input-tokens': { type: 'string' },
      'output-tokens': { type: 'string' },
      'wall-clock-minutes': { type: 'string' },
      'cost-usd': { type: 'string' },
      confidence: { type: 'string', default: 'estimated' },
      source: { type: 'string', default: '' },
      note: { type: 'string', default: '' },
    });
    const moduleId = positionals[0];
    if (!moduleId) fail('module cost requires a module id');
    const projectDir = resolve(values.project);
    const module = recordModuleCost(projectDir, moduleId, {
      requests: values.requests,
      tokensInput: values['input-tokens'],
      tokensOutput: values['output-tokens'],
      wallClockMinutes: values['wall-clock-minutes'],
      costUsd: values['cost-usd'],
      confidence: values.confidence,
      source: values.source,
      note: values.note,
    });
    printJson(values.json, { ok: true, module });
    printHuman(
      values.json,
      `recorded ${module.budget_usage.confidence} budget for ${module.id}: ${module.budget_usage.requests} req, ${module.budget_usage.tokens_input + module.budget_usage.tokens_output} tokens, $${module.budget_usage.cost_usd}`,
    );
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const modules = readModules(projectDir);
    printJson(values.json, { ok: true, modules });
    if (!values.json) {
      for (const module of modules) {
        console.log(
          `${module.id}  ${String(module.kind || 'feature').padEnd(8)} ${String(module.status).padEnd(14)} ${module.tasks.length} task(s)  ${module.title}`,
        );
      }
    }
    return 0;
  }

  if (sub === 'show') {
    const { values, positionals } = parse(rest);
    const moduleId = positionals[0];
    if (!moduleId) fail('module show requires a module id');
    const projectDir = resolve(values.project);
    const module = showModule(projectDir, moduleId);
    printJson(values.json, module);
    if (!values.json) console.log(stringifyYaml(module));
    return 0;
  }

  fail('usage: riccon module new|update|list|show');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdTask(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'new') {
    const { values } = parse(rest, {
      module: { type: 'string' },
      title: { type: 'string' },
      owner: { type: 'string', default: 'riccon/builder' },
      'write-scope': { type: 'string', multiple: true, default: [] },
      acceptance: { type: 'string', multiple: true, default: [] },
    });
    if (!values.module) fail('task new requires --module');
    if (!values.title) fail('task new requires --title');
    const projectDir = resolve(values.project);
    const task = createTask(projectDir, {
      moduleId: values.module,
      title: values.title,
      owner: values.owner,
      writeScope: values['write-scope'],
      acceptance: values.acceptance,
    });
    const warnings = taskSizeWarnings(task);
    printJson(values.json, {
      ok: true,
      task,
      ...(warnings.length ? { warnings } : {}),
    });
    printHuman(values.json, `created task ${task.id} for ${task.module_id}: ${task.title}`);
    for (const warning of warnings) {
      console.error(`warning: ${warning}`);
    }
    return 0;
  }

  if (sub === 'update') {
    const { values, positionals } = parse(rest, {
      status: { type: 'string' },
      owner: { type: 'string' },
      blocker: { type: 'string' },
      'clear-blocker': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      tool: { type: 'string', multiple: true, default: [] },
      'baseline-commit': { type: 'string' },
      'end-commit': { type: 'string' },
    });
    const taskId = positionals[0];
    if (!taskId) fail('task update requires a task id');
    const projectDir = resolve(values.project);
    let task;
    for (const tool of values.tool) {
      task = updateTask(projectDir, taskId, { ...values, tool });
    }
    task = updateTask(projectDir, taskId, {
      status: values.status,
      owner: values.owner,
      blocker: values.blocker,
      clearBlocker: values['clear-blocker'],
      force: values.force,
      baselineCommit: values['baseline-commit'],
      endCommit: values['end-commit'],
    });
    printJson(values.json, { ok: true, task });
    printHuman(values.json, `updated task ${task.id}: ${task.status}`);
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest, {
      module: { type: 'string' },
      status: { type: 'string' },
    });
    const projectDir = resolve(values.project);
    const tasks = listTasks(projectDir, {
      moduleId: values.module,
      status: values.status,
    });
    printJson(values.json, { ok: true, tasks });
    if (!values.json) {
      for (const task of tasks) {
        console.log(
          `${task.id}  ${task.module_id}  ${String(task.status).padEnd(12)} ${task.owner.padEnd(16)} ${task.title}`,
        );
      }
    }
    return 0;
  }

  if (sub === 'show') {
    const { values, positionals } = parse(rest);
    const taskId = positionals[0];
    if (!taskId) fail('task show requires a task id');
    const projectDir = resolve(values.project);
    const task = showTask(projectDir, taskId);
    printJson(values.json, task);
    if (!values.json) console.log(stringifyYaml(task));
    return 0;
  }

  fail('usage: riccon task new|update|list|show');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdEvidence(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'run') {
    const { values, positionals } = parse(rest, {
      task: { type: 'string' },
      agent: { type: 'string' },
      note: { type: 'string' },
    });
    if (!values.task) fail('evidence run requires --task');
    if (!positionals.length) fail('evidence run requires a command after --');
    const projectDir = resolve(values.project);
    const result = runEvidence({
      projectDir,
      taskId: values.task,
      command: positionals.join(' '),
      agent: values.agent,
      note: values.note,
    });
    if (values.json) {
      printJson(true, {
        ok: result.record.exit_code === 0,
        evidence: result.record,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      console.log(
        `recorded ${result.record.id} for ${result.record.task_id} (exit ${result.record.exit_code}, ${result.record.output_bytes} bytes)`,
      );
    }
    return result.record.exit_code === 0 ? 0 : 1;
  }

  if (sub === 'add') {
    const { values } = parse(rest, {
      task: { type: 'string' },
      command: { type: 'string' },
      output: { type: 'string' },
      'exit-code': { type: 'string', default: '0' },
      agent: { type: 'string' },
      note: { type: 'string' },
    });
    if (!values.task) fail('evidence add requires --task');
    if (!values.command) fail('evidence add requires --command');
    if (!values.output) fail('evidence add requires --output');
    const projectDir = resolve(values.project);
    const record = addEvidence({
      projectDir,
      taskId: values.task,
      command: values.command,
      exitCode: Number(values['exit-code']),
      output: values.output,
      agent: values.agent,
      note: values.note,
    });
    printJson(values.json, { ok: true, evidence: record });
    printHuman(
      values.json,
      `recorded ${record.id} for ${record.task_id} (exit ${record.exit_code}, ${record.output_bytes} bytes)`,
    );
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest, { task: { type: 'string' } });
    const projectDir = resolve(values.project);
    const records = listEvidence(projectDir, values.task);
    printJson(values.json, { ok: true, evidence: records });
    if (!values.json) {
      for (const record of records) {
        console.log(
          `${record.id}  ${record.task_id}  exit ${record.exit_code}  ${record.started_at}  ${record.command}`,
        );
      }
    }
    return 0;
  }

  fail('usage: riccon evidence run|add|list');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdDecision(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'new') {
    const { values } = parse(rest, {
      title: { type: 'string' },
      question: { type: 'string' },
      module: { type: 'string' },
      blocking: { type: 'boolean', default: false },
      option: { type: 'string', multiple: true, default: [] },
      recommendation: { type: 'string' },
      consequences: { type: 'string' },
      deadline: { type: 'string' },
      default: { type: 'string' },
      release: { type: 'string' },
      environment: { type: 'string' },
    });
    if (!values.title) fail('decision new requires --title');
    if (!values.question) fail('decision new requires --question');
    const projectDir = resolve(values.project);
    const decision = createDecision(projectDir, {
      title: values.title,
      question: values.question,
      moduleId: values.module || null,
      blocking: values.blocking,
      options: values.option,
      recommendation: values.recommendation,
      consequences: values.consequences,
      deadline: values.deadline || null,
      defaultAnswer: values.default,
      releaseId: values.release || null,
      environment: values.environment || null,
    });
    printJson(values.json, {
      ok: true,
      decision: decision.data,
      file: decision.file,
    });
    printHuman(
      values.json,
      `created ${decision.data.decision_id}: ${decision.file}`,
    );
    return 0;
  }

  if (sub === 'answer') {
    const { values, positionals } = parse(rest, {
      answer: { type: 'string' },
      kind: { type: 'string' },
      release: { type: 'string' },
      environment: { type: 'string' },
    });
    const decisionId = positionals[0];
    if (!decisionId) fail('decision answer requires a decision id');
    if (!values.answer) fail('decision answer requires --answer');
    if (!values.kind) fail('decision answer requires --kind');
    const projectDir = resolve(values.project);
    const decision = answerDecision(projectDir, decisionId, {
      answer: values.answer,
      kind: values.kind,
      releaseId: values.release || null,
      environment: values.environment || null,
    });
    printJson(values.json, {
      ok: true,
      decision: decision.data,
      file: decision.file,
    });
    printHuman(
      values.json,
      `answered ${decision.data.decision_id} (${decision.data.answer_kind})`,
    );
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const decisions = listDecisions(projectDir);
    printJson(values.json, { ok: true, decisions });
    if (!values.json) {
      for (const decision of decisions) {
        console.log(
          `${decision.data?.decision_id || '?'}  ${decision.data?.status || '?'}  ${
            decision.data?.answer_kind || '-'
          }  ${decision.data?.title || ''}`,
        );
      }
    }
    return 0;
  }

  if (sub === 'show') {
    const { values, positionals } = parse(rest);
    const decisionId = positionals[0];
    if (!decisionId) fail('decision show requires a decision id');
    const projectDir = resolve(values.project);
    const decision = showDecision(projectDir, decisionId);
    printJson(values.json, { file: decision.file, decision: decision.data });
    if (!values.json) console.log(stringifyYaml(decision.data));
    return 0;
  }

  fail('usage: riccon decision new|answer|list|show');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdGate(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub !== 'check') fail('usage: riccon gate check --module M01');
  const { values } = parse(rest, {
    module: { type: 'string' },
    'allow-overrun': { type: 'boolean', default: false },
    'require-scope': { type: 'boolean', default: false },
  });
  if (!values.module) fail('gate check requires --module');
  const projectDir = resolve(values.project);
  const result = checkGate({
    projectDir,
    moduleId: values.module,
    allowOverrun: values['allow-overrun'],
    requireScope: values['require-scope'],
  });
  recordGateResult(projectDir, result);
  printJson(values.json, result);
  if (!values.json) console.log(renderGateReport(result));
  return result.ok ? 0 : 1;
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdRelease(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'check') {
    const { values, positionals } = parse(rest, {
      release: { type: 'string' },
      environment: { type: 'string' },
      'require-scope': { type: 'boolean' },
      'legacy-scope': { type: 'boolean', default: false },
    });
    const projectDir = resolve(values.project);
    const result = checkRelease(projectDir, {
      releaseId: values.release || positionals[0],
      environment: values.environment,
      requireScope: values['require-scope'],
      legacyScope: values['legacy-scope'],
    });
    recordReleaseResult(projectDir, result);
    printJson(values.json, result);
    if (!values.json) console.log(renderReleaseReport(result));
    return result.ok ? 0 : 1;
  }

  if (sub === 'new') {
    const { values } = parse(rest, {
      version: { type: 'string' },
      environment: { type: 'string' },
      scope: { type: 'string' },
      'threat-model': { type: 'string' },
      'load-test': { type: 'string' },
      'rollback-drill': { type: 'string' },
      runbook: { type: 'string' },
      evidence: { type: 'string', multiple: true, default: [] },
    });
    if (!values.version) fail('release new requires --version');
    if (!values.environment) fail('release new requires --environment');
    if (!values.scope) fail('release new requires --scope');
    if (!['sandbox', 'staging', 'production'].includes(values.environment)) {
      fail('release new --environment must be sandbox, staging or production');
    }
    const projectDir = resolve(values.project);
    const release = createRelease({
      projectDir,
      version: values.version,
      environment: values.environment,
      scope: values.scope,
      artifacts: {
        threat_model: values['threat-model'] || '',
        load_test: values['load-test'] || '',
        rollback_drill: values['rollback-drill'] || '',
        runbook: values.runbook || '',
      },
      evidence: values.evidence,
    });
    printJson(values.json, { ok: true, release: release.data, file: release.file });
    printHuman(values.json, `created ${release.data.id}: ${release.file}`);
    return 0;
  }

  if (sub === 'approve') {
    const { values, positionals } = parse(rest, {
      decision: { type: 'string' },
      'second-review-model': { type: 'string' },
      'second-review-path': { type: 'string' },
    });
    const releaseId = positionals[0];
    if (!releaseId) fail('release approve requires a release id');
    if (!values.decision) fail('release approve requires --decision');
    const projectDir = resolve(values.project);
    const release = approveRelease(projectDir, releaseId, values.decision, {
      secondReviewModel: values['second-review-model'],
      secondReviewPath: values['second-review-path'],
    });
    printJson(values.json, { ok: true, release: release.data, file: release.file });
    printHuman(values.json, `approved ${release.data.id} by ${release.data.approval.decision_id}`);
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const releases = listReleases(projectDir);
    printJson(values.json, { ok: true, releases });
    if (!values.json) {
      for (const release of releases) {
        console.log(
          `${release.data?.id || '?'}  ${release.data?.version || '?'}  ${
            release.data?.environment || '?'
          }  ${release.data?.status || '?'}  ${release.data?.scope || ''}`,
        );
      }
    }
    return 0;
  }

  if (sub === 'show') {
    const { values, positionals } = parse(rest);
    const releaseId = positionals[0];
    if (!releaseId) fail('release show requires a release id');
    const projectDir = resolve(values.project);
    const release = showRelease(projectDir, releaseId);
    printJson(values.json, { file: release.file, release: release.data });
    if (!values.json) console.log(stringifyYaml(release.data));
    return 0;
  }

  fail('usage: riccon release check|new|approve|list|show');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdSandbox(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub !== 'check') fail('usage: riccon sandbox check');
  const { values } = parse(rest);
  const projectDir = resolve(values.project);
  const result = checkSandbox(projectDir);
  printJson(values.json, result);
  if (!values.json) console.log(renderSandboxReport(result));
  return result.ok ? 0 : 1;
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdHandoff(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'new') {
    const { values } = parse(rest, {
      session: { type: 'string' },
      summary: { type: 'string' },
      next: { type: 'string' },
      invariant: { type: 'string', multiple: true, default: [] },
      risk: { type: 'string', multiple: true, default: [] },
      'first-read': { type: 'string', multiple: true, default: [] },
    });
    const projectDir = resolve(values.project);
    const handoff = createHandoff({
      projectDir,
      session: values.session,
      summary: values.summary,
      next: values.next,
      invariants: values.invariant,
      risks: values.risk,
      firstRead: values['first-read'],
    });
    printJson(values.json, { ok: true, handoff: handoff.data, file: handoff.file });
    printHuman(values.json, `created ${handoff.data.handoff_id}: ${handoff.file}`);
    return 0;
  }

  if (sub === 'list') {
    const { values } = parse(rest);
    const projectDir = resolve(values.project);
    const handoffs = listHandoffs(projectDir);
    printJson(values.json, { ok: true, handoffs });
    if (!values.json) {
      for (const handoff of handoffs) {
        console.log(
          `${handoff.data?.handoff_id || '?'}  ${basename(handoff.file)}  ${handoff.data?.created_at || ''}  ${handoff.data?.summary || ''}`,
        );
      }
    }
    return 0;
  }

  if (sub === 'show') {
    const { values, positionals } = parse(rest);
    const handoffId = positionals[0];
    if (!handoffId) fail('handoff show requires a handoff id');
    const projectDir = resolve(values.project);
    const handoff = showHandoff(projectDir, handoffId);
    printJson(values.json, { file: handoff.file, handoff: handoff.data });
    if (!values.json) console.log(stringifyYaml(handoff.data));
    return 0;
  }

  fail('usage: riccon handoff new|list|show');
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdStatus(args) {
  const { values } = parse(args);
  const projectDir = resolve(values.project);
  const status = getStatus(projectDir);
  printJson(values.json, status);
  if (!values.json) console.log(renderStatus(status));
  return 0;
}

/**
 * @param {string[]} args
 * @returns {number}
 */
function cmdDoctor(args) {
  const { values } = parse(args);
  const result = runDoctor(TEAM_ROOT);
  printJson(values.json, result);
  if (!values.json) {
    console.log(
      `Riccon doctor: ${result.ok ? 'OK' : 'FAIL'} (${result.errors.length} errors, ${result.warnings.length} warnings)`,
    );
    for (const check of result.checks) {
      const mark = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
      console.log(`  ${mark} ${check.message}`);
    }
  }
  return result.ok ? 0 : 1;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }
  if (command === '--version' || command === '-v') {
    console.log(TEAM_VERSION);
    return 0;
  }

  try {
    switch (command) {
      case 'init':
        return cmdInit(rest);
      case 'adopt':
        return cmdAdopt(rest);
      case 'upgrade':
        return cmdUpgrade(rest);
      case 'contract':
        return cmdContract(rest);
      case 'state':
        return cmdState(rest);
      case 'module':
        return cmdModule(rest);
      case 'task':
        return cmdTask(rest);
      case 'evidence':
        return cmdEvidence(rest);
      case 'decision':
        return cmdDecision(rest);
      case 'gate':
        return cmdGate(rest);
      case 'release':
        return cmdRelease(rest);
      case 'sandbox':
        return cmdSandbox(rest);
      case 'handoff':
        return cmdHandoff(rest);
      case 'status':
        return cmdStatus(rest);
      case 'doctor':
        return cmdDoctor(rest);
      default:
        fail(`unknown command "${command}"; run \`riccon --help\``);
    }
  } catch (error) {
    const wantsJson = argv.includes('--json');
    if (error instanceof RicconError) {
      if (wantsJson) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              error: error.message,
              code: error.code,
              details: error.details,
            },
            null,
            2,
          ),
        );
      } else {
        console.error(`error: ${error.message}`);
      }
      if (process.env.RICCON_DEBUG) console.error(error.stack);
      return 1;
    }
    if (wantsJson) {
      console.log(
        JSON.stringify({ ok: false, error: error.message }, null, 2),
      );
    } else {
      console.error(`error: ${error.message}`);
    }
    if (process.env.RICCON_DEBUG) console.error(error.stack);
    return 1;
  }
}

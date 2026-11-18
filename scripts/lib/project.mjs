import { basename, join } from 'node:path';
import {
  ensureDir,
  exists,
  listDir,
  listFilesRecursive,
  readJson,
  readText,
  writeJson,
} from './fsx.mjs';
import { assertSchema, validateSchema } from './schema.mjs';
import { parseFrontmatter } from './yamlx.mjs';
import { fail } from './errors.mjs';

/**
 * @param {string} projectDir
 */
export function projectPaths(projectDir) {
  const riccon = join(projectDir, '.riccon');
  return {
    projectDir,
    riccon,
    projectJson: join(riccon, 'project.json'),
    stateJson: join(riccon, 'state.json'),
    modules: join(riccon, 'modules'),
    tasks: join(riccon, 'tasks'),
    decisions: join(riccon, 'decisions'),
    evidence: join(riccon, 'evidence'),
    reviews: join(riccon, 'reviews'),
    taskReviews: join(riccon, 'reviews', 'tasks'),
    releases: join(riccon, 'releases'),
    handoffs: join(riccon, 'handoffs'),
    runs: join(riccon, 'runs'),
    archive: join(riccon, 'archive'),
    agentsMd: join(projectDir, 'AGENTS.md'),
  };
}

/**
 * @param {ReturnType<typeof projectPaths>} paths
 */
export function ensureProjectDirs(paths) {
  for (const dir of [
    paths.riccon,
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
    ensureDir(dir);
  }
}

/**
 * @param {string} projectDir
 */
export function requireProject(projectDir) {
  const paths = projectPaths(projectDir);
  if (!exists(paths.projectJson)) {
    fail(`no .riccon/project.json in ${projectDir}; run \`riccon init\` first`, {
      code: 'ERR_NOT_INITIALIZED',
    });
  }
  return paths;
}

/**
 * @param {string} projectDir
 * @returns {{ projectDir: string, paths: ReturnType<typeof projectPaths>, project: any, state: any }}
 */
export function loadProject(projectDir) {
  const paths = requireProject(projectDir);
  const project = readJson(paths.projectJson);
  const state = readJson(paths.stateJson);
  validateProjectMeta(project);
  assertSchema('state.schema.json', state, 'state.json');
  return { projectDir, paths, project, state };
}

/**
 * @param {any} project
 */
export function validateProjectMeta(project) {
  const errors = [];
  if (project?.schema_version !== 1) errors.push('schema_version must be 1');
  if (!project?.name) errors.push('name is required');
  if (!project?.type) errors.push('type is required');
  if (!project?.risk_tier) errors.push('risk_tier is required');
  if (!project?.status) errors.push('status is required');
  if (errors.length) {
    fail(`invalid project.json: ${errors.join('; ')}`, {
      code: 'ERR_PROJECT',
      details: errors,
    });
  }
}

/**
 * @param {string} projectDir
 * @param {any} state
 */
export function saveState(projectDir, state) {
  const paths = projectPaths(projectDir);
  assertSchema('state.schema.json', state, 'state.json');
  writeJson(paths.stateJson, state);
}

/**
 * @param {string} projectDir
 * @param {any} project
 */
export function saveProject(projectDir, project) {
  const paths = projectPaths(projectDir);
  validateProjectMeta(project);
  writeJson(paths.projectJson, project);
}

/**
 * @param {string} dir
 * @param {string} schemaName
 * @param {string} label
 * @returns {any[]}
 */
export function readJsonRecords(dir, schemaName, label) {
  const records = [];
  for (const file of listDir(dir, (name) => name.endsWith('.json'))) {
    const record = readJson(file);
    assertSchema(schemaName, record, `${label} ${basename(file)}`);
    records.push(record);
  }
  return records;
}

/**
 * @param {string} dir
 * @param {string} schemaName
 * @param {string} label
 * @param {(name: string) => boolean} [predicate]
 * @returns {{ file: string, data: any | null, body: string, error: string | null }[]}
 */
export function readMarkdownRecords(
  dir,
  schemaName,
  label,
  predicate = (name) => name.endsWith('.md'),
) {
  const records = [];
  for (const file of listDir(dir, predicate)) {
    let parsed;
    try {
      parsed = parseFrontmatter(readText(file));
    } catch (error) {
      records.push({
        file,
        data: null,
        body: '',
        error: `${label} ${basename(file)} has invalid YAML front matter: ${error.message}`,
      });
      continue;
    }
    if (!parsed.hasFrontmatter) {
      records.push({
        file,
        data: null,
        body: parsed.body,
        error: `${label} ${basename(file)} is missing YAML front matter`,
      });
      continue;
    }
    const check = validateSchema(schemaName, parsed.data);
    records.push({
      file,
      data: parsed.data,
      body: parsed.body,
      error: check.valid ? null : `${label} ${basename(file)}: ${check.errors.join('; ')}`,
    });
  }
  return records;
}

/** @param {string} projectDir */
export function readModules(projectDir) {
  return readJsonRecords(
    projectPaths(projectDir).modules,
    'module.schema.json',
    'module',
  );
}

/** @param {string} projectDir */
export function readTasks(projectDir) {
  return readJsonRecords(
    projectPaths(projectDir).tasks,
    'task.schema.json',
    'task',
  );
}

/** @param {string} projectDir */
export function readEvidence(projectDir) {
  const dir = projectPaths(projectDir).evidence;
  const records = [];
  for (const file of listFilesRecursive(dir, (name) => /EV-[0-9]+\.json$/.test(name))) {
    const record = readJson(file);
    assertSchema('evidence.schema.json', record, `evidence ${basename(file)}`);
    records.push(record);
  }
  return records;
}

/** @param {string} projectDir */
export function readDecisions(projectDir) {
  return readMarkdownRecords(
    projectPaths(projectDir).decisions,
    'decision.schema.json',
    'decision',
  );
}

/**
 * 读取模块评审；任务级评审在 reviews/tasks/，不能进入模块 gate。
 *
 * @param {string} projectDir
 */
export function readReviews(projectDir) {
  const records = readMarkdownRecords(
    projectPaths(projectDir).reviews,
    'review.schema.json',
    'review',
  );
  for (const record of records) {
    if (record.data?.task_id && record.error) {
      record.error = `${record.error}; task-level reviews belong in .riccon/reviews/tasks/`;
    }
  }
  return records;
}

/**
 * 读取任务级/架构级独立评审。
 *
 * @param {string} projectDir
 */
export function readTaskReviews(projectDir) {
  return readMarkdownRecords(
    projectPaths(projectDir).taskReviews,
    'task-review.schema.json',
    'task review',
    (name) => name.endsWith('.md') && name !== 'README.md',
  );
}

/** @param {string} projectDir */
export function readReleases(projectDir) {
  return readMarkdownRecords(
    projectPaths(projectDir).releases,
    'release.schema.json',
    'release',
  );
}

/** @param {string} projectDir */
export function readHandoffs(projectDir) {
  return readMarkdownRecords(
    projectPaths(projectDir).handoffs,
    'handoff.schema.json',
    'handoff',
  );
}

/**
 * @param {string} prefix
 * @param {string[]} ids
 * @param {number} [width]
 * @returns {string}
 */
export function nextId(prefix, ids, width = 4) {
  let max = 0;
  for (const id of ids) {
    const match = String(id).match(/([0-9]+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

/**
 * @param {string} moduleId
 * @param {any[]} modules
 * @returns {any}
 */
export function getModuleOrFail(moduleId, modules) {
  const module = modules.find((item) => item.id === moduleId);
  if (!module) fail(`module ${moduleId} not found`, { code: 'ERR_MODULE_NOT_FOUND' });
  return module;
}

/**
 * @param {string} taskId
 * @param {any[]} tasks
 * @returns {any}
 */
export function getTaskOrFail(taskId, tasks) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) fail(`task ${taskId} not found`, { code: 'ERR_TASK_NOT_FOUND' });
  return task;
}

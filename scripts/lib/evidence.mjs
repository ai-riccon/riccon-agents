import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  ensureDir,
  exists,
  readText,
  sha256,
  slugify,
  writeJson,
  writeText,
} from "./fsx.mjs";
import { assertSchema } from "./schema.mjs";
import { nowIso, timestampSlug } from "./time.mjs";
import { fail } from "./errors.mjs";
import {
  getTaskOrFail,
  loadProject,
  nextId,
  readEvidence,
  readTasks,
  saveState,
} from "./project.mjs";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null}
 */
function gitValue(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

/**
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitRepo(cwd) {
  return gitValue(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * @param {string} cwd
 * @returns {{ commit: string | null, dirty: boolean }}
 */
function repoPrefix(cwd) {
  return gitValue(cwd, ["rev-parse", "--show-prefix"]) || "";
}

function normalizeRepoPath(cwd, file) {
  const prefix = repoPrefix(cwd);
  if (!prefix) return file;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}

export function gitSnapshot(cwd) {
  if (!isGitRepo(cwd)) return { commit: null, dirty: false };
  const status = gitValue(cwd, ["status", "--porcelain"]);
  const dirty = String(status || "")
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      normalizeRepoPath(
        cwd,
        line
          .replace(/^\s*[ MADRCU?!]{1,2}\s+/, "")
          .trim()
          .replace(/^"|"$/g, ""),
      ),
    )
    .filter(Boolean)
    .some(
      (file) =>
        !file.startsWith(".riccon/") &&
        !file.startsWith(".codegraph/") &&
        !file.startsWith("node_modules/") &&
        file !== ".gitignore" &&
        !file.endsWith(".DS_Store"),
    );
  return {
    commit: gitValue(cwd, ["rev-parse", "HEAD"]),
    dirty,
  };
}

/**
 * @param {string} cwd
 * @param {string} commit
 * @returns {boolean}
 */
export function isAncestor(cwd, commit) {
  if (!commit) return false;
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", commit, "HEAD"],
    {
      cwd,
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

/**
 * @param {string} cwd
 * @param {string} ancestor
 * @param {string} descendant
 * @returns {boolean}
 */
export function isAncestorOf(cwd, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { cwd, encoding: 'utf8' },
  );
  return result.status === 0;
}

/**
 * @param {string} cwd
 * @param {string} commit
 * @returns {boolean}
 */
export function gitCommitExists(cwd, commit) {
  if (!commit) return false;
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`],
    { cwd, encoding: "utf8" },
  );
  return result.status === 0;
}

/**
 * @param {string} cwd
 * @param {string} baseline
 * @returns {string[]}
 */
export function gitChangedFiles(cwd, baseline, end = null) {
  if (!isGitRepo(cwd) || !baseline) return [];
  const changed = new Set();
  const prefix = repoPrefix(cwd);
  const normalize = (file) => {
    const trimmed = file.trim();
    if (!trimmed) return null;
    if (!prefix) return trimmed;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
  };
  const range = end ? `${baseline}..${end}` : baseline;
  const tracked = gitValue(cwd, ["diff", "--name-only", range, "--"]);
  for (const file of String(tracked || "").split("\n")) {
    const normalized = normalize(file);
    if (normalized) changed.add(normalized);
  }
  if (!end) {
    const untracked = gitValue(cwd, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    for (const file of String(untracked || "").split("\n")) {
      const normalized = normalize(file);
      if (normalized) changed.add(normalized);
    }
  }
  return [...changed].filter(
    (file) =>
      !file.startsWith(".riccon/") &&
      !file.startsWith(".codegraph/") &&
      !file.startsWith("node_modules/") &&
      file !== ".gitignore" &&
      !file.endsWith(".DS_Store"),
  );
}

/**
 * @param {{
 *   projectDir: string,
 *   taskId: string,
 *   command: string,
 *   exitCode: number,
 *   outputText: string,
 *   agent?: string,
 *   note?: string,
 *   startedAt: string,
 *   finishedAt: string,
 *   durationMs: number,
 *   cwd?: string,
 *   manual?: boolean,
 *   git?: { commit: string | null, dirty: boolean }
 * }} input
 * @returns {any}
 */
function recordEvidence(input) {
  const { state, paths } = loadProject(input.projectDir);
  const tasks = readTasks(input.projectDir);
  const task = getTaskOrFail(input.taskId, tasks);
  const existing = readEvidence(input.projectDir);
  const id = nextId(
    "EV",
    existing.map((record) => record.id),
    4,
  );
  const taskDir = join(paths.evidence, task.id);
  ensureDir(taskDir);

  const slug = slugify(input.command);
  const outputFile = join(taskDir, `${id}-${timestampSlug()}-${slug}.log`);
  writeText(outputFile, input.outputText);
  const outputText = readText(outputFile);
  const outputPath = relative(input.projectDir, outputFile);

  const record = {
    schema_version: 1,
    id,
    task_id: task.id,
    command: input.command,
    manual: Boolean(input.manual),
    commit: input.git?.commit || null,
    dirty: Boolean(input.git?.dirty),
    exit_code: input.exitCode,
    output_path: outputPath,
    output_sha256: sha256(outputText),
    output_bytes: Buffer.byteLength(outputText, "utf8"),
    agent: input.agent || "unknown",
    cwd: input.cwd || input.projectDir,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: input.durationMs,
    note: input.note || "",
    recorded_at: nowIso(),
  };
  assertSchema("evidence.schema.json", record, `evidence ${id}`);
  writeJson(join(taskDir, `${id}.json`), record);

  task.evidence = [...new Set([...(task.evidence || []), id])];
  task.updated_at = nowIso();
  assertSchema("task.schema.json", task, `task ${task.id}`);
  writeJson(join(paths.tasks, `${task.id}.json`), task);

  state.next_action = `Evidence ${id} recorded for ${task.id}.`;
  state.updated_at = nowIso();
  saveState(input.projectDir, state);

  return record;
}

/**
 * @param {{ projectDir: string, taskId: string, command: string, agent?: string, note?: string }} input
 * @returns {{ record: any, stdout: string, stderr: string }}
 */
export function runEvidence(input) {
  const projectDir = resolve(input.projectDir);
  const tasks = readTasks(projectDir);
  getTaskOrFail(input.taskId, tasks);

  const startedAt = nowIso();
  const start = Date.now();
  const result = spawnSync(input.command, {
    shell: true,
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;
  const finishedAt = nowIso();
  const stdout = result.stdout || "";
  const stderr = result.stderr || result.error?.message || "";
  const exitCode = typeof result.status === "number" ? result.status : 1;

  const outputText = [
    `# command: ${input.command}`,
    `# cwd: ${projectDir}`,
    `# started_at: ${startedAt}`,
    `# finished_at: ${finishedAt}`,
    `# duration_ms: ${durationMs}`,
    `# exit_code: ${exitCode}`,
    "",
    "# --- stdout ---",
    stdout.trimEnd(),
    "",
    "# --- stderr ---",
    stderr.trimEnd(),
    "",
  ].join("\n");

  const record = recordEvidence({
    projectDir,
    taskId: input.taskId,
    command: input.command,
    exitCode,
    outputText,
    agent: input.agent,
    note: input.note,
    startedAt,
    finishedAt,
    durationMs,
    cwd: projectDir,
    manual: false,
    git: gitSnapshot(projectDir),
  });

  return { record, stdout, stderr };
}

/**
 * @param {{ projectDir: string, taskId: string, command: string, exitCode: number, output: string, agent?: string, note?: string }} input
 * @returns {any}
 */
export function addEvidence(input) {
  const projectDir = resolve(input.projectDir);
  const outputPath = resolve(process.cwd(), input.output);
  if (!exists(outputPath)) {
    fail(`evidence output file not found: ${outputPath}`, {
      code: "ERR_EVIDENCE_OUTPUT",
    });
  }
  const outputText = readText(outputPath);
  const startedAt = nowIso();
  return recordEvidence({
    projectDir,
    taskId: input.taskId,
    command: input.command,
    exitCode: input.exitCode,
    outputText,
    agent: input.agent,
    note: input.note,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    cwd: process.cwd(),
    manual: true,
  });
}

/**
 * @param {string} projectDir
 * @param {string} [taskId]
 * @returns {any[]}
 */
export function listEvidence(projectDir, taskId) {
  return readEvidence(projectDir).filter(
    (record) => !taskId || record.task_id === taskId,
  );
}

/**
 * 重算证据输出，防止手改日志或伪造记录。
 *
 * @param {string} projectDir
 * @param {any} record
 * @param {{ taskId?: string, requireAncestor?: boolean, requireClean?: boolean, requireCommit?: boolean }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyEvidenceRecord(projectDir, record, options = {}) {
  const errors = [];
  if (options.taskId && record.task_id !== options.taskId) {
    errors.push(
      `evidence ${record.id} belongs to ${record.task_id}, not ${options.taskId}`,
    );
  }
  if (!record.output_path) {
    errors.push(`evidence ${record.id} has no output_path`);
    return { ok: false, errors };
  }

  const outputPath = resolve(projectDir, record.output_path);
  const rel = relative(projectDir, outputPath);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    errors.push(
      `evidence ${record.id} output escapes the project: ${record.output_path}`,
    );
    return { ok: false, errors };
  }
  if (!exists(outputPath)) {
    errors.push(
      `evidence ${record.id} output is missing: ${record.output_path}`,
    );
    return { ok: false, errors };
  }

  const text = readText(outputPath);
  const commandHeader = text.match(/^# command: (.*)$/m);
  const exitHeader = text.match(/^# exit_code: (-?[0-9]+)\s*$/m);
  if (record.manual !== true) {
    if (!commandHeader) {
      errors.push(`evidence ${record.id} log has no # command header`);
    } else if (commandHeader[1].trim() !== record.command.trim()) {
      errors.push(
        `evidence ${record.id} command does not match its log header`,
      );
    }
    if (!exitHeader) {
      errors.push(`evidence ${record.id} log has no # exit_code header`);
    } else if (Number(exitHeader[1]) !== record.exit_code) {
      errors.push(
        `evidence ${record.id} exit_code does not match its log header`,
      );
    }
  } else if (
    commandHeader &&
    commandHeader[1].trim() !== record.command.trim()
  ) {
    errors.push(`evidence ${record.id} command does not match its log header`);
  }
  const actualHash = sha256(text);
  const actualBytes = Buffer.byteLength(text, "utf8");
  if (actualHash !== record.output_sha256) {
    errors.push(
      `evidence ${record.id} output hash mismatch: expected ${record.output_sha256}, got ${actualHash}`,
    );
  }
  if (actualBytes !== record.output_bytes) {
    errors.push(
      `evidence ${record.id} output bytes mismatch: expected ${record.output_bytes}, got ${actualBytes}`,
    );
  }

  const git = isGitRepo(projectDir);
  if (options.requireCommit && git && record.manual !== true && !record.commit) {
    errors.push(`evidence ${record.id} has no git commit attestation`);
  }
  if (
    options.requireCommit &&
    record.manual !== true &&
    typeof record.dirty !== "boolean"
  ) {
    errors.push(
      `evidence ${record.id} has no dirty flag; a strict check requires it`,
    );
  }
  if (record.commit) {
    if (!git) {
      if (options.requireAncestor) {
        errors.push(
          `evidence ${record.id} has commit ${record.commit} but ${projectDir} is not a git repository`,
        );
      }
    } else if (
      options.requireAncestor &&
      !isAncestor(projectDir, record.commit)
    ) {
      errors.push(
        `evidence ${record.id} commit ${record.commit} is not an ancestor of HEAD`,
      );
    }
    if (options.requireClean && record.dirty === true) {
      errors.push(
        `evidence ${record.id} was recorded from a dirty working tree at ${record.commit}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {any[]} records
 * @returns {any[]}
 */
export function runRecords(records) {
  return records.filter((record) => record.manual !== true);
}

/**
 * @param {any[]} records
 * @returns {any | null}
 */
export function latestRun(records) {
  const runs = runRecords(records).sort(
    (a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at),
  );
  return runs[runs.length - 1] || null;
}

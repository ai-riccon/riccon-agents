import { fail } from "./errors.mjs";
import {
  gitChangedFiles,
  gitCommitExists,
  isAncestor,
  isAncestorOf,
  isGitRepo,
} from "./evidence.mjs";

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

/**
 * @param {string[]} writeScope
 * @param {string[]} files
 * @returns {string[]}
 */
export function filesOutsideScope(writeScope, files) {
  if (!writeScope.length) return files;
  const patterns = writeScope.map(globToRegExp);
  return files.filter(
    (file) => !patterns.some((pattern) => pattern.test(file)),
  );
}

/**
 * @param {string} projectDir
 * @param {any} task
 */
export function writeScopeErrors(projectDir, task) {
  if (!isGitRepo(projectDir)) {
    return task.baseline_commit || task.end_commit
      ? [
          `task ${task.id} records git commits but the project is not a git repository; cannot verify write_scope`,
        ]
      : [];
  }
  if (!task.baseline_commit) return [];
  if (task.status === "done" && !task.end_commit) {
    return [
      `task ${task.id} is done without end_commit; cannot verify write_scope`,
    ];
  }
  if (!gitCommitExists(projectDir, task.baseline_commit)) {
    return [
      `task ${task.id} baseline ${task.baseline_commit} does not exist; cannot verify write_scope`,
    ];
  }
  if (!isAncestor(projectDir, task.baseline_commit)) {
    return [
      `task ${task.id} baseline ${task.baseline_commit} is not an ancestor of HEAD; cannot verify write_scope`,
    ];
  }
  const end = task.status === "done" ? task.end_commit : null;
  if (end) {
    if (!gitCommitExists(projectDir, end)) {
      return [
        `task ${task.id} end_commit ${end} does not exist; cannot verify write_scope`,
      ];
    }
    if (!isAncestor(projectDir, end)) {
      return [
        `task ${task.id} end_commit ${end} is not an ancestor of HEAD; cannot verify write_scope`,
      ];
    }
    if (!isAncestorOf(projectDir, task.baseline_commit, end)) {
      return [
        `task ${task.id} end_commit ${end} is not a descendant of baseline ${task.baseline_commit}; cannot verify write_scope`,
      ];
    }
  }
  const files = gitChangedFiles(projectDir, task.baseline_commit, end);
  const outside = filesOutsideScope(task.write_scope || [], files);
  return outside.length
    ? [
        `task ${task.id} changed files outside write_scope: ${outside.join(", ")}`,
      ]
    : [];
}

/**
 * 项目级“未认领变更”检查：done 任务的 end_commit 之后提交的文件，
 * 必须落在全项目任一任务的 write_scope 内。用于捕获 end_commit 之后的
 * 已提交越界改动，而不是只看任务自己的历史区间。
 *
 * @param {string} projectDir
 * @param {any[]} tasks
 * @returns {string[]}
 */
export function unclaimedScopeErrors(projectDir, tasks) {
  if (!isGitRepo(projectDir)) return [];
  const withEnd = tasks.filter((task) => task.end_commit);
  if (!withEnd.length) return [];
  const patterns = tasks
    .flatMap((task) => task.write_scope || [])
    .map(globToRegExp);
  const seen = new Set();
  const errors = [];
  for (const task of withEnd) {
    if (!gitCommitExists(projectDir, task.end_commit)) continue;
    for (const file of gitChangedFiles(projectDir, task.end_commit, "HEAD")) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (!patterns.some((pattern) => pattern.test(file))) {
        errors.push(
          `file ${file} changed after task ${task.id} end_commit ${task.end_commit} is outside every task write_scope`,
        );
      }
    }
  }
  return errors;
}

/**
 * @param {string} projectDir
 * @param {any} task
 */
export function enforceWriteScope(projectDir, task) {
  const errors = writeScopeErrors(projectDir, task);
  if (errors.length) {
    fail(errors.join("; "), { code: "ERR_WRITE_SCOPE" });
  }
}

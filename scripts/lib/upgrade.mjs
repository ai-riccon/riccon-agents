import { join } from "node:path";
import { exists, readText, writeText } from "./fsx.mjs";
import { loadProject, saveProject } from "./project.mjs";
import { TEMPLATES_DIR } from "./paths.mjs";
import { TEAM_VERSION } from "./version.mjs";
import { nowIso } from "./time.mjs";
import { fail } from "./errors.mjs";

const TEAM_START = "<!-- riccon:team:start -->";
const TEAM_END = "<!-- riccon:team:end -->";
const LEGACY_HEADING = "## 协作约定";
const TEAM_DOCS = ["docs/COLLABORATION.md"];

/**
 * @param {string} text
 * @param {string} start
 * @param {string} end
 * @returns {string | null}
 */
function extractBlock(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from === -1 || to === -1) return null;
  return text.slice(from, to + end.length);
}

/**
 * @param {string} text
 * @param {string} block
 * @returns {string}
 */
function replaceBlock(text, block) {
  const from = text.indexOf(TEAM_START);
  const to = text.indexOf(TEAM_END, from);
  if (from === -1 || to === -1) return text;
  return `${text.slice(0, from)}${block}${text.slice(to + TEAM_END.length)}`;
}

/**
 * 把旧的 `## 协作约定` 整段保留到 `## 项目补充`，不删除项目特定规则。
 *
 * @param {string} text
 * @param {string} block
 * @returns {string | null}
 */
function adoptLegacySection(text, block) {
  const index = text.search(/^##\s+协作约定\s*$/m);
  if (index === -1) return null;
  const after = text.slice(index + 1);
  const next = after.search(/^##\s+/m);
  const end = next === -1 ? text.length : index + 1 + next;
  const legacy = text.slice(index, end).trim();
  const prefix = text.slice(0, index).trimEnd();
  const suffix = text.slice(end).trimStart();
  const supplement = [
    "## 项目补充",
    "",
    "以下内容来自迁移前的 `## 协作约定`，保留项目特定规则；请人工删除已由团队区块覆盖的条目。",
    "",
    legacy.replace(/^##\s+协作约定\s*$/m, "### 迁移前协作约定").trim(),
  ].join("\n");
  return (
    [prefix, block, supplement, suffix].filter(Boolean).join("\n\n") + "\n"
  );
}

/**
 * 同步团队管理的 AGENTS 区块和模板文档。默认 dry-run；只有显式 write 才落盘。
 *
 * @param {string} projectDir
 * @param {{ write?: boolean, adoptLegacy?: boolean }} [options]
 * @returns {any}
 */
export function upgradeProject(projectDir, options = {}) {
  const write = Boolean(options.write);
  const adoptLegacy = Boolean(options.adoptLegacy);
  const { project } = loadProject(projectDir);
  const fromVersion = project.team_version || null;
  const agentsPath = join(projectDir, "AGENTS.md");
  if (!exists(agentsPath)) fail("AGENTS.md is missing; cannot upgrade project");
  const agents = readText(agentsPath);

  const template = readText(join(TEMPLATES_DIR, "project", "AGENTS.md"));
  const block = extractBlock(template, TEAM_START, TEAM_END);
  if (!block) {
    fail("templates/project/AGENTS.md has no managed team block");
  }

  const hasBlock = agents.includes(TEAM_START) && agents.includes(TEAM_END);
  let nextAgents = agents;
  let mode = "noop";
  if (hasBlock) {
    nextAgents = replaceBlock(agents, block);
    mode = nextAgents === agents ? "noop" : "replace";
  } else if (adoptLegacy) {
    const migrated = adoptLegacySection(agents, block);
    if (!migrated) {
      return {
        ok: false,
        project_dir: projectDir,
        mode: "manual",
        message:
          "AGENTS.md has no managed team block and no `## 协作约定` section; add the block manually from templates/project/AGENTS.md",
        docs: [],
        version: { from: fromVersion, to: TEAM_VERSION },
      };
    }
    nextAgents = migrated;
    mode = "adopt-legacy";
  } else {
    return {
      ok: false,
      project_dir: projectDir,
      mode: "manual",
      message:
        "AGENTS.md has no managed team block; rerun with --adopt-legacy after reviewing the diff, or add the block manually from templates/project/AGENTS.md",
      docs: [],
      version: { from: fromVersion, to: TEAM_VERSION },
    };
  }

  const docs = TEAM_DOCS.map((relativePath) => {
    const target = join(projectDir, relativePath);
    return {
      path: relativePath,
      action: exists(target) ? "keep" : "create",
    };
  });

  if (!write) {
    return {
      ok: true,
      project_dir: projectDir,
      mode,
      dry_run: true,
      docs,
      version: { from: fromVersion, to: TEAM_VERSION },
    };
  }

  if (mode !== "noop") writeText(agentsPath, nextAgents);
  for (const doc of docs) {
    if (doc.action !== "create") continue;
    const source = join(TEMPLATES_DIR, "project", doc.path);
    if (!exists(source)) {
      fail(`template doc is missing: templates/project/${doc.path}`);
    }
    writeText(join(projectDir, doc.path), readText(source));
  }
  if (project.team_version !== TEAM_VERSION) {
    project.team_version = TEAM_VERSION;
    project.updated_at = nowIso();
    saveProject(projectDir, project);
  }

  return {
    ok: true,
    project_dir: projectDir,
    mode,
    dry_run: false,
    docs,
    version: { from: fromVersion, to: TEAM_VERSION },
  };
}

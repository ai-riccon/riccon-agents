#!/usr/bin/env node
import { join, basename } from "node:path";
import { listDir, readText, writeText } from "./lib/fsx.mjs";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  parseYaml,
} from "./lib/yamlx.mjs";
import { AGENTS_DIR, TEMPLATES_DIR } from "./lib/paths.mjs";

const permissionsTemplate = parseYaml(
  readText(join(TEMPLATES_DIR, "agents", "permissions.yml")),
);
const modelsTemplate = parseYaml(
  readText(join(TEMPLATES_DIR, "agents", "models.yml")),
);
const stepsTemplate = modelsTemplate.steps || {};
const agentDir = join(AGENTS_DIR, "riccon");
const files = listDir(agentDir, (name) => name.endsWith(".md"));

for (const file of files) {
  const role = basename(file, ".md");
  const parsed = parseFrontmatter(readText(file));
  if (!parsed.hasFrontmatter) {
    console.error(`skip ${file}: no front matter`);
    continue;
  }
  const rolePermissions =
    role === "lead" ? permissionsTemplate.lead : permissionsTemplate.subagent;
  const permissions = [
    ...(permissionsTemplate.base || []),
    ...(rolePermissions || []),
  ];
  const data = { ...parsed.data, permissions };
  if (modelsTemplate[role]) data.model = modelsTemplate[role];
  if (Number.isInteger(stepsTemplate[role])) data.steps = stepsTemplate[role];
  writeText(file, stringifyFrontmatter(data, parsed.body));
  console.log(
    `synced ${basename(file)} (${permissions.length} rules, model=${data.model}, steps=${data.steps})`,
  );
}

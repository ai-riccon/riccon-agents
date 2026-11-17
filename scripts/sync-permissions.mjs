#!/usr/bin/env node
import { join, basename } from 'node:path';
import { listDir, readText, writeText } from './lib/fsx.mjs';
import { parseFrontmatter, stringifyFrontmatter, parseYaml } from './lib/yamlx.mjs';
import { AGENTS_DIR, TEMPLATES_DIR } from './lib/paths.mjs';

const template = parseYaml(
  readText(join(TEMPLATES_DIR, 'agents', 'permissions.yml')),
);
const agentDir = join(AGENTS_DIR, 'riccon');
const files = listDir(agentDir, (name) => name.endsWith('.md'));

for (const file of files) {
  const role = basename(file, '.md');
  const parsed = parseFrontmatter(readText(file));
  if (!parsed.hasFrontmatter) {
    console.error(`skip ${file}: no front matter`);
    continue;
  }
  const rolePermissions = role === 'lead' ? template.lead : template.subagent;
  const permissions = [...(template.base || []), ...(rolePermissions || [])];
  const data = { ...parsed.data, permissions };
  writeText(file, stringifyFrontmatter(data, parsed.body));
  console.log(`synced ${basename(file)} (${permissions.length} rules)`);
}

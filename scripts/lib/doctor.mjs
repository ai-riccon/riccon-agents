import { readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  exists,
  isDirectory,
  listDir,
  listFilesRecursive,
  readJson,
  readText,
} from './fsx.mjs';
import { parseFrontmatter, parseYaml } from './yamlx.mjs';

const EXPECTED_AGENTS = ['lead', 'product', 'architect', 'builder', 'verifier', 'ops'];
const MIN_STEPS = {
  lead: 150,
  product: 80,
  architect: 100,
  builder: 200,
  verifier: 130,
  ops: 100,
};
const EXPECTED_COMMANDS = [
  'riccon-start',
  'riccon-status',
  'riccon-plan',
  'riccon-review',
  'riccon-decision',
  'riccon-resume',
  'riccon-release',
];
const EXPECTED_SKILLS = [
  'riccon-core',
  'riccon-contract',
  'riccon-verify',
  'riccon-docs',
];

const FORBIDDEN_STACK_TERMS =
  /\b(java|spring|maven|gradle|react|vue|angular|svelte|django|rails|laravel|dotnet|postgres|mysql|mongodb)\b/i;

/**
 * 递归查找目录名；跳过 .git/node_modules。
 * 用于发现 `.ricon`（一个 c）这类状态目录拼写错误。
 *
 * @param {string} root
 * @param {string} name
 * @returns {string[]}
 */
function findDirectories(root, name) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.name === name) found.push(full);
      visit(full);
    }
  };
  visit(root);
  return found;
}

/**
 * @param {string} teamRoot
 * @returns {{ ok: boolean, errors: string[], warnings: string[], checks: { id: string, status: 'pass'|'warn'|'fail', message: string }[] }}
 */
export function runDoctor(teamRoot) {
  const errors = [];
  const warnings = [];
  const checks = [];

  const repoLayout = exists(join(teamRoot, '.opencode'));
  const schemasDir = join(teamRoot, 'schemas');
  const templatesDir = join(teamRoot, 'templates');
  const agentDir = repoLayout
    ? join(teamRoot, '.opencode', 'agents', 'riccon')
    : join(teamRoot, '..', 'agents', 'riccon');
  const commandDir = repoLayout
    ? join(teamRoot, '.opencode', 'commands')
    : join(teamRoot, '..', 'commands');
  const skillsDir = repoLayout
    ? join(teamRoot, '.opencode', 'skills')
    : join(teamRoot, '..', 'skills');

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

  // 状态目录拼写：`.ricon`（一个 c）不是有效状态目录。
  const strayStateDirs = findDirectories(teamRoot, '.ricon');
  if (strayStateDirs.length) {
    add(
      'state-dir-typo',
      'fail',
      `found .ricon (one c) directory; use .ricon: ${strayStateDirs
        .map((dir) => relative(teamRoot, dir))
        .join(', ')}`,
    );
  }

  // Schema
  const schemaFiles = listDir(schemasDir, (name) => name.endsWith('.schema.json'));
  if (schemaFiles.length < 9) {
    add('schemas', 'fail', `expected at least 9 schemas, found ${schemaFiles.length}`);
  } else {
    add('schemas', 'pass', `${schemaFiles.length} schemas found`);
  }
  for (const file of schemaFiles) {
    try {
      readJson(file);
    } catch (error) {
      add('schema-parse', 'fail', `${relative(teamRoot, file)}: ${error.message}`);
    }
  }

  // Agent 定义
  const permissionsTemplate = parseYaml(
    readText(join(templatesDir, 'agents', 'permissions.yml')),
  );
  const agentFiles = listDir(agentDir, (name) => name.endsWith('.md'));
  add('agents', 'pass', `${agentFiles.length} agent definition(s) found`);

  for (const role of EXPECTED_AGENTS) {
    if (!agentFiles.some((file) => basename(file, '.md') === role)) {
      add('agent-missing', 'fail', `missing agent riccon/${role}.md`);
    }
  }

  for (const file of agentFiles) {
    const role = basename(file, '.md');
    const display = relative(teamRoot, file);
    const parsed = parseFrontmatter(readText(file));
    if (!parsed.hasFrontmatter) {
      add('agent-frontmatter', 'fail', `${display} has no front matter`);
      continue;
    }
    const data = parsed.data;
    if (!data.description) add('agent-description', 'fail', `${display} has no description`);
    if (!data.mode) add('agent-mode', 'fail', `${display} has no mode`);
    if (!Array.isArray(data.permissions)) {
      add('agent-permissions', 'fail', `${display} has no permissions array`);
      continue;
    }

    const expectedRole = role === 'lead' ? 'lead' : 'subagent';
    const expectedPermissions = [
      ...(permissionsTemplate.base || []),
      ...(permissionsTemplate[expectedRole] || []),
    ];
    if (!isDeepStrictEqual(data.permissions, expectedPermissions)) {
      add(
        'agent-permissions-sync',
        'fail',
        `${display} permissions are out of sync; run \`npm run sync:permissions\``,
      );
    }

    if (role === 'lead' && data.mode !== 'primary') {
      add('agent-mode', 'fail', `${display} must be mode primary`);
    }
    if (role !== 'lead' && data.mode !== 'subagent') {
      add('agent-mode', 'fail', `${display} must be mode subagent`);
    }

    const minSteps = MIN_STEPS[role];
    if (minSteps && (!Number.isInteger(data.steps) || data.steps < minSteps)) {
      add(
        'agent-steps',
        'fail',
        `${display} steps must be an integer >= ${minSteps} (found ${data.steps})`,
      );
    }

    const rules = data.permissions;
    const denies = rules.filter((rule) => rule.effect === 'deny');
    for (const rule of denies) {
      if (!['subagent', 'question'].includes(rule.action)) {
        add(
          'agent-deny',
          'fail',
          `${display} denies ${rule.action}:${rule.resource}; only subagent/question may be denied`,
        );
      }
    }

    if (role === 'lead') {
      if (
        !rules.some(
          (rule) =>
            rule.action === 'subagent' &&
            rule.resource === 'riccon/*' &&
            rule.effect === 'allow',
        )
      ) {
        add('agent-subagent', 'fail', `${display} must allow subagent riccon/*`);
      }
      if (
        !rules.some(
          (rule) =>
            rule.action === 'question' &&
            rule.resource === '*' &&
            rule.effect === 'allow',
        )
      ) {
        add('agent-question', 'fail', `${display} must allow question *`);
      }
    } else {
      if (
        !rules.some(
          (rule) =>
            rule.action === 'subagent' &&
            rule.resource === '*' &&
            rule.effect === 'deny',
        )
      ) {
        add('agent-subagent', 'fail', `${display} must deny subagent *`);
      }
      if (
        !rules.some(
          (rule) =>
            rule.action === 'question' &&
            rule.resource === '*' &&
            rule.effect === 'deny',
        )
      ) {
        add('agent-question', 'fail', `${display} must deny question *`);
      }
    }

    for (const action of ['read', 'edit', 'shell']) {
      const broadIndex = rules.findIndex(
        (rule) =>
          rule.action === action && rule.resource === '*' && rule.effect === 'allow',
      );
      const firstAsk = rules.findIndex(
        (rule) => rule.action === action && rule.effect === 'ask',
      );
      if (broadIndex === -1) {
        add('agent-broad-allow', 'fail', `${display} must allow ${action} *`);
      } else if (firstAsk !== -1 && broadIndex > firstAsk) {
        add(
          'agent-ask-order',
          'fail',
          `${display} has an ask rule before the broad ${action} allow; last-match would override it`,
        );
      }
    }

    const has = (action, resource, effect = 'ask') =>
      rules.some(
        (rule) =>
          rule.action === action &&
          rule.resource === resource &&
          rule.effect === effect,
      );

    for (const [action, resource] of [
      ['read', '.env'],
      ['read', '**/.env'],
      ['read', '**/.env.*'],
      ['edit', 'AGENTS.md'],
      ['edit', '.opencode/**'],
      ['edit', '.git/**'],
      ['external_directory', '*'],
    ]) {
      if (!has(action, resource)) {
        add(
          'agent-required-ask',
          'fail',
          `${display} is missing ask rule ${action}:${resource}`,
        );
      }
    }

    for (const resource of [
      'rm *',
      'git push *',
      'docker system prune*',
      '*DROP TABLE*',
      'npm publish*',
    ]) {
      if (!has('shell', resource)) {
        add(
          'agent-destructive-ask',
          'fail',
          `${display} is missing destructive ask rule shell:${resource}`,
        );
      }
    }
  }

  // 命令
  const commandFiles = listDir(commandDir, (name) => /^riccon-.*\.md$/.test(name));
  add('commands', 'pass', `${commandFiles.length} command definition(s) found`);
  for (const name of EXPECTED_COMMANDS) {
    if (!commandFiles.some((file) => basename(file, '.md') === name)) {
      add('command-missing', 'fail', `missing command ${name}.md`);
    }
  }
  for (const file of commandFiles) {
    const display = relative(teamRoot, file);
    const parsed = parseFrontmatter(readText(file));
    if (!parsed.hasFrontmatter) add('command-frontmatter', 'fail', `${display} has no front matter`);
    if (!parsed.data?.description) {
      add('command-description', 'fail', `${display} has no description`);
    }
    if (!parsed.body.trim()) add('command-body', 'fail', `${display} has an empty body`);
  }

  // Skill
  const skillDirs = listDir(
    skillsDir,
    (name) => name.startsWith('riccon-') && isDirectory(join(skillsDir, name)),
  );
  add('skills', 'pass', `${skillDirs.length} skill definition(s) found`);
  for (const name of EXPECTED_SKILLS) {
    if (!skillDirs.some((dir) => basename(dir) === name)) {
      add('skill-missing', 'fail', `missing skill ${name}`);
    }
  }
  for (const dir of skillDirs) {
    const file = join(dir, 'SKILL.md');
    const display = relative(teamRoot, file);
    if (!exists(file)) {
      add('skill-file', 'fail', `${relative(teamRoot, dir)} has no SKILL.md`);
      continue;
    }
    const parsed = parseFrontmatter(readText(file));
    if (!parsed.hasFrontmatter) add('skill-frontmatter', 'fail', `${display} has no front matter`);
    if (!parsed.data?.name) add('skill-name', 'fail', `${display} has no name`);
    if (!parsed.data?.description) add('skill-description', 'fail', `${display} has no description`);
    if (!parsed.body.trim()) add('skill-body', 'fail', `${display} has an empty body`);
  }

  // 技术栈独立性检查
  const scanDirs = [agentDir, commandDir, skillsDir];
  const scanFiles = listFilesRecursive(scanDirs[0], (file) => file.endsWith('.md'));
  scanFiles.push(...listFilesRecursive(scanDirs[1], (file) => file.endsWith('.md')));
  scanFiles.push(...listFilesRecursive(scanDirs[2], (file) => file.endsWith('.md')));
  const templateAgents = join(templatesDir, 'project', 'AGENTS.md');
  if (exists(templateAgents)) scanFiles.push(templateAgents);

  for (const file of scanFiles) {
    const text = readText(file);
    const match = text.match(FORBIDDEN_STACK_TERMS);
    if (match) {
      add(
        'stack-independence',
        'fail',
        `${relative(teamRoot, file)} hardcodes stack term "${match[0]}"; move it to the project AGENTS.md contract`,
      );
    }
  }

  // 项目模板合同区块
  if (!exists(templateAgents)) {
    add('template-project', 'fail', 'templates/project/AGENTS.md is missing');
  } else {
    const text = readText(templateAgents);
    if (!text.includes('<!-- riccon:contract:start -->')) {
      add(
        'template-contract',
        'fail',
        'templates/project/AGENTS.md is missing the managed contract block',
      );
    }
    if (!/evidence_binding:\s*strict/.test(text)) {
      add(
        'template-evidence-binding',
        'fail',
        'templates/project/AGENTS.md must set quality.evidence_binding: strict',
      );
    }
  }

  const templateReview = join(teamRoot, 'templates', 'state', 'review.md');
  if (!exists(templateReview)) {
    add('template-review', 'fail', 'templates/state/review.md is missing');
  } else if (!readText(templateReview).includes('dod_evidence:')) {
    add(
      'template-review-binding',
      'fail',
      'templates/state/review.md must document dod_evidence for strict DoD binding',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}

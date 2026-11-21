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
import { TEAM_VERSION } from './version.mjs';

const EXPECTED_AGENTS = ['lead', 'product', 'architect', 'builder', 'verifier', 'ops'];
const EXPECTED_COMMANDS = [
  'riccon-start',
  'riccon-status',
  'riccon-plan',
  'riccon-review',
  'riccon-decision',
  'riccon-resume',
  'riccon-release',
  'riccon-improve',
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
      `found .ricon (one c) directory; use .riccon: ${strayStateDirs
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

  // 版本号：version.mjs 为源；仓库里再校验 package 文件和文档，安装目录缺失时跳过。
  const versionSource = readText(
    join(teamRoot, 'scripts', 'lib', 'version.mjs'),
  );
  const versionMatch = versionSource.match(
    /TEAM_VERSION\s*=\s*['"]([^'"]+)['"]/,
  );
  /** @type {Record<string, string | undefined>} */
  const versionValues = {
    'version.mjs': versionMatch?.[1],
  };
  if (exists(join(teamRoot, 'package.json'))) {
    versionValues['package.json'] = readJson(
      join(teamRoot, 'package.json'),
    ).version;
  }
  if (exists(join(teamRoot, 'package-lock.json'))) {
    const packageLock = readJson(join(teamRoot, 'package-lock.json'));
    versionValues['package-lock.json'] = packageLock.version;
    versionValues['package-lock.json packages'] =
      packageLock.packages?.['']?.version;
  }
  for (const [file, value] of Object.entries(versionValues)) {
    if (value !== TEAM_VERSION) {
      add(
        'version',
        'fail',
        `${file} version is ${value || '(missing)'}; expected ${TEAM_VERSION}`,
      );
    }
  }
  for (const [file, pattern] of [
    ['README.md', /当前版本：`([^`]+)`/],
    ['AGENTS.md', /当前版本：`([^`]+)`/],
    ['CHANGELOG.md', /^##\s+([0-9]+\.[0-9]+\.[0-9]+)/m],
  ]) {
    if (!exists(join(teamRoot, file))) continue;
    const text = readText(join(teamRoot, file));
    const match = text.match(pattern);
    if (match?.[1] !== TEAM_VERSION) {
      add(
        'version-docs',
        'fail',
        `${file} version is ${match?.[1] || '(missing)'}; expected ${TEAM_VERSION}`,
      );
    }
  }

  // Agent 定义
  const permissionsTemplate = parseYaml(
    readText(join(templatesDir, 'agents', 'permissions.yml')),
  );
  const modelsTemplate = parseYaml(
    readText(join(templatesDir, 'agents', 'models.yml')),
  );
  const stepsTemplate = modelsTemplate.steps || {};
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
        `${display} permissions are out of sync; run \`npm run sync:agents\``,
      );
    }

    if (role === 'lead' && data.mode !== 'primary') {
      add('agent-mode', 'fail', `${display} must be mode primary`);
    }
    if (role !== 'lead' && data.mode !== 'subagent') {
      add('agent-mode', 'fail', `${display} must be mode subagent`);
    }

    const expectedModel = modelsTemplate[role];
    if (expectedModel && data.model !== expectedModel) {
      add(
        'agent-model-sync',
        'fail',
        `${display} model is ${data.model || '(missing)'}; expected ${expectedModel} from templates/agents/models.yml; run \`npm run sync:agents\``,
      );
    }
    const expectedSteps = stepsTemplate[role];
    if (!Number.isInteger(expectedSteps)) {
      add(
        'agent-steps-template',
        'fail',
        `templates/agents/models.yml steps.${role} must be an integer`,
      );
    } else if (data.steps !== expectedSteps) {
      add(
        'agent-steps',
        'fail',
        `${display} steps is ${data.steps}; expected ${expectedSteps} from templates/agents/models.yml; run \`npm run sync:agents\``,
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
      ['edit', '$HOME/.config/opencode/riccon/*'],
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

  // 技术栈独立性检查：只扫描团队管理的 agent/command/skill，忽略用户安装的其他 skills。
  const scanFiles = listFilesRecursive(agentDir, (file) =>
    file.endsWith('.md'),
  );
  scanFiles.push(
    ...listFilesRecursive(
      commandDir,
      (file) =>
        file.endsWith('.md') &&
        basename(file).startsWith('riccon-'),
    ),
  );
  scanFiles.push(
    ...listFilesRecursive(skillsDir, (file) => {
      if (!file.endsWith('.md')) return false;
      const relativePath = relative(skillsDir, file);
      return relativePath.split(/[\\/]/)[0].startsWith('riccon-');
    }),
  );
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

  // 并行 builder 的 owner 约定：lead prompt 和任务模板必须能表达实例级 owner。
  const leadAgent = join(agentDir, 'lead.md');
  if (exists(leadAgent) && !/(唯一 owner|builder-<)/.test(readText(leadAgent))) {
    add(
      'owner-instance-convention',
      'warn',
      'lead.md should document unique owner ids for parallel builder instances (e.g. riccon/builder-b2)',
    );
  }
  const templateTask = join(templatesDir, 'state', 'task.json');
  if (exists(templateTask) && !readText(templateTask).includes('riccon/builder-')) {
    add(
      'template-task-owner',
      'warn',
      'templates/state/task.json should demonstrate an instance owner (riccon/builder-*)',
    );
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
    if (
      !text.includes('<!-- riccon:team:start -->') ||
      !text.includes('<!-- riccon:team:end -->')
    ) {
      add(
        'template-team-block',
        'fail',
        'templates/project/AGENTS.md must keep the managed team block markers',
      );
    }
    if (!text.includes('docs/COLLABORATION.md')) {
      add(
        'template-collaboration-index',
        'fail',
        'templates/project/AGENTS.md must index docs/COLLABORATION.md',
      );
    }
  }

  const templateCollaboration = join(
    teamRoot,
    'templates',
    'project',
    'docs',
    'COLLABORATION.md',
  );
  if (!exists(templateCollaboration)) {
    add(
      'template-collaboration',
      'fail',
      'templates/project/docs/COLLABORATION.md is missing',
    );
  }

  const templateModule = join(teamRoot, 'templates', 'state', 'module.json');
  if (!exists(templateModule)) {
    add('template-module', 'fail', 'templates/state/module.json is missing');
  } else if (!readText(templateModule).includes('product_acceptance')) {
    add(
      'template-module-acceptance',
      'fail',
      'templates/state/module.json must include product_acceptance',
    );
  }

  const templateReview = join(teamRoot, 'templates', 'state', 'review.md');
  if (!exists(templateReview)) {
    add('template-review', 'fail', 'templates/state/review.md is missing');
  } else {
    const text = readText(templateReview);
    if (!text.includes('dod_evidence:')) {
      add(
        'template-review-binding',
        'fail',
        'templates/state/review.md must document dod_evidence for strict DoD binding',
      );
    }
    if (!text.includes('reviewed_task_reviews:')) {
      add(
        'template-review-task-coverage',
        'fail',
        'templates/state/review.md must document reviewed_task_reviews for task review coverage',
      );
    } else {
      add(
        'template-review-task-coverage',
        'pass',
        'templates/state/review.md documents reviewed_task_reviews',
      );
    }
  }

  const templateTaskReview = join(teamRoot, 'templates', 'state', 'task-review.md');
  if (!exists(templateTaskReview)) {
    add('template-task-review', 'fail', 'templates/state/task-review.md is missing');
  } else if (!readText(templateTaskReview).includes('task_id:')) {
    add(
      'template-task-review-binding',
      'fail',
      'templates/state/task-review.md must document task_id for task review binding',
    );
  }

  const templateReleaseReview = join(
    teamRoot,
    'templates',
    'state',
    'release-review.md',
  );
  if (!exists(templateReleaseReview)) {
    add(
      'template-release-review',
      'fail',
      'templates/state/release-review.md is missing',
    );
  } else {
    const text = readText(templateReleaseReview);
    let valid = true;
    if (!text.includes('module_id: RELEASE')) {
      valid = false;
      add(
        'template-release-review-module',
        'fail',
        'templates/state/release-review.md must use module_id: RELEASE',
      );
    }
    if (!text.includes('reviewed_evidence:')) {
      valid = false;
      add(
        'template-release-review-evidence',
        'fail',
        'templates/state/release-review.md must document reviewed_evidence',
      );
    }
    if (valid) {
      add(
        'template-release-review',
        'pass',
        'templates/state/release-review.md is present',
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}

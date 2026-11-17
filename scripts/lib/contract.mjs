import { join, resolve } from 'node:path';
import { exists, readJson, readText, sha256, writeText } from './fsx.mjs';
import { parseYaml, stringifyYaml } from './yamlx.mjs';
import { validateSchema } from './schema.mjs';
import { fail } from './errors.mjs';

export const CONTRACT_START = '<!-- riccon:contract:start -->';
export const CONTRACT_END = '<!-- riccon:contract:end -->';

// 旧合同缺 definition_of_done 时的保守回退，故意不含 coverage；
// 新项目由 defaultContract 写入包含 coverage 的显式列表。
export const DEFAULT_MODULE_DOD = [
  'acceptance',
  'build',
  'tests',
  'e2e',
  'review',
  'docs',
  'evidence',
];

/**
 * @param {string} text
 * @returns {{ yamlText: string, kind: 'markers' | 'heading' } | null}
 */
export function extractContractBlock(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(CONTRACT_START);
  const end = normalized.indexOf(CONTRACT_END, Math.max(0, start));
  if (start !== -1 && end !== -1) {
    const raw = normalized.slice(start + CONTRACT_START.length, end);
    return { yamlText: stripFence(raw), kind: 'markers' };
  }

  const heading = normalized.match(/^##\s+Project Contract\s*$/im);
  if (!heading || heading.index === undefined) return null;
  const after = normalized.slice(heading.index + heading[0].length);
  const fence = after.match(/```(?:ya?ml)?[^\n]*\n([\s\S]*?)```/i);
  if (!fence) return null;
  return { yamlText: fence[1].trim(), kind: 'heading' };
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripFence(text) {
  const lines = text.trim().split('\n');
  if (lines.length > 0 && /^```/.test(lines[0].trim())) lines.shift();
  if (lines.length > 0 && /^```/.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n').trim();
}

/**
 * @param {{ name: string, type: string, riskTier: string, status?: string }} input
 * @returns {any}
 */
export function defaultContract({
  name,
  type,
  riskTier,
  status = 'greenfield',
  evidenceBinding = 'strict',
}) {
  return {
    contract_version: 1,
    project: {
      name,
      type,
      risk_tier: riskTier,
      status,
    },
    product: {
      goal: '',
      users: [],
      mvc: '',
      non_goals: [],
      success_metrics: [],
      module_roadmap: [],
    },
    stack: {
      languages: [],
      frameworks: [],
      runtime: '',
      database: '',
      package_manager: '',
      versions: {},
      subprojects: [],
    },
    repo_map: {
      source: [],
      tests: [],
      docs: 'docs',
      infra: '',
      contracts: '',
    },
    commands: {
      install: '',
      build: '',
      lint: '',
      typecheck: '',
      test: '',
      test_e2e: '',
      coverage: '',
      run: '',
      deploy_preview: '',
      deploy_prod: '',
      sandbox: '',
    },
    sandbox: {
      required: false,
      runtime: '',
      network: '',
      mounts: [],
      secrets: '',
      limits: {},
      evidence: '',
    },
    tools: {
      required: [],
      optional: [],
      mcp: [],
      fallback:
        'Record the degradation in task evidence and ask the user before changing scope.',
    },
    environments: {
      local: '',
      preview: '',
      sandbox: '',
      production: '',
    },
    integrations: {
      auth: '',
      payments: '',
      email: '',
      storage: '',
      external_apis: [],
    },
    data: {
      pii: false,
      retention: '',
      migrations: '',
    },
    constraints: {
      style: '',
      security: '',
      performance: '',
      accessibility: '',
      coverage: { line: 80, branch: 70 },
      licensing: '',
      compliance: [],
    },
    coding_standard: {
      path: 'docs/CODING-STANDARDS.md',
      owner: 'riccon/architect',
      comments: 'zh-CN',
    },
    quality: {
      evidence_binding: evidenceBinding,
    },
    definition_of_done: {
      module: [
        'acceptance',
        'build',
        'tests',
        'coverage',
        'e2e',
        'review',
        'docs',
        'evidence',
      ],
      release: ['build', 'tests', 'e2e', 'security', 'rollback', 'approval'],
    },
    decision_owners: {
      product: 'user',
      ux: 'user',
      architecture: 'user',
      production: 'user',
      spending: 'user',
      destructive: 'user',
    },
    budget: {
      tokens: 'none',
      wall_clock: '8h/module, 3d/mvc',
      cost: 'visible',
    },
  };
}

/**
 * @param {any} contract
 * @param {{ projectDir?: string }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function semanticContractCheck(contract, options = {}) {
  const errors = [];
  const warnings = [];
  const commands = contract.commands || {};
  const tier = contract.project?.risk_tier || 'T3';
  const requiredCommands =
    tier === 'T3' || tier === 'T4'
      ? ['install', 'build', 'test']
      : ['build', 'test'];

  for (const key of requiredCommands) {
    if (!commands[key]) {
      warnings.push(`commands.${key} is empty (${tier} expects this command)`);
    }
  }
  if (tier === 'T4' && !commands.test_e2e) {
    warnings.push('commands.test_e2e is empty (T4 expects end-to-end verification)');
  }
  if (tier === 'T4') {
    if (contract.sandbox?.required !== true) {
      warnings.push('sandbox.required is not true (T4 expects an isolated runtime)');
    }
    if (!contract.sandbox?.runtime) {
      warnings.push('sandbox.runtime is empty (T4 expects Docker/VM/firejail/etc.)');
    }
    if (!commands.sandbox) {
      warnings.push('commands.sandbox is empty (T4 expects a reproducible sandbox command)');
    }
  }
  if (!contract.product?.goal) warnings.push('product.goal is empty');
  if (!contract.product?.mvc) warnings.push('product.mvc is empty');
  if (!contract.stack?.languages?.length) warnings.push('stack.languages is empty');
  if (!contract.definition_of_done?.module?.length) {
    warnings.push('definition_of_done.module is empty; default module DoD will be used');
  }

  const toolIds = [...(contract.tools?.required || []), ...(contract.tools?.optional || [])]
    .map((tool) => (typeof tool === 'string' ? tool : tool?.id))
    .filter(Boolean);
  const duplicateToolIds = [...new Set(toolIds.filter((id, index) => toolIds.indexOf(id) !== index))];
  if (duplicateToolIds.length) {
    errors.push(`duplicate tool ids: ${duplicateToolIds.join(', ')}`);
  }

  const mcpIds = contract.tools?.mcp || [];
  const duplicateMcpIds = [...new Set(mcpIds.filter((id, index) => mcpIds.indexOf(id) !== index))];
  if (duplicateMcpIds.length) {
    errors.push(`duplicate mcp tools: ${duplicateMcpIds.join(', ')}`);
  }

  const roadmap = contract.product?.module_roadmap || [];
  const roadmapIds = roadmap.map((item) => item?.id).filter(Boolean);
  const duplicateRoadmapIds = [
    ...new Set(roadmapIds.filter((id, index) => roadmapIds.indexOf(id) !== index)),
  ];
  if (duplicateRoadmapIds.length) {
    errors.push(`duplicate module roadmap ids: ${duplicateRoadmapIds.join(', ')}`);
  }

  if (options.projectDir) {
    const paths = [
      ...(contract.repo_map?.source || []),
      ...(contract.repo_map?.tests || []),
      contract.repo_map?.docs,
      contract.repo_map?.infra,
      contract.repo_map?.contracts,
    ].filter(Boolean);
    for (const path of paths) {
      if (!exists(resolve(options.projectDir, path))) {
        warnings.push(`repo_map path does not exist yet: ${path}`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * @param {string} projectDir
 * @returns {{ contract: any | null, errors: string[], warnings: string[], agentsPath: string, block: any | null }}
 */
export function loadContract(projectDir, options = {}) {
  const agentsPath = join(projectDir, 'AGENTS.md');
  if (!exists(agentsPath)) {
    return {
      contract: null,
      errors: ['AGENTS.md not found; run `riccon init` first'],
      warnings: [],
      agentsPath,
      block: null,
    };
  }

  const text = readText(agentsPath);
  const block = extractContractBlock(text);
  if (!block) {
    return {
      contract: null,
      errors: [
        'Project Contract block not found in AGENTS.md; run `riccon init` or add a `## Project Contract` YAML block',
      ],
      warnings: [],
      agentsPath,
      block: null,
    };
  }

  let data;
  try {
    data = parseYaml(block.yamlText);
  } catch (error) {
    return {
      contract: null,
      errors: [`invalid Project Contract YAML: ${error.message}`],
      warnings: [],
      agentsPath,
      block,
    };
  }

  const schema = validateSchema('contract.schema.json', data);
  const semantic = semanticContractCheck(data || {}, { projectDir });
  const errors = [...schema.errors, ...semantic.errors];
  const warnings = [...semantic.warnings];

  const projectJson = join(projectDir, '.riccon', 'project.json');
  if (!options.skipHash && exists(projectJson)) {
    try {
      const project = readJson(projectJson);
      const expected = project?.contract?.sha256;
      if (expected) {
        const actual = contractHash(data);
        if (actual !== expected) {
          errors.push(
            `contract sha256 mismatch: project.json records ${expected}, AGENTS.md is ${actual}; run \`riccon contract sync\``,
          );
        }
      }
    } catch (error) {
      errors.push(`cannot verify contract sha256: ${error.message}`);
    }
  }

  return {
    contract: data,
    errors,
    warnings,
    agentsPath,
    block,
  };
}

/**
 * @param {string} projectDir
 * @returns {any}
 */
export function readContract(projectDir, options = {}) {
  const result = loadContract(projectDir, options);
  if (!result.contract || result.errors.length) {
    fail(`invalid project contract: ${result.errors.join('; ')}`, {
      code: 'ERR_CONTRACT',
      details: result.errors,
    });
  }
  return result.contract;
}

/**
 * @param {any} contract
 * @returns {string}
 */
export function contractHash(contract) {
  return sha256(stringifyYaml(contract));
}

/**
 * @param {any} contract
 * @returns {string}
 */
export function contractYaml(contract) {
  return stringifyYaml(contract);
}

/**
 * @param {string} agentsPath
 * @param {any} contract
 */
export function writeContractBlock(agentsPath, contract) {
  const blockText = `${CONTRACT_START}\n\`\`\`yaml\n${contractYaml(contract)}\n\`\`\`\n${CONTRACT_END}`;
  const existing = exists(agentsPath) ? readText(agentsPath) : '';
  const normalized = existing.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(CONTRACT_START);
  const end = normalized.indexOf(CONTRACT_END, Math.max(0, start));

  if (start !== -1 && end !== -1) {
    const next =
      normalized.slice(0, start) +
      blockText +
      normalized.slice(end + CONTRACT_END.length);
    writeText(agentsPath, next.endsWith('\n') ? next : `${next}\n`);
    return;
  }

  const heading = normalized.match(/^##\s+Project Contract\s*$/im);
  if (heading && heading.index !== undefined) {
    const before = normalized.slice(0, heading.index).trimEnd();
    const afterHeading = normalized.slice(heading.index + heading[0].length);
    const fence = afterHeading.match(/```(?:ya?ml)?[^\n]*\n[\s\S]*?```/i);
    const after =
      fence && fence.index !== undefined
        ? afterHeading.slice(fence.index + fence[0].length).replace(/^\n+/, '')
        : afterHeading.replace(/^\n+/, '');
    const head = before ? `${before}\n\n` : '';
    const tail = after ? `\n\n${after}` : '';
    const next = `${head}## Project Contract\n\n${blockText}${tail}`.trimEnd() + '\n';
    writeText(agentsPath, next);
    return;
  }

  const prefix = normalized.trim()
    ? `${normalized.trimEnd()}\n\n`
    : `# ${contract.project?.name || 'Project'} — Agent Instructions\n\n`;
  writeText(agentsPath, `${prefix}## Project Contract\n\n${blockText}\n`);
}

/**
 * @param {any} contract
 * @returns {string[]}
 */
export function moduleDod(contract) {
  const configured = contract?.definition_of_done?.module;
  if (Array.isArray(configured) && configured.length) return configured;
  return [...DEFAULT_MODULE_DOD];
}

/**
 * 返回 DoD 证据绑定模式。旧合同没有 `quality` 时按 `legacy` 处理，
 * 由 gate 产生警告而不是直接失败，给存量项目一个显式迁移窗口。
 *
 * @param {any} contract
 * @returns {'strict' | 'legacy'}
 */
export function evidenceBinding(contract) {
  return contract?.quality?.evidence_binding === 'strict' ? 'strict' : 'legacy';
}

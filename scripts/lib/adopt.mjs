import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  exists,
  isDirectory,
  listDir,
  listFilesRecursive,
  readJson,
  readText,
  sha256,
  writeText,
} from './fsx.mjs';
import { nowIso } from './time.mjs';
import {
  contractHash,
  defaultContract,
  loadContract,
  writeContractBlock,
} from './contract.mjs';
import {
  ensureProjectDirs,
  projectPaths,
  saveProject,
  saveState,
} from './project.mjs';
import { TEAM_VERSION } from './version.mjs';
import { fail } from './errors.mjs';

const IGNORE_DIRS = new Set([
  '.git',
  '.riccon',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  '.pytest_cache',
]);

/**
 * @param {string} path
 * @returns {string[]}
 */
function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/**
 * @param {string} projectDir
 * @param {string[]} names
 * @returns {string[]}
 */
function existingDirs(projectDir, names) {
  return names.filter((name) => isDirectory(join(projectDir, name)));
}

const JS_SOURCE_EXTENSIONS = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/i;
const JS_CHECK_EXTENSIONS = /\.(?:mjs|cjs|js)$/i;
const TEST_FILE_PATTERN =
  /^(?:test(?:[-.].*)?|.*\.(?:test|spec))\.(?:mjs|cjs|js|jsx|ts|tsx)$/i;
const CONFIG_FILE_PATTERN =
  /^(?:xo|eslint|prettier|vitest|jest|playwright|vite|rollup|webpack|babel|ava|tsup|tsconfig|nyc|tap)\.config\./i;

/**
 * 收集 package.json 中声明为入口/类型/bin 的路径。
 *
 * @param {any} value
 * @param {Set<string>} output
 */
function collectPackagePaths(value, output) {
  if (typeof value === 'string') {
    const cleaned = value.replace(/^\.\//, '');
    if (
      cleaned &&
      !cleaned.includes('*') &&
      !cleaned.startsWith('.') &&
      JS_SOURCE_EXTENSIONS.test(cleaned)
    ) {
      output.add(cleaned);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPackagePaths(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectPackagePaths(item, output);
  }
}

/**
 * @param {string} projectDir
 * @param {any} pkg
 * @returns {string[]}
 */
function packageEntryFiles(projectDir, pkg) {
  const output = new Set();
  for (const value of [pkg.main, pkg.module, pkg.types, pkg.exports, pkg.bin]) {
    collectPackagePaths(value, output);
  }
  return [...output].filter((file) => exists(join(projectDir, file)));
}

/**
 * @param {string} projectDir
 * @returns {string[]}
 */
function rootSourceFiles(projectDir) {
  return listDir(
    projectDir,
    (name) =>
      !name.startsWith('.') &&
      JS_SOURCE_EXTENSIONS.test(name) &&
      !TEST_FILE_PATTERN.test(name) &&
      !CONFIG_FILE_PATTERN.test(name) &&
      !isDirectory(join(projectDir, name)),
  ).map((file) => basename(file));
}

/**
 * @param {string} projectDir
 * @param {any} pkg
 * @returns {string[]}
 */
function workspacePatterns(projectDir, pkg) {
  const patterns = [];
  if (Array.isArray(pkg.workspaces)) patterns.push(...pkg.workspaces);
  else if (Array.isArray(pkg.workspaces?.packages)) patterns.push(...pkg.workspaces.packages);

  const lernaFile = join(projectDir, 'lerna.json');
  if (exists(lernaFile)) {
    try {
      const lerna = readJson(lernaFile);
      if (Array.isArray(lerna.packages)) patterns.push(...lerna.packages);
    } catch {
      // 留在 notes 之外；无效 lerna 由人工确认。
    }
  }

  const pnpmFile = join(projectDir, 'pnpm-workspace.yaml');
  if (exists(pnpmFile)) {
    for (const line of readLines(pnpmFile)) {
      const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
      if (match) patterns.push(match[1].trim());
    }
  }

  if (!patterns.length && isDirectory(join(projectDir, 'packages'))) {
    patterns.push('packages/*');
  }
  return [...new Set(patterns)];
}

/**
 * @param {string} projectDir
 * @param {any} pkg
 * @returns {{ dir: string, pkg: any, name: string }[]}
 */
function workspacePackages(projectDir, pkg) {
  const found = [];
  for (const pattern of workspacePatterns(projectDir, pkg)) {
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      const parentDir = join(projectDir, parent);
      if (!isDirectory(parentDir)) continue;
      for (const entry of listDir(parentDir, (name) => isDirectory(join(parentDir, name)))) {
        const packageFile = join(entry, 'package.json');
        if (!exists(packageFile)) continue;
        try {
          const child = readJson(packageFile);
          found.push({
            dir: `${parent}/${basename(entry)}`,
            pkg: child,
            name: child.name || basename(entry),
          });
        } catch {
          // 无效子 package 由 notes 提示人工确认。
        }
      }
    } else {
      const packageFile = join(projectDir, pattern, 'package.json');
      if (!exists(packageFile)) continue;
      try {
        const child = readJson(packageFile);
        found.push({ dir: pattern, pkg: child, name: child.name || basename(pattern) });
      } catch {
        // 同上。
      }
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * @param {string} baseDir
 * @param {string} prefix
 * @param {any} pkg
 * @returns {string[]}
 */
function packageEntryFilesIn(baseDir, prefix, pkg) {
  const output = new Set();
  for (const value of [pkg.main, pkg.module, pkg.types, pkg.exports, pkg.bin]) {
    collectPackagePaths(value, output);
  }
  return [...output]
    .filter((file) => exists(join(baseDir, file)))
    .map((file) => (prefix ? `${prefix}/${file}` : file));
}

/**
 * @param {string} projectDir
 * @param {string} dir
 * @param {any} pkg
 * @returns {string[]}
 */
function workspaceSourceFiles(projectDir, dir, pkg) {
  const baseDir = join(projectDir, dir);
  const files = packageEntryFilesIn(baseDir, dir, pkg);
  for (const name of ['index.js', 'index.mjs', 'index.cjs', 'index.ts', 'index.tsx']) {
    if (exists(join(baseDir, name)) && !files.includes(`${dir}/${name}`)) {
      files.push(`${dir}/${name}`);
    }
  }
  return files;
}

/**
 * @param {string} projectDir
 * @returns {string[]}
 */
function rootTestFiles(projectDir) {
  return listDir(
    projectDir,
    (name) =>
      !name.startsWith('.') &&
      TEST_FILE_PATTERN.test(name) &&
      !isDirectory(join(projectDir, name)),
  ).map((file) => basename(file));
}

/**
 * 轻量 TOML 读取：只支持 pyproject 常见的 section、标量和字符串数组。
 * 不引入 TOML 依赖；无法解析时返回空结构，由调用方回退。
 *
 * @param {string} text
 * @returns {Map<string, { scalars: Map<string, string>, arrays: Map<string, string[]>, keys: Set<string> }>}
 */
function parseTomlLite(text) {
  /** @type {Map<string, { scalars: Map<string, string>, arrays: Map<string, string[]>, keys: Set<string> }>} */
  const sections = new Map();
  let section = '';
  /** @type {string | null} */
  let openArrayKey = null;

  const quoted = (line) =>
    [...line.matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2]);

  const ensure = () => {
    if (!sections.has(section)) {
      sections.set(section, {
        scalars: new Map(),
        arrays: new Map(),
        keys: new Set(),
      });
    }
    return sections.get(section);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      openArrayKey = null;
      continue;
    }

    const data = ensure();
    if (openArrayKey) {
      const values = quoted(line);
      data.arrays.get(openArrayKey).push(...values);
      if (line.includes(']')) openArrayKey = null;
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = assignment[1];
    const value = assignment[2].trim();
    data.keys.add(key);

    if (value.startsWith('[')) {
      const values = quoted(value);
      data.arrays.set(key, values);
      if (!value.includes(']')) openArrayKey = key;
    } else {
      data.scalars.set(key, value.replace(/^["']|["']$/g, '').trim());
    }
  }

  return sections;
}

/**
 * @param {Map<string, { scalars: Map<string, string>, arrays: Map<string, string[]> }>} sections
 * @param {string} name
 * @returns {string[]}
 */
function pyprojectDependencyNames(sections) {
  const names = [];
  for (const sectionName of [
    'project',
    'project.optional-dependencies',
    'dependency-groups',
  ]) {
    const section = sections.get(sectionName);
    if (!section) continue;
    for (const values of section.arrays.values()) {
      for (const value of values) {
        const name = value
          .trim()
          .match(/^([A-Za-z0-9_.-]+)/)?.[1]
          ?.toLowerCase();
        if (name) names.push(name);
      }
    }
  }
  return names;
}

/**
 * @param {string} projectDir
 * @returns {Map<string, any> | null}
 */
function readPyproject(projectDir) {
  const file = join(projectDir, 'pyproject.toml');
  if (!exists(file)) return null;
  try {
    return parseTomlLite(readText(file));
  } catch {
    return null;
  }
}

/**
 * @param {string} projectDir
 * @returns {{ files: number, sha256: string }}
 */
function sourceManifest(projectDir) {
  const files = listFilesRecursive(projectDir, (file) => {
    const rel = file.slice(projectDir.length + 1);
    if (rel.split('/').some((part) => IGNORE_DIRS.has(part))) return false;
    if (rel.startsWith('.git/')) return false;
    return true;
  });
  const entries = files.map((file) => {
    const rel = file.slice(projectDir.length + 1);
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    return `${rel}\n${hash}`;
  });
  entries.sort();
  return { files: entries.length, sha256: sha256(entries.join('\n')) };
}

const SUBPROJECT_DIRS = [
  'client',
  'frontend',
  'web',
  'ui',
  'admin',
  'backend',
  'server',
  'service',
];

/**
 * 识别常见子目录里的第二技术栈，避免把带 client/frontend 的仓库
 * 只按根 pom/package 判定成单栈。只扫描一层，不进入 node_modules。
 *
 * @param {string} projectDir
 * @returns {any[]}
 */
function detectSubprojects(projectDir) {
  const found = [];
  for (const dir of SUBPROJECT_DIRS) {
    const full = join(projectDir, dir);
    if (!isDirectory(full)) continue;
    if (exists(join(full, 'package.json'))) {
      let pkg = {};
      try {
        pkg = readJson(join(full, 'package.json'));
      } catch {
        continue;
      }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const frameworks = [];
      if (deps.react) frameworks.push('React');
      if (deps.vue) frameworks.push('Vue');
      if (deps.svelte) frameworks.push('Svelte');
      if (deps.next) frameworks.push('Next.js');
      const languages =
        deps.typescript || exists(join(full, 'tsconfig.json'))
          ? ['TypeScript', 'JavaScript']
          : ['JavaScript'];
      const packageManager = exists(join(full, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : exists(join(full, 'yarn.lock'))
          ? 'yarn'
          : 'npm';
      const runner = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;
      found.push({
        path: dir,
        kind: 'node',
        languages,
        frameworks,
        package_manager: packageManager,
        commands: {
          install:
            packageManager === 'pnpm'
              ? 'pnpm install'
              : packageManager === 'yarn'
                ? 'yarn install'
                : 'npm install',
          build: pkg.scripts?.build ? `${runner} build` : '',
          test: pkg.scripts?.test ? `${runner} test` : '',
        },
      });
    } else if (exists(join(full, 'pom.xml'))) {
      found.push({
        path: dir,
        kind: 'maven',
        languages: ['Java'],
        frameworks: ['Spring'],
        package_manager: 'maven',
        commands: { install: 'mvn -q -DskipTests package', build: 'mvn -q -DskipTests package', test: 'mvn -q test' },
      });
    } else if (
      exists(join(full, 'pyproject.toml')) ||
      exists(join(full, 'requirements.txt'))
    ) {
      found.push({
        path: dir,
        kind: 'python',
        languages: ['Python'],
        frameworks: [],
        package_manager: 'pip',
        commands: {
          install: exists(join(full, 'pyproject.toml'))
            ? 'python3 -m pip install -e .'
            : 'python3 -m pip install -r requirements.txt',
          build: '',
          test: '',
        },
      });
    } else if (exists(join(full, 'go.mod'))) {
      found.push({
        path: dir,
        kind: 'go',
        languages: ['Go'],
        frameworks: [],
        package_manager: 'go',
        commands: { install: 'go mod download', build: 'go build ./...', test: 'go test ./...' },
      });
    }
  }
  return found;
}

/**
 * @param {string} projectDir
 * @returns {any}
 */
export function detectProject(projectDir) {
  const notes = [];
  const has = (name) => exists(join(projectDir, name));
  const dirs = (names) => existingDirs(projectDir, names);
  const source = dirs(['src', 'lib', 'app', 'server', 'inventory', 'pkg', 'cmd']);
  const tests = dirs(['tests', 'test', '__tests__', 'spec']);
  const subprojects = detectSubprojects(projectDir);
  const docs = has('docs') ? 'docs' : '';
  const infra = dirs(['infra', 'deploy', 'docker', 'terraform']).join(',');
  const contracts = dirs(['contracts', 'contract', 'api']).join(',');

  let type = 'other';
  let languages = [];
  let frameworks = [];
  let runtime = '';
  let database = '';
  let packageManager = '';
  let versions = {};
  let pyprojectName = '';
  let workspaceName = '';
  let commands = {
    install: '',
    build: '',
    lint: '',
    typecheck: '',
    test: '',
    test_e2e: '',
    run: '',
    deploy_preview: '',
    deploy_prod: '',
  };
  let requiredTools = [];
  let optionalTools = [];
  let mcp = [];

  const packageJsonPath = join(projectDir, 'package.json');
  if (has('package.json')) {
    languages = ['JavaScript'];
    packageManager = has('pnpm-lock.yaml')
      ? 'pnpm'
      : has('yarn.lock')
        ? 'yarn'
        : 'npm';
    let pkg = {};
    try {
      pkg = readJson(packageJsonPath);
    } catch {
      notes.push('package.json 无法解析；请人工确认命令。');
    }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const depNames = Object.keys(deps);
    const workspaces = workspacePackages(projectDir, pkg);
    if (!pkg.name && workspaces.length > 0) {
      workspaceName = workspaces[0].name;
    }
    for (const workspace of workspaces) {
      if (!source.includes(workspace.dir)) source.push(workspace.dir);
      for (const name of ['tests', 'test', '__tests__', 'spec']) {
        const testDir = `${workspace.dir}/${name}`;
        if (isDirectory(join(projectDir, testDir)) && !tests.includes(testDir)) {
          tests.push(testDir);
        }
      }
    }
    if (depNames.includes('express')) frameworks.push('Express');
    if (depNames.includes('fastify')) frameworks.push('Fastify');
    if (depNames.includes('koa')) frameworks.push('Koa');
    if (depNames.includes('next')) frameworks.push('Next.js');
    if (depNames.includes('react')) frameworks.push('React');
    if (depNames.includes('vue')) frameworks.push('Vue');
    if (depNames.includes('svelte')) frameworks.push('Svelte');
    if (depNames.includes('@playwright/test') || depNames.includes('playwright')) {
      requiredTools.push({
        id: 'playwright',
        purpose: '关键旅程的真实浏览器 E2E',
        fallback: '手工浏览器检查并记录降级',
      });
      mcp.push('playwright');
    }
    if (depNames.includes('vitest') || depNames.includes('jest')) {
      optionalTools.push({
        id: depNames.includes('vitest') ? 'vitest' : 'jest',
        purpose: '单元测试',
        fallback: '使用项目现有测试命令',
      });
    }
    if (depNames.includes('xo')) {
      optionalTools.push({ id: 'xo', purpose: '代码 lint', fallback: '人工检查' });
    } else if (depNames.includes('eslint')) {
      optionalTools.push({ id: 'eslint', purpose: '代码 lint', fallback: '人工检查' });
    }
    if (depNames.includes('tsd') || depNames.includes('typescript')) {
      optionalTools.push({
        id: depNames.includes('typescript') ? 'typescript' : 'tsd',
        purpose: '类型检查',
        fallback: '人工检查',
      });
    }

    const entryFiles = [
      ...packageEntryFiles(projectDir, pkg),
      ...workspaces.flatMap((workspace) =>
        workspaceSourceFiles(projectDir, workspace.dir, workspace.pkg),
      ),
    ];
    const rootSources = rootSourceFiles(projectDir);
    const rootTests = rootTestFiles(projectDir);
    for (const file of [...entryFiles, ...rootSources]) {
      if (!source.includes(file)) source.push(file);
    }
    for (const file of rootTests) {
      if (!tests.includes(file)) tests.push(file);
    }
    if (
      depNames.includes('typescript') ||
      source.some((file) => /\.tsx?$/i.test(file))
    ) {
      languages.push('TypeScript');
    }

    runtime = 'Node.js';
    const nodeEngine =
      pkg.engines?.node ||
      workspaces.find((workspace) => workspace.pkg.engines?.node)?.pkg.engines.node;
    versions = nodeEngine ? { node: nodeEngine } : {};

    const scriptNames = pkg.scripts || {};
    const runner = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;
    const hasWebSurface =
      has('public') ||
      has('index.html') ||
      depNames.some((name) =>
        ['next', 'react', 'vue', 'svelte', '@sveltejs/kit'].includes(name),
      );
    const workspaceDeps = workspaces.flatMap((workspace) => [
      ...Object.keys(workspace.pkg.dependencies || {}),
      ...Object.keys(workspace.pkg.devDependencies || {}),
    ]);
    const allDeps = [...new Set([...depNames, ...workspaceDeps])];
    const apiFramework = allDeps.some((name) =>
      ['express', 'fastify', 'koa', 'hapi', '@nestjs/core'].includes(name),
    );
    const workspaceLooksApi = workspaces.some((workspace) =>
      /api|server|http|router|web/i.test(
        `${workspace.name} ${workspace.pkg.description || ''} ${(
          workspace.pkg.keywords || []
        ).join(' ')}`,
      ),
    );
    const workspaceHasBin = workspaces.some(
      (workspace) => workspace.pkg.bin && Object.keys(workspace.pkg.bin).length > 0,
    );
    if (
      (pkg.bin && Object.keys(pkg.bin).length > 0) ||
      workspaceHasBin
    ) {
      type = 'cli';
    } else if (hasWebSurface) type = 'web-app';
    else if (apiFramework || workspaceLooksApi) type = 'api';
    else type = 'other';

    const testCommand = scriptNames.test ? `${runner} test` : '';
    const syntaxFiles = [
      ...new Set(
        source.filter(
          (file) => JS_CHECK_EXTENSIONS.test(file) && !file.endsWith('.d.ts'),
        ),
      ),
    ];
    const buildCommand = scriptNames.build
      ? `${runner} build`
      : syntaxFiles.length > 0 && syntaxFiles.length <= 8
        ? syntaxFiles.map((file) => `node --check ${file}`).join(' && ')
        : '';
    let lintCommand = scriptNames.lint ? `${runner} lint` : '';
    if (!lintCommand && depNames.includes('xo')) lintCommand = 'npx xo';
    else if (!lintCommand && depNames.includes('eslint')) lintCommand = 'npx eslint .';
    else if (!lintCommand && depNames.includes('@biomejs/biome')) {
      lintCommand = 'npx biome check .';
    }
    const typecheckCommand = scriptNames.typecheck
      ? `${runner} typecheck`
      : depNames.includes('typescript')
        ? 'npx tsc --noEmit'
        : depNames.includes('tsd')
          ? 'npx tsd'
          : '';
    let testE2e = scriptNames['test:e2e'] ? `${runner} test:e2e` : '';
    if (!testE2e && type === 'other' && testCommand) {
      testE2e = testCommand;
      notes.push('库项目没有浏览器 E2E；test_e2e 暂用 test 命令，需人工确认。');
    }

    commands = {
      install:
        packageManager === 'pnpm'
          ? 'pnpm install'
          : packageManager === 'yarn'
            ? 'yarn install'
            : 'npm install',
      build: buildCommand,
      lint: lintCommand,
      typecheck: typecheckCommand,
      test: testCommand,
      test_e2e: testE2e,
      run: scriptNames.start ? `${runName(packageManager)} start` : '',
      deploy_preview: scriptNames.preview ? `${runner} preview` : '',
      deploy_prod: '',
    };

    if (rootSources.length > 0 || rootTests.length > 0) {
      notes.push(
        `检测到根级文件：source=${rootSources.join(', ') || 'none'}；tests=${rootTests.join(', ') || 'none'}。请确认 source/tests 与 test_e2e 语义。`,
      );
    }
    if (workspaces.length > 0) {
      notes.push(
        `检测到 workspace：${workspaces.map((workspace) => workspace.dir).join(', ')}。请确认 install/test 与 workspace 依赖安装方式。`,
      );
    }
    if (!commands.build) notes.push('未识别 build 命令；请在合同中补充。');
    if (!commands.test) notes.push('未识别 test 命令；请在合同中补充。');
    if (!scriptNames.build && syntaxFiles.length > 8) {
      notes.push('源文件较多，未自动生成逐文件 build 命令；请在合同中补充。');
    }
  } else if (
    has('requirements.txt') ||
    has('pyproject.toml') ||
    has('setup.py') ||
    dirs(['inventory', 'src']).some((dir) =>
      exists(join(projectDir, dir, '__main__.py')),
    )
  ) {
    languages = ['Python'];
    packageManager = 'pip';
    const pyproject = readPyproject(projectDir);
    const projectSection = pyproject?.get('project');
    pyprojectName = projectSection?.scalars.get('name') || '';
    const requiresPython = projectSection?.scalars.get('requires-python') || '';
    const pyprojectDeps = pyproject ? pyprojectDependencyNames(pyproject) : [];
    const projectScripts = [...(pyproject?.get('project.scripts')?.keys || [])];
    runtime = requiresPython ? `Python ${requiresPython}` : 'Python 3.9';
    versions = { python: requiresPython || '>=3.9' };

    const pyFiles = [
      has('requirements.txt') ? readLines(join(projectDir, 'requirements.txt')) : [],
      has('pyproject.toml') ? readLines(join(projectDir, 'pyproject.toml')) : [],
    ].flat();
    const pyText = pyFiles.join('\n').toLowerCase();
    if (pyText.includes('flask')) frameworks.push('Flask');
    if (pyText.includes('fastapi')) frameworks.push('FastAPI');
    if (pyText.includes('django')) frameworks.push('Django');
    const usesPytest = pyprojectDeps.includes('pytest') || pyText.includes('pytest');
    if (usesPytest) {
      optionalTools.push({
        id: 'pytest',
        purpose: 'Python 测试',
        fallback: 'python3 -m unittest',
      });
    }
    if (pyprojectDeps.includes('ruff')) {
      optionalTools.push({ id: 'ruff', purpose: 'Python lint', fallback: '人工检查' });
    }
    if (pyText.includes('psycopg') || pyText.includes('postgres')) database = 'PostgreSQL';
    if (pyText.includes('pymysql') || pyText.includes('mysql')) database = 'MySQL';
    if (pyText.includes('sqlite')) database = 'SQLite';

    const cliEntry = dirs(['src']).some((dir) =>
      exists(join(projectDir, dir, '__main__.py')),
    ) || exists(join(projectDir, 'inventory', '__main__.py'));
    type = cliEntry || projectScripts.length > 0
      ? 'cli'
      : frameworks.length > 0
        ? 'api'
        : 'other';
    const testCommand = usesPytest
      ? 'python -m pytest -q'
      : 'python3 -m unittest discover -s tests -v';
    const cliTest = tests.includes('tests')
      ? 'python3 -m unittest tests.test_cli -v'
      : '';
    commands = {
      install: has('pyproject.toml')
        ? 'python -m pip install -e .'
        : has('requirements.txt')
          ? 'python3 -m pip install -r requirements.txt'
          : '',
      build: has('src')
        ? 'python -m compileall -q src'
        : 'python3 -m compileall -q .',
      lint: pyprojectDeps.includes('ruff')
        ? 'python -m ruff check .'
        : 'python3 -m compileall -q .',
      typecheck: pyprojectDeps.includes('mypy')
        ? 'python -m mypy .'
        : pyprojectDeps.includes('pyright')
          ? 'pyright'
          : '',
      test: tests.length ? testCommand : '',
      test_e2e: usesPytest
        ? testCommand
        : cliTest || (tests.length ? testCommand : ''),
      run: cliEntry ? 'python3 -m inventory --help' : '',
      deploy_preview: cliEntry ? 'python3 -m inventory --help' : '',
      deploy_prod: '',
    };
  } else if (has('go.mod')) {
    languages = ['Go'];
    packageManager = 'go';
    runtime = 'Go';
    type = 'cli';
    commands = {
      install: 'go mod download',
      build: 'go build ./...',
      lint: 'go vet ./...',
      typecheck: 'go vet ./...',
      test: 'go test ./...',
      test_e2e: 'go test ./...',
      run: 'go run .',
      deploy_preview: '',
      deploy_prod: '',
    };
  } else if (has('Cargo.toml')) {
    languages = ['Rust'];
    packageManager = 'cargo';
    runtime = 'Rust';
    type = 'cli';
    commands = {
      install: 'cargo fetch',
      build: 'cargo build',
      lint: 'cargo clippy',
      typecheck: 'cargo check',
      test: 'cargo test',
      test_e2e: 'cargo test',
      run: 'cargo run',
      deploy_preview: '',
      deploy_prod: '',
    };
  } else if (has('pom.xml')) {
    languages = ['Java'];
    packageManager = 'maven';
    runtime = 'JVM';
    type = has('src/main/webapp') ? 'web-app' : 'api';
    frameworks = ['Spring'];
    commands = {
      install: 'mvn -q -DskipTests package',
      build: 'mvn -q -DskipTests package',
      lint: '',
      typecheck: '',
      test: 'mvn -q test',
      test_e2e: '',
      run: 'mvn spring-boot:run',
      deploy_preview: '',
      deploy_prod: '',
    };
  } else {
    notes.push('未识别技术栈；合同需要人工填写 stack/commands。');
  }

  for (const subproject of subprojects) {
    for (const language of subproject.languages) {
      if (!languages.includes(language)) languages.push(language);
    }
    for (const framework of subproject.frameworks) {
      if (!frameworks.includes(framework)) frameworks.push(framework);
    }
    if (!source.includes(subproject.path)) source.push(subproject.path);
    if (
      ['api', 'other'].includes(type) &&
      subproject.frameworks.some((framework) =>
        ['React', 'Vue', 'Svelte', 'Next.js'].includes(framework),
      )
    ) {
      type = 'web-app';
    }
  }
  if (subprojects.length) {
    notes.push(
      `检测到子项目：${subprojects
        .map((subproject) => `${subproject.path}(${subproject.frameworks.join('/') || subproject.languages.join('/')})`)
        .join(', ')}。顶层 commands 只覆盖主栈；子项目命令见 stack.subprojects，接管前必须人工确认。`,
    );
  }

  if (!source.length) {
    notes.push('未识别源码根或入口文件；请在合同的 repo_map.source 中补充。');
  }
  if (!tests.length) {
    notes.push('未识别测试目录或测试文件；请在合同的 repo_map.tests 中补充。');
  }
  const name =
    (has('package.json') && readJsonSafe(packageJsonPath)?.name) ||
    pyprojectName ||
    workspaceName ||
    basename(projectDir);
  const contract = defaultContract({
    name,
    type,
    riskTier: 'T2',
    status: 'existing',
    evidenceBinding: 'legacy',
  });
  contract.project.name = name;
  contract.project.type = type;
  contract.project.risk_tier = 'T2';
  contract.project.status = 'existing';
  contract.product = {
    goal: '维护并改进现有项目；保持现有行为基线。',
    users: [],
    mvc: '现有行为保持通过；完成本轮 T2 任务。',
    non_goals: [],
    success_metrics: ['现有测试通过', 'T2 验收通过'],
    module_roadmap: [],
  };
  contract.stack = {
    languages,
    frameworks,
    runtime,
    database,
    package_manager: packageManager || '',
    versions,
    ...(subprojects.length ? { subprojects } : {}),
  };
  contract.repo_map = {
    source,
    tests,
    docs,
    infra,
    contracts,
  };
  contract.commands = commands;
  contract.tools = {
    required: requiredTools,
    optional: optionalTools,
    mcp,
    fallback: '记录降级；改范围前先问用户。',
  };
  contract.constraints = {
    ...contract.constraints,
    style: '保持现有项目风格；不引入无必要依赖',
    security: '不引入密钥；不扩大现有攻击面',
  };

  return {
    detected: {
      name,
      type,
      languages,
      frameworks,
      runtime,
      database,
      package_manager: packageManager,
      subprojects,
      source,
      tests,
      docs,
      commands,
      notes,
      risk_tier: 'T2',
    },
    contract,
    manifest: sourceManifest(projectDir),
  };
}

/** @param {string} projectDir */
function readJsonSafe(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function runName(packageManager) {
  return packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm';
}

/**
 * @param {string} projectDir
 * @param {{ write?: boolean }} [options]
 * @returns {{ detected: any, contract: any, wrote: boolean, files: string[] }}
 */
export function adoptProject(projectDir, options = {}) {
  const paths = projectPaths(projectDir);
  if (exists(paths.projectJson)) {
    fail(`${projectDir} is already initialized; use \`riccon contract validate\``, {
      code: 'ERR_ALREADY_INITIALIZED',
    });
  }

  const result = detectProject(projectDir);
  const wrote = options.write === true;
  const files = [];
  if (!wrote) return { ...result, wrote, files };

  if (exists(paths.agentsMd)) {
    const existing = loadContract(projectDir);
    if (existing.block) {
      fail(
        `${projectDir} already has a Project Contract; edit it or use \`riccon contract validate\``,
        { code: 'ERR_CONTRACT_EXISTS' },
      );
    }
  }

  ensureProjectDirs(paths);
  for (const dir of [
    paths.modules,
    paths.tasks,
    paths.decisions,
    paths.evidence,
    paths.reviews,
    paths.releases,
    paths.handoffs,
    paths.runs,
    paths.archive,
  ]) {
    const keep = join(dir, '.gitkeep');
    if (!exists(keep)) writeText(keep, '');
  }

  if (exists(paths.agentsMd)) {
    writeContractBlock(paths.agentsMd, result.contract);
  } else {
    writeText(
      paths.agentsMd,
      `# ${result.detected.name} — Agent 说明\n\n` +
        '本文件由 `riccon adopt` 生成；源文件未被修改。请先确认合同与基线，再开始 T2 任务。\n',
    );
    writeContractBlock(paths.agentsMd, result.contract);
  }
  files.push('AGENTS.md');

  const adoptionDoc = [
    `# 接管基线：${result.detected.name}`,
    '',
    `- 检测时间：${nowIso()}`,
    `- 类型：${result.detected.type}`,
    `- 语言：${result.detected.languages.join(', ') || '未识别'}`,
    `- 包管理器：${result.detected.package_manager || '未识别'}`,
    `- 源码根：${result.detected.source.join(', ') || '未识别'}`,
    `- 测试根：${result.detected.tests.join(', ') || '未识别'}`,
    `- 基线文件数：${result.manifest.files}`,
    `- 基线哈希：${result.manifest.sha256}`,
    '',
    '## 检测命令',
    '',
    '| 命令 | 值 |',
    '|---|---|',
    ...Object.entries(result.detected.commands).map(
      ([key, value]) => `| ${key} | ${value || '（空）'} |`,
    ),
    '',
    '## 说明',
    '',
    '- 本次接管只写 `.riccon/`、`AGENTS.md` 和本文件；没有修改项目源码。',
    '- 合同由 Lead 确认后再开始 T2；不要假设检测结果 100% 准确。',
    '- 如果命令或路径不对，先改合同并运行 `riccon contract validate`。',
    ...(result.detected.notes.length
      ? ['', '## 注意', '', ...result.detected.notes.map((note) => `- ${note}`)]
      : []),
    '',
  ].join('\n');
  writeText(join(projectDir, 'docs', 'ADOPTION.md'), adoptionDoc);
  files.push('docs/ADOPTION.md');

  const createdAt = nowIso();
  const project = {
    schema_version: 1,
    team_version: TEAM_VERSION,
    name: result.detected.name,
    type: result.detected.type,
    risk_tier: 'T2',
    status: 'existing',
    contract: {
      path: 'AGENTS.md',
      sha256: contractHash(result.contract),
    },
    adoption: {
      detected_at: createdAt,
      manifest_sha256: result.manifest.sha256,
      file_count: result.manifest.files,
    },
    created_at: createdAt,
    updated_at: createdAt,
  };
  const state = {
    schema_version: 1,
    phase: 'discovery',
    current_module: null,
    gate: { status: 'none', module_id: null, checked_at: null, reasons: [] },
    health: 'unknown',
    last_handoff: null,
    next_action:
      'Review docs/ADOPTION.md and the AGENTS.md contract, confirm the T2 scope, then create the module.',
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
  files.push('.riccon/project.json', '.riccon/state.json');

  return { ...result, wrote, files };
}

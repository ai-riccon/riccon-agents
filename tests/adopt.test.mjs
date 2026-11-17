import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanup,
  initProject,
  readJson,
  run,
  runJson,
  tempDir,
  writeText,
} from './helpers.mjs';

function writeLegacyFixture(dir) {
  writeText(
    join(dir, 'inventory', '__main__.py'),
    [
      'import argparse',
      '',
      'def main():',
      "    parser = argparse.ArgumentParser(prog='inventory')",
      "    parser.add_argument('command', choices=['list'])",
      '    parser.parse_args()',
      "    print('[]')",
      '',
      "if __name__ == '__main__':",
      '    main()',
      '',
    ].join('\n'),
  );
  writeText(
    join(dir, 'inventory', 'core.py'),
    'def total(items):\n    return sum(item.get("qty", 0) for item in items)\n',
  );
  writeText(join(dir, 'tests', '__init__.py'), '');
  writeText(
    join(dir, 'tests', 'test_cli.py'),
    [
      'import unittest',
      '',
      'class TestCli(unittest.TestCase):',
      '    def test_ok(self):',
      '        self.assertTrue(True)',
      '',
    ].join('\n'),
  );
  writeText(join(dir, 'requirements.txt'), '# stdlib only\n');
  writeText(join(dir, 'README.md'), '# legacy fixture\n');
}

function writeJsLibraryFixture(dir) {
  writeText(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/root-lib',
        version: '1.0.0',
        type: 'module',
        exports: {
          types: './index.d.ts',
          default: './index.js',
        },
        scripts: { test: 'node --test' },
        devDependencies: { xo: '^0.60.0' },
        engines: { node: '>=22' },
      },
      null,
      2,
    ) + '\n',
  );
  writeText(join(dir, 'index.js'), 'export const value = 1;\n');
  writeText(join(dir, 'index.d.ts'), 'export declare const value: number;\n');
  writeText(join(dir, 'helper.js'), 'export const helper = 2;\n');
  writeText(
    join(dir, 'test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from './index.js';\n\ntest('value', () => assert.equal(value, 1));\n",
  );
  writeText(join(dir, 'xo.config.js'), 'export default {};\n');
  writeText(join(dir, 'readme.md'), '# root lib\n');
}

function writePyprojectFixture(dir) {
  writeText(
    join(dir, 'pyproject.toml'),
    [
      '[project]',
      'name = "demo-py"',
      'version = "0.1.0"',
      'requires-python = ">=3.11"',
      'dependencies = [',
      '  "requests>=2",',
      ']',
      '',
      '[project.optional-dependencies]',
      'tests = [',
      '  "pytest>=8",',
      ']',
      '',
      '[dependency-groups]',
      'dev = [',
      '  "ruff",',
      ']',
      '',
    ].join('\n'),
  );
  writeText(join(dir, 'src', 'demo', '__init__.py'), 'VALUE = 1\n');
  writeText(
    join(dir, 'tests', 'test_demo.py'),
    'from demo import VALUE\n\n\ndef test_value():\n    assert VALUE == 1\n',
  );
  writeText(join(dir, 'README.md'), '# demo-py\n');
}

function writeMonorepoFixture(dir) {
  writeText(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        workspaces: ['packages/*'],
        scripts: { test: 'tape tests/*.js' },
        engines: { node: '>=20' },
      },
      null,
      2,
    ) + '\n',
  );
  writeText(
    join(dir, 'packages', 'api', 'package.json'),
    JSON.stringify(
      {
        name: 'demo-api',
        version: '1.0.0',
        description: 'A tiny HTTP API server',
        main: 'index.js',
      },
      null,
      2,
    ) + '\n',
  );
  writeText(
    join(dir, 'packages', 'api', 'index.js'),
    "module.exports = () => 'ok';\n",
  );
  writeText(
    join(dir, 'tests', 'test.js'),
    "const test = require('node:test');\ntest('ok', () => {});\n",
  );
}

function writeMultiStackFixture(dir) {
  writeText(
    join(dir, 'pom.xml'),
    '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>demo</artifactId></project>\n',
  );
  writeText(
    join(dir, 'client', 'package.json'),
    JSON.stringify(
      {
        name: 'demo-client',
        private: true,
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { typescript: '^5.9.0', vite: '^8.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  writeText(join(dir, 'client', 'tsconfig.json'), '{}\n');
  writeText(join(dir, 'client', 'src', 'App.tsx'), 'export const App = () => null;\n');
  writeText(join(dir, 'README.md'), '# multi-stack fixture\n');
}

function hashFiles(dir, files) {
  return files.map((file) => {
    const hash = createHash('sha256')
      .update(readFileSync(join(dir, file)))
      .digest('hex');
    return `${file}:${hash}`;
  });
}

test('adopt 只读检测 Python CLI', (t) => {
  const dir = tempDir('riccon-adopt-');
  t.after(() => cleanup(dir));
  writeLegacyFixture(dir);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.wrote, false);
  assert.equal(result.json.detected.type, 'cli');
  assert.ok(result.json.detected.languages.includes('Python'));
  assert.match(result.json.detected.commands.test, /unittest/);
  assert.equal(existsSync(join(dir, '.riccon')), false);
});

test('adopt 识别根级单文件 JS 库并推断命令', (t) => {
  const dir = tempDir('riccon-adopt-js-lib-');
  t.after(() => cleanup(dir));
  writeJsLibraryFixture(dir);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.wrote, false);
  assert.equal(result.json.detected.type, 'other');
  assert.deepEqual(result.json.detected.source, [
    'index.d.ts',
    'index.js',
    'helper.js',
  ]);
  assert.deepEqual(result.json.detected.tests, ['test.js']);
  assert.equal(
    result.json.detected.commands.build,
    'node --check index.js && node --check helper.js',
  );
  assert.equal(result.json.detected.commands.lint, 'npx xo');
  assert.equal(result.json.detected.commands.test, 'npm run test');
  assert.equal(result.json.detected.commands.test_e2e, 'npm run test');
  assert.equal(result.json.detected.runtime, 'Node.js');
  assert.equal(result.json.detected.source.includes('xo.config.js'), false);
  assert.equal(result.json.detected.source.includes('test.js'), false);
});

test('adopt 识别 workspace monorepo 的 source/name/type', (t) => {
  const dir = tempDir('riccon-adopt-monorepo-');
  t.after(() => cleanup(dir));
  writeMonorepoFixture(dir);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.detected.name, 'demo-api');
  assert.equal(result.json.detected.type, 'api');
  assert.ok(result.json.detected.source.includes('packages/api'));
  assert.ok(result.json.detected.source.includes('packages/api/index.js'));
  assert.deepEqual(result.json.detected.tests, ['tests']);
  assert.equal(
    result.json.detected.commands.build,
    'node --check packages/api/index.js',
  );
  assert.equal(result.json.detected.commands.test, 'npm run test');
  assert.match(result.json.detected.notes.join(' '), /workspace/);
});

test('adopt 解析 Python pyproject 的 name/runtime/pytest/ruff', (t) => {
  const dir = tempDir('riccon-adopt-pyproject-');
  t.after(() => cleanup(dir));
  writePyprojectFixture(dir);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.detected.name, 'demo-py');
  assert.equal(result.json.detected.type, 'other');
  assert.equal(result.json.detected.runtime, 'Python >=3.11');
  assert.deepEqual(result.json.detected.source, ['src']);
  assert.deepEqual(result.json.detected.tests, ['tests']);
  assert.equal(result.json.detected.commands.install, 'python -m pip install -e .');
  assert.equal(result.json.detected.commands.build, 'python -m compileall -q src');
  assert.equal(result.json.detected.commands.lint, 'python -m ruff check .');
  assert.equal(result.json.detected.commands.test, 'python -m pytest -q');
  assert.equal(result.json.detected.commands.test_e2e, 'python -m pytest -q');
});

test('adopt 识别 pom + client 双栈并写入 stack.subprojects', (t) => {
  const dir = tempDir('riccon-adopt-multistack-');
  t.after(() => cleanup(dir));
  writeMultiStackFixture(dir);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.detected.type, 'web-app');
  assert.ok(result.json.detected.languages.includes('Java'));
  assert.ok(result.json.detected.languages.includes('TypeScript'));
  assert.ok(result.json.detected.frameworks.includes('React'));
  assert.ok(result.json.detected.source.includes('client'));
  assert.equal(result.json.detected.subprojects.length, 1);
  assert.equal(result.json.detected.subprojects[0].path, 'client');
  assert.equal(result.json.detected.subprojects[0].commands.build, 'npm run build');
  assert.equal(result.json.contract.stack.subprojects[0].path, 'client');
  assert.match(result.json.detected.notes.join(' '), /子项目：client/);

  const written = run(['adopt', '--write', '--project', dir]);
  assert.equal(written.code, 0, written.stderr);
  const validated = run(['contract', 'validate', '--project', dir]);
  assert.equal(validated.code, 0, validated.stdout + validated.stderr);
});

test('adopt --write JS 库生成可校验的合同', (t) => {
  const dir = tempDir('riccon-adopt-js-write-');
  t.after(() => cleanup(dir));
  writeJsLibraryFixture(dir);

  const result = runJson(['adopt', '--project', dir, '--write']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.wrote, true);

  const contract = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(contract.code, 0, contract.stdout + contract.stderr);
  assert.equal(contract.json.ok, true);
  assert.match(
    readFileSync(join(dir, 'AGENTS.md'), 'utf8'),
    /node --check index\.js/,
  );

  const state = runJson(['state', 'validate', '--project', dir]);
  assert.equal(state.code, 0, state.stdout + state.stderr);
});

test('adopt --write 只写状态/合同/基线，不改源码', (t) => {
  const dir = tempDir('riccon-adopt-write-');
  t.after(() => cleanup(dir));
  writeLegacyFixture(dir);
  const sourceFiles = [
    'inventory/__main__.py',
    'inventory/core.py',
    'tests/test_cli.py',
    'requirements.txt',
    'README.md',
  ];
  const before = hashFiles(dir, sourceFiles);

  const result = runJson(['adopt', '--project', dir, '--write']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.wrote, true);

  for (const path of [
    '.riccon/project.json',
    '.riccon/state.json',
    'AGENTS.md',
    'docs/ADOPTION.md',
  ]) {
    assert.equal(existsSync(join(dir, path)), true, `${path} should exist`);
  }

  const after = hashFiles(dir, sourceFiles);
  assert.deepEqual(after, before, 'source files must not change');

  const contract = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(contract.code, 0, contract.stdout + contract.stderr);
  assert.equal(contract.json.ok, true);

  const state = runJson(['state', 'validate', '--project', dir]);
  assert.equal(state.code, 0, state.stdout + state.stderr);
  assert.equal(state.json.ok, true);

  const project = readJson(join(dir, '.riccon', 'project.json'));
  assert.equal(project.status, 'existing');
  assert.equal(project.risk_tier, 'T2');
  assert.match(project.adoption.manifest_sha256, /^[a-f0-9]{64}$/);
});

test('已初始化项目拒绝重复 adopt', (t) => {
  const dir = tempDir('riccon-adopt-twice-');
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const result = runJson(['adopt', '--project', dir]);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /already initialized/);
});

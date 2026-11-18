import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { cleanup, initProject, readJson, runJson, tempDir } from './helpers.mjs';
import { defaultContract, writeContractBlock } from '../scripts/lib/contract.mjs';

test('init creates the project skeleton', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runJson([
    'init',
    '--name',
    'toy',
    '--type',
    'api',
    '--risk-tier',
    'T2',
    '--project',
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.ok, true);

  for (const path of [
    '.riccon/project.json',
    '.riccon/state.json',
    '.riccon/modules',
    '.riccon/tasks',
    '.riccon/decisions',
    '.riccon/evidence',
    '.riccon/reviews',
    '.riccon/reviews/tasks',
    '.riccon/releases',
    '.riccon/handoffs',
    '.riccon/runs',
    '.riccon/archive',
    'AGENTS.md',
    'docs/PRODUCT.md',
    'docs/ARCHITECTURE.md',
    'docs/RUNBOOK.md',
    'docs/SANDBOX.md',
    'docs/adr/README.md',
  ]) {
    assert.equal(existsSync(join(dir, path)), true, `${path} should exist`);
  }
});

test('init preserves an existing valid contract', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const contract = defaultContract({
    name: 'existing',
    type: 'api',
    riskTier: 'T2',
    status: 'existing',
  });
  writeContractBlock(join(dir, 'AGENTS.md'), contract);

  const result = runJson([
    'init',
    '--name',
    'cli-name',
    '--type',
    'web-app',
    '--risk-tier',
    'T3',
    '--project',
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.name, 'existing');

  const project = readJson(join(dir, '.riccon', 'project.json'));
  assert.equal(project.name, 'existing');
  assert.equal(project.type, 'api');
  assert.equal(project.risk_tier, 'T2');
  assert.equal(project.status, 'existing');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /name: existing/);
});

test('contract validate detects contract hash drift and sync repairs it', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const contract = defaultContract({
    name: 'toy',
    type: 'web-app',
    riskTier: 'T3',
  });
  contract.product.goal = 'changed after sync';
  writeContractBlock(join(dir, 'AGENTS.md'), contract);

  const drift = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(drift.code, 1);
  assert.match(drift.stdout, /contract sha256 mismatch/);

  assert.equal(runJson(['contract', 'sync', '--project', dir]).code, 0);
  const fixed = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(fixed.code, 0, fixed.stdout);
});

test('init refuses to overwrite an initialized project without --force', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const second = initProject(dir);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /already initialized/);
});

test('init --force archives the old .riccon and reinitializes', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  writeFileSync(join(dir, '.riccon', 'old-marker.txt'), 'old');

  const second = initProject(dir, ['--force']);
  assert.equal(second.code, 0, second.stderr);

  const archives = readdirSync(dir).filter((name) => name.startsWith('.riccon-old-'));
  assert.equal(archives.length, 1);
  assert.equal(
    existsSync(join(dir, archives[0], 'old-marker.txt')),
    true,
    'the old state should be archived, not deleted',
  );
});

test('init archives an uninitialized .riccon directory', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  mkdirSync(join(dir, '.riccon'));
  writeFileSync(join(dir, '.riccon', 'stray.txt'), 'stray');

  const result = initProject(dir);
  assert.equal(result.code, 0, result.stderr);
  const archives = readdirSync(dir).filter((name) => name.startsWith('.riccon-old-'));
  assert.equal(archives.length, 1);
  assert.equal(existsSync(join(dir, archives[0], 'stray.txt')), true);
});

test('init --json reports the archive path', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const result = runJson([
    'init',
    '--name',
    'toy',
    '--project',
    dir,
    '--force',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.archived.length, 1);
});

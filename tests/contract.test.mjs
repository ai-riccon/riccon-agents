import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, initProject, readJson, runJson, tempDir } from './helpers.mjs';
import { contractHash, readContract } from '../scripts/lib/contract.mjs';

test('init creates a valid contract', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const init = initProject(dir);
  assert.equal(init.code, 0, init.stderr);

  const validate = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(validate.code, 0, validate.stderr);
  assert.equal(validate.json.ok, true);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /## Project Contract/);
  assert.match(agents, /<!-- riccon:contract:start -->/);
});

test('strict contract validation fails on a fresh project warnings', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const validate = runJson(['contract', 'validate', '--project', dir, '--strict']);
  assert.equal(validate.code, 1);
  assert.equal(validate.json.ok, false);
  assert.ok(validate.json.errors.length > 0);
});

test('contract validation rejects an invalid risk tier', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const file = join(dir, 'AGENTS.md');
  const text = readFileSync(file, 'utf8').replace(
    'risk_tier: T3',
    'risk_tier: T9',
  );
  writeFileSync(file, text);

  const validate = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(validate.code, 1);
  assert.equal(validate.json.ok, false);
  assert.match(validate.json.errors.join(' '), /risk_tier/);
});

test('init preserves existing AGENTS.md prose and appends the contract', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  writeFileSync(
    join(dir, 'AGENTS.md'),
    '# My Project\n\nKeep this project-specific note.\n',
  );

  assert.equal(initProject(dir).code, 0);
  const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(text, /Keep this project-specific note/);
  assert.match(text, /<!-- riccon:contract:start -->/);
});

test('init replaces a heading-only contract without duplicating it', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  writeFileSync(
    join(dir, 'AGENTS.md'),
    [
      '# Existing',
      '',
      '## Project Contract',
      '',
      '```yaml',
      'contract_version: 1',
      '```',
      '',
      '## Other notes',
      '',
      'Keep this section.',
      '',
    ].join('\n'),
  );

  assert.equal(initProject(dir, ['--force']).code, 0);
  const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal((text.match(/## Project Contract/g) || []).length, 1);
  assert.equal((text.match(/<!-- riccon:contract:start -->/g) || []).length, 1);
  assert.match(text, /## Other notes/);
  assert.match(text, /Keep this section/);
});

test('contract sync updates the stored hash', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const projectFile = join(dir, '.riccon', 'project.json');
  const before = readJson(projectFile).contract.sha256;
  const file = join(dir, 'AGENTS.md');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('risk_tier: T3', 'risk_tier: T2'),
  );

  const result = runJson(['contract', 'sync', '--project', dir]);
  assert.equal(result.code, 0, result.stderr);
  const project = readJson(projectFile);
  const after = project.contract.sha256;
  assert.notEqual(after, before);
  assert.equal(after, contractHash(readContract(dir)));
  assert.equal(project.risk_tier, 'T2');
  assert.equal(project.type, 'web-app');
  assert.equal(project.name, 'toy');
});

test('contract show returns the parsed contract', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const show = runJson(['contract', 'show', '--project', dir]);
  assert.equal(show.code, 0, show.stderr);
  assert.equal(show.json.contract_version, 1);
  assert.equal(show.json.project.name, 'toy');
  assert.equal(show.json.project.risk_tier, 'T3');
});

test('new contracts default to 80/70 coverage and coverage DoD', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const show = runJson(['contract', 'show', '--project', dir]);
  assert.equal(show.code, 0, show.stderr);
  assert.equal(show.json.constraints.coverage.line, 80);
  assert.equal(show.json.constraints.coverage.branch, 70);
  assert.ok(show.json.definition_of_done.module.includes('coverage'));
  assert.equal(show.json.quality.evidence_binding, 'legacy');

  const strictDir = tempDir();
  t.after(() => cleanup(strictDir));
  assert.equal(
    initProject(strictDir, ['--evidence-binding', 'strict']).code,
    0,
  );
  const strict = runJson(['contract', 'show', '--project', strictDir]);
  assert.equal(strict.json.quality.evidence_binding, 'strict');
});

test('contract validation reports a missing contract', (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runJson(['contract', 'validate', '--project', dir]);
  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
  assert.match(result.json.errors.join(' '), /AGENTS\.md not found/);
});

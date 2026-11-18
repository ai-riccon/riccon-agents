import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { validateSchema } from '../scripts/lib/schema.mjs';
import { defaultContract, extractContractBlock } from '../scripts/lib/contract.mjs';
import { parseFrontmatter } from '../scripts/lib/yamlx.mjs';

const root = join(import.meta.dirname, '..');

test('default contract validates against the schema', () => {
  const contract = defaultContract({
    name: 'demo',
    type: 'web-app',
    riskTier: 'T3',
  });
  const result = validateSchema('contract.schema.json', contract);
  assert.deepEqual(result.errors, []);
});

test('project contract template block validates', () => {
  const text = readFileSync(join(root, 'templates/project/AGENTS.md'), 'utf8');
  const block = extractContractBlock(text);
  assert.ok(block, 'template must contain a managed contract block');
  const data = YAML.parse(block.yamlText);
  const result = validateSchema('contract.schema.json', data);
  assert.deepEqual(result.errors, []);
});

test('contract rejects an unknown risk tier', () => {
  const contract = defaultContract({
    name: 'demo',
    type: 'web-app',
    riskTier: 'T9',
  });
  const result = validateSchema('contract.schema.json', contract);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /risk_tier/);
});

test('module template validates', () => {
  const data = JSON.parse(
    readFileSync(join(root, 'templates/state/module.json'), 'utf8'),
  );
  const result = validateSchema('module.schema.json', data);
  assert.deepEqual(result.errors, []);
});

test('task template validates', () => {
  const data = JSON.parse(
    readFileSync(join(root, 'templates/state/task.json'), 'utf8'),
  );
  const result = validateSchema('task.schema.json', data);
  assert.deepEqual(result.errors, []);
});

test('decision, review, task review and handoff templates have valid front matter', () => {
  for (const [file, schema] of [
    ['templates/state/decision.md', 'decision.schema.json'],
    ['templates/state/review.md', 'review.schema.json'],
    ['templates/state/task-review.md', 'task-review.schema.json'],
    ['templates/state/handoff.md', 'handoff.schema.json'],
  ]) {
    const text = readFileSync(join(root, file), 'utf8');
    const parsed = parseFrontmatter(text);
    assert.equal(parsed.hasFrontmatter, true, `${file} needs front matter`);
    const result = validateSchema(schema, parsed.data);
    assert.deepEqual(result.errors, [], `${file} should validate`);
  }
});

test('contract block can be found by heading without markers', () => {
  const text = [
    '# Project',
    '',
    '## Project Contract',
    '',
    '```yaml',
    'contract_version: 1',
    '```',
    '',
  ].join('\n');
  const block = extractContractBlock(text);
  assert.ok(block);
  assert.equal(block.kind, 'heading');
  assert.match(block.yamlText, /contract_version/);
});

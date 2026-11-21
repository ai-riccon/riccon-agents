import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { listDir } from '../scripts/lib/fsx.mjs';
import { parseFrontmatter } from '../scripts/lib/yamlx.mjs';

const root = join(import.meta.dirname, '..');
const permissionsTemplate = YAML.parse(
  readFileSync(join(root, 'templates', 'agents', 'permissions.yml'), 'utf8'),
);
const agentFiles = listDir(join(root, '.opencode', 'agents', 'riccon'), (name) =>
  name.endsWith('.md'),
);

test('permission template has the destructive and sensitive asks', () => {
  const resources = permissionsTemplate.base.map(
    (rule) => `${rule.action}:${rule.resource}:${rule.effect}`,
  );
  for (const required of [
    'read:.env:ask',
    'read:**/.env.*:ask',
    'edit:AGENTS.md:ask',
    'edit:.opencode/**:ask',
    'edit:$HOME/.config/opencode/riccon/*:ask',
    'edit:.git/**:ask',
    'external_directory:*:ask',
    'shell:*decision answer*:ask',
    'shell:*release approve*:ask',
    'shell:*contract sync*:ask',
    'shell:rm *:ask',
    'shell:git push *:ask',
    'shell:docker system prune*:ask',
    'shell:*DROP TABLE*:ask',
    'shell:npm publish*:ask',
  ]) {
    assert.ok(resources.includes(required), `missing ${required}`);
  }
});

test('agent permissions are in sync with the single source', () => {
  for (const file of agentFiles) {
    const role = basename(file, '.md');
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    const expected = [
      ...permissionsTemplate.base,
      ...(role === 'lead' ? permissionsTemplate.lead : permissionsTemplate.subagent),
    ];
    assert.equal(
      isDeepStrictEqual(parsed.data.permissions, expected),
      true,
      `${role} permissions are out of sync; run npm run sync:permissions`,
    );
  }
});

test('no deny except subagent and question', () => {
  for (const file of agentFiles) {
    const role = basename(file, '.md');
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    for (const rule of parsed.data.permissions) {
      if (rule.effect === 'deny') {
        assert.ok(
          ['subagent', 'question'].includes(rule.action),
          `${role} denies ${rule.action}; only subagent/question may be denied`,
        );
      }
    }
  }
});

test('role boundaries are enforced by permissions', () => {
  for (const file of agentFiles) {
    const role = basename(file, '.md');
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    const rules = parsed.data.permissions;
    const has = (action, resource, effect) =>
      rules.some(
        (rule) =>
          rule.action === action &&
          rule.resource === resource &&
          rule.effect === effect,
      );

    if (role === 'lead') {
      assert.equal(has('subagent', 'riccon/*', 'allow'), true);
      assert.equal(has('question', '*', 'allow'), true);
    } else {
      assert.equal(has('subagent', '*', 'deny'), true, `${role} must not spawn`);
      assert.equal(has('question', '*', 'deny'), true, `${role} must not ask`);
    }
  }
});

test('broad allows come before asks for read, edit and shell', () => {
  for (const file of agentFiles) {
    const role = basename(file, '.md');
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    const rules = parsed.data.permissions;
    for (const action of ['read', 'edit', 'shell']) {
      const broad = rules.findIndex(
        (rule) =>
          rule.action === action && rule.resource === '*' && rule.effect === 'allow',
      );
      const ask = rules.findIndex(
        (rule) => rule.action === action && rule.effect === 'ask',
      );
      assert.notEqual(broad, -1, `${role} must allow ${action} *`);
      if (ask !== -1) {
        assert.ok(
          broad < ask,
          `${role} has an ask before the broad ${action} allow; last-match would override it`,
        );
      }
    }
  }
});

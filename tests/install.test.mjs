import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, runInstall, tempDir } from './helpers.mjs';

function setupHome() {
  const home = tempDir('riccon-home-');
  const configDir = join(home, '.config', 'opencode');
  mkdirSync(join(configDir, 'agents', 'riccon'), { recursive: true });
  writeFileSync(
    join(configDir, 'opencode.json'),
    JSON.stringify({ sentinel: true }, null, 2),
  );
  writeFileSync(
    join(configDir, 'agents', 'riccon', 'lead.md'),
    'old lead definition\n',
  );
  return { home, configDir };
}

test('install dry-run lists actions without writing', (t) => {
  const { home, configDir } = setupHome();
  t.after(() => cleanup(home));

  const result = runInstall(['--home', home, '--dry-run', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.dry_run, true);
  assert.ok(json.actions.length >= 5);

  assert.equal(existsSync(join(configDir, 'riccon')), false);
  assert.equal(
    readFileSync(join(configDir, 'agents', 'riccon', 'lead.md'), 'utf8'),
    'old lead definition\n',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(configDir, 'opencode.json'), 'utf8')),
    { sentinel: true },
  );
});

test('install copies the team and backs up existing files', (t) => {
  const { home, configDir } = setupHome();
  t.after(() => cleanup(home));

  const result = runInstall(['--home', home, '--json']);
  assert.equal(result.code, 0, result.stderr);

  for (const path of [
    'agents/riccon/lead.md',
    'commands/riccon-start.md',
    'commands/riccon-improve.md',
    'skills/riccon-core/SKILL.md',
    'riccon/scripts/riccon.mjs',
    'riccon/schemas/contract.schema.json',
    'riccon/templates/project/AGENTS.md',
    'riccon/node_modules/ajv/package.json',
  ]) {
    assert.equal(existsSync(join(configDir, path)), true, `${path} should exist`);
  }

  assert.deepEqual(
    JSON.parse(readFileSync(join(configDir, 'opencode.json'), 'utf8')),
    { sentinel: true },
    'install must not change opencode.json',
  );
  assert.match(
    readFileSync(join(configDir, 'agents', 'riccon', 'lead.md'), 'utf8'),
    /Riccon Lead/,
  );

  const backupRoots = readdirSync(join(configDir, '.riccon-backup'));
  assert.equal(backupRoots.length, 1);
  const backupLead = join(
    configDir,
    '.riccon-backup',
    backupRoots[0],
    'agents',
    'riccon',
    'lead.md',
  );
  assert.equal(readFileSync(backupLead, 'utf8'), 'old lead definition\n');

  mkdirSync(join(configDir, 'skills', 'x-components'), { recursive: true });
  writeFileSync(
    join(configDir, 'skills', 'x-components', 'SKILL.md'),
    '---\nname: x-components\ndescription: React components\n---\n\nReact\n',
  );

  const installedCli = join(configDir, 'riccon', 'scripts', 'riccon.mjs');
  const doctor = spawnSync(process.execPath, [installedCli, 'doctor', '--json'], {
    encoding: 'utf8',
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
});

test('uninstall removes only team files', (t) => {
  const { home, configDir } = setupHome();
  t.after(() => cleanup(home));

  assert.equal(runInstall(['--home', home, '--json']).code, 0);
  const result = runInstall(['--home', home, '--uninstall', '--json']);
  assert.equal(result.code, 0, result.stderr);

  for (const path of [
    'agents/riccon',
    'commands/riccon-start.md',
    'skills/riccon-core',
    'riccon',
  ]) {
    assert.equal(existsSync(join(configDir, path)), false, `${path} should be removed`);
  }
  assert.equal(
    existsSync(join(configDir, 'opencode.json')),
    true,
    'opencode.json must survive uninstall',
  );
  assert.ok(
    readdirSync(join(configDir, '.riccon-backup')).length >= 1,
    'backups must survive uninstall',
  );
});

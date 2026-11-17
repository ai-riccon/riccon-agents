#!/usr/bin/env node
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { listDir } from './lib/fsx.mjs';
import { timestampSlug } from './lib/time.mjs';

const TEAM_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    uninstall: { type: 'boolean', default: false },
    home: { type: 'string' },
    'config-dir': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  allowPositionals: false,
  strict: true,
});

const home = values.home || homedir();
const configDir = resolve(values['config-dir'] || join(home, '.config', 'opencode'));
const dryRun = values['dry-run'];
const backupRoot = join(configDir, '.riccon-backup', timestampSlug());

/** @type {{ action: string, source?: string, target: string, backup?: string }[]} */
const actions = [];

function planCopy(source, target) {
  const backup = existsSync(target)
    ? join(backupRoot, relative(configDir, target))
    : undefined;
  actions.push({ action: 'copy', source, target, backup });
}

function planRemove(target) {
  if (existsSync(target)) {
    const backup = join(backupRoot, relative(configDir, target));
    actions.push({ action: 'remove', target, backup });
  }
}

function executeCopy(source, target, backup) {
  if (dryRun) return;
  mkdirSync(dirname(target), { recursive: true });
  if (backup) {
    mkdirSync(dirname(backup), { recursive: true });
    cpSync(target, backup, { recursive: true });
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function install() {
  const agentDir = join(TEAM_ROOT, '.opencode', 'agents', 'riccon');
  planCopy(agentDir, join(configDir, 'agents', 'riccon'));

  const commandDir = join(TEAM_ROOT, '.opencode', 'commands');
  for (const file of listDir(commandDir, (name) => /^riccon-.*\.md$/.test(name))) {
    planCopy(file, join(configDir, 'commands', basename(file)));
  }

  const skillsDir = join(TEAM_ROOT, '.opencode', 'skills');
  for (const dir of listDir(skillsDir, (name) => name.startsWith('riccon-'))) {
    planCopy(dir, join(configDir, 'skills', basename(dir)));
  }

  const kernelDir = join(configDir, 'riccon');
  const kernelSources = [
    'scripts',
    'schemas',
    'templates',
    'package.json',
    'package-lock.json',
    'node_modules',
    'LICENSE',
    'NOTICE',
  ];
  const existingKernel = existsSync(kernelDir);
  if (existingKernel) {
    actions.push({
      action: 'backup',
      target: kernelDir,
      backup: join(backupRoot, 'riccon'),
    });
  }
  actions.push({ action: 'replace-kernel', target: kernelDir });

  if (!dryRun) {
    if (existingKernel) {
      const backup = join(backupRoot, 'riccon');
      mkdirSync(join(backup, '..'), { recursive: true });
      cpSync(kernelDir, backup, { recursive: true });
      rmSync(kernelDir, { recursive: true, force: true });
    }
    mkdirSync(kernelDir, { recursive: true });
    for (const source of kernelSources) {
      const from = join(TEAM_ROOT, source);
      if (!existsSync(from)) continue;
      cpSync(from, join(kernelDir, source), { recursive: true });
    }
    for (const file of ['riccon.mjs', 'install.mjs']) {
      const target = join(kernelDir, 'scripts', file);
      if (existsSync(target)) chmodSync(target, 0o755);
    }
  }
}

function uninstall() {
  planRemove(join(configDir, 'agents', 'riccon'));

  const commandDir = join(configDir, 'commands');
  for (const file of listDir(commandDir, (name) => /^riccon-.*\.md$/.test(name))) {
    planRemove(file);
  }

  const skillsDir = join(configDir, 'skills');
  for (const dir of listDir(skillsDir, (name) => name.startsWith('riccon-'))) {
    planRemove(dir);
  }

  planRemove(join(configDir, 'riccon'));
}

if (values.uninstall) {
  uninstall();
} else {
  install();
}

for (const action of actions) {
  if (action.action === 'copy') {
    if (!dryRun) executeCopy(action.source, action.target, action.backup);
  } else if (action.action === 'remove' && !dryRun) {
    if (action.backup) {
      mkdirSync(join(action.backup, '..'), { recursive: true });
      cpSync(action.target, action.backup, { recursive: true });
    }
    rmSync(action.target, { recursive: true, force: true });
  }
}

const summary = {
  ok: true,
  dry_run: dryRun,
  config_dir: configDir,
  backup_root: backupRoot,
  actions,
};

if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `${dryRun ? 'dry-run' : values.uninstall ? 'uninstall' : 'install'} → ${configDir}`,
  );
  for (const action of actions) {
    if (action.action === 'copy') {
      console.log(`  copy ${relative(TEAM_ROOT, action.source)} → ${action.target}`);
      if (action.backup) console.log(`    backup ${action.target} → ${action.backup}`);
    } else if (action.action === 'remove') {
      console.log(`  remove ${action.target}`);
      if (action.backup) console.log(`    backup ${action.target} → ${action.backup}`);
    } else if (action.action === 'backup') {
      console.log(`  backup ${action.target} → ${action.backup}`);
    } else if (action.action === 'replace-kernel') {
      console.log(`  replace ${action.target}`);
    }
  }
  if (!values.uninstall && !dryRun) {
    console.log(
      '\nnext: the kernel is at ~/.config/opencode/riccon/scripts/riccon.mjs; commands use that path.',
    );
  }
}

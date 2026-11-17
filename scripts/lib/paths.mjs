import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const TEAM_ROOT = resolve(LIB_DIR, '..', '..');
export const SCHEMAS_DIR = join(TEAM_ROOT, 'schemas');
export const TEMPLATES_DIR = join(TEAM_ROOT, 'templates');
export const AGENTS_DIR = join(TEAM_ROOT, '.opencode', 'agents');
export const COMMANDS_DIR = join(TEAM_ROOT, '.opencode', 'commands');
export const SKILLS_DIR = join(TEAM_ROOT, '.opencode', 'skills');
